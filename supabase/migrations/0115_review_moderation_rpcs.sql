-- ============================================================
-- 0115_review_moderation_rpcs.sql
--
-- Phase 1 whole-review moderation RPCs.
--
--   get_admin_review_state(review)          admin read
--   remove_review(review, message, note)    admin: hide from app (reversible)
--   restore_review(review, message, note)   admin: undo a removal
--   get_order_review_removal(order)         buyer and shop owner read
--
-- Lock ordering (consistent with update_review and upsert_review_reply):
--   1. reviews row FOR UPDATE   (the serialization point for all review writes)
--   2. shops row FOR UPDATE     (taken only inside recalculate_trusted_seller)
-- No path locks shops before reviews.
--
-- Event semantics (applies to both remove_review and restore_review):
--   - A genuine state change writes one audit row, one outbox row
--     (enqueue_email), and one in-app notification, all in the same
--     transaction as the state change.
--   - A repeat of the current state returns early with was_already_*
--     = true and writes nothing.
--   - Notification and outbox dedupe keys use the audit row's id, so each
--     genuine transition is deliverable and a repeat never is.
--
-- Failure semantics: enqueue_email and the notification insert run inside
-- the same transaction. An error raised by either rolls back the whole
-- moderation action, so no state change exists without its required
-- notification and email event. enqueue_email itself is a no-op for a
-- deleted recipient, and its insert uses ON CONFLICT DO NOTHING. Asynchronous
-- email delivery happens later in process-email-outbox and cannot roll back
-- moderation state.
--
-- Admin identity is never given to the buyer: notification actor_id is NULL,
-- following the system-notification convention in 0040.
--
-- DEPLOYMENT GATING (required, see the report accompanying this migration):
-- remove_review and restore_review are created here but NOT granted to
-- authenticated. They become callable only from the final grant in
-- 0117_review_moderation_edit_guards.sql, which runs after the public-read
-- filters (0116) and the buyer/seller edit guards are installed. Until then,
-- no authenticated caller can remove a review, even by calling the RPC
-- directly. Keep these grants out of this file.
--
-- TRANSACTION BOUNDARY (requirement, not verified here): each migration file
-- must run in its own transaction, or the grant gating above is the only
-- protection. This repository does not verify how the migration runner groups
-- files; confirm before deploying.
-- ============================================================

-- ------------------------------------------------------------
-- get_admin_review_state: admin-only read for the review-report panel.
-- Returns the private admin note; it must never be reachable by non-admins.
-- ------------------------------------------------------------
create or replace function public.get_admin_review_state(p_review_id uuid)
returns table (
  review_id uuid,
  order_id uuid,
  shop_id uuid,
  rating smallint,
  body text,
  reply_body text,
  reply_created_at timestamptz,
  reply_updated_at timestamptz,
  review_created_at timestamptz,
  removed_at timestamptz,
  image_paths text[],
  removal_public_message text,
  removal_private_note text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
begin
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'Authentication required.' using detail = 'NOT_AUTHENTICATED';
  end if;

  if not exists (select 1 from public.user_roles ur where ur.user_id = v_caller) then
    raise exception 'Admin access required.' using detail = 'NOT_ADMIN';
  end if;

  if not exists (select 1 from public.reviews r where r.id = p_review_id) then
    raise exception 'Review not found.' using detail = 'REVIEW_NOT_FOUND';
  end if;

  return query
    select
      r.id,
      r.order_id,
      r.shop_id,
      r.rating,
      r.body,
      r.reply_body,
      r.reply_created_at,
      r.reply_updated_at,
      r.created_at,
      r.removed_at,
      coalesce(
        (
          select array_agg(ri.storage_path order by ri.sort_order)
          from public.review_images ri
          where ri.review_id = r.id
        ),
        '{}'::text[]
      ),
      case when r.removed_at is null then null else (
        select a.public_message
        from public.review_moderation_actions a
        where a.review_id = r.id and a.action_type = 'review_removed'
        order by a.created_at desc, a.id desc
        limit 1
      ) end,
      case when r.removed_at is null then null else (
        select a.private_note
        from public.review_moderation_actions a
        where a.review_id = r.id and a.action_type = 'review_removed'
        order by a.created_at desc, a.id desc
        limit 1
      ) end
    from public.reviews r
    where r.id = p_review_id;
end;
$$;

revoke all on function public.get_admin_review_state(uuid) from public;
revoke all on function public.get_admin_review_state(uuid) from anon;
grant execute on function public.get_admin_review_state(uuid) to authenticated;

-- ------------------------------------------------------------
-- remove_review: hide a review from the app. Reversible.
-- ------------------------------------------------------------
create or replace function public.remove_review(
  p_review_id uuid,
  p_public_message text,
  p_private_note text default null
)
returns table (
  review_id uuid,
  removed_at timestamptz,
  was_already_removed boolean,
  audit_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_message text;
  v_note text;
  v_buyer_id uuid;
  v_shop_id uuid;
  v_order_id uuid;
  v_order_public_code text;
  v_existing_removed_at timestamptz;
  v_now timestamptz;
  v_audit_id uuid;
begin
  -- ===================== authentication + admin authorization =====================
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'Authentication required.' using detail = 'NOT_AUTHENTICATED';
  end if;

  if not exists (select 1 from public.user_roles ur where ur.user_id = v_caller) then
    raise exception 'Admin access required.' using detail = 'NOT_ADMIN';
  end if;

  -- ===================== validation (whitespace-aware trim, same rule as review body) =====================
  v_message := nullif(regexp_replace(p_public_message, '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');
  if v_message is null then
    raise exception 'A reason is required.' using detail = 'REASON_REQUIRED';
  end if;

  if char_length(v_message) > 1000 then
    raise exception 'The reason is too long.' using detail = 'REASON_TOO_LONG';
  end if;

  v_note := nullif(regexp_replace(p_private_note, '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');
  if v_note is not null and char_length(v_note) > 1000 then
    raise exception 'The note is too long.' using detail = 'NOTE_TOO_LONG';
  end if;

  -- ===================== lock the review row (serialization point) =====================
  select r.buyer_id, r.shop_id, r.order_id, r.removed_at
    into v_buyer_id, v_shop_id, v_order_id, v_existing_removed_at
    from public.reviews r
    where r.id = p_review_id
    for update;

  if not found then
    raise exception 'Review not found.' using detail = 'REVIEW_NOT_FOUND';
  end if;

  -- ===================== idempotent: already removed is a safe no-op =====================
  if v_existing_removed_at is not null then
    return query select p_review_id, v_existing_removed_at, true, null::uuid;
    return;
  end if;

  v_now := now();

  update public.reviews as r
    set removed_at = v_now
    where r.id = p_review_id;

  select o.public_code into v_order_public_code
    from public.orders o
    where o.id = v_order_id;

  insert into public.review_moderation_actions (admin_id, review_id, action_type, previous_state, new_state, public_message, private_note)
    values (v_caller, p_review_id, 'review_removed', 'visible', 'removed', v_message, v_note)
    returning id into v_audit_id;

  -- Outbox row: keyed by the audit row, so this removal is its own event.
  perform public.enqueue_email(
    'review_removed'::public.email_event_type_enum,
    v_buyer_id,
    v_audit_id,
    jsonb_build_object(
      'review_id', p_review_id,
      'order_public_code', v_order_public_code,
      'public_message', v_message
    )
  );

  -- In-app notification: actor NULL, so the admin's identity is not exposed.
  -- order_id lets get_my_notifications project the order public code, so the
  -- notification links to the buyer's order page, where the reason is shown.
  insert into public.notifications (recipient_id, type, actor_id, order_id, review_id, public_message, dedupe_key)
    select v_buyer_id, 'review_removed', null, v_order_id, p_review_id, v_message, v_audit_id::text || ':removed'
    where not exists (
      select 1 from public.profiles p where p.id = v_buyer_id and p.deleted_at is not null
    )
    on conflict on constraint notifications_recipient_type_dedupe_key do nothing;

  -- Trusted-seller eligibility depends on the visible review set.
  perform public.recalculate_trusted_seller(v_shop_id);

  return query select p_review_id, v_now, false, v_audit_id;
end;
$$;

-- Gated: no execute for any client role here. The authenticated grant is issued
-- only in 0117 (see DEPLOYMENT GATING above).
revoke all on function public.remove_review(uuid, text, text) from public;
revoke all on function public.remove_review(uuid, text, text) from anon;
revoke all on function public.remove_review(uuid, text, text) from authenticated;

-- ------------------------------------------------------------
-- restore_review: undo a removal. Restores visibility; does not change the
-- review's created_at, so the buyer's 7-day edit window and the seller's
-- 7-day reply window are not restarted.
-- ------------------------------------------------------------
create or replace function public.restore_review(
  p_review_id uuid,
  p_public_message text default null,
  p_private_note text default null
)
returns table (
  review_id uuid,
  removed_at timestamptz,
  was_already_restored boolean,
  audit_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_message text;
  v_note text;
  v_buyer_id uuid;
  v_shop_id uuid;
  v_order_id uuid;
  v_order_public_code text;
  v_existing_removed_at timestamptz;
  v_now timestamptz;
  v_audit_id uuid;
begin
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'Authentication required.' using detail = 'NOT_AUTHENTICATED';
  end if;

  if not exists (select 1 from public.user_roles ur where ur.user_id = v_caller) then
    raise exception 'Admin access required.' using detail = 'NOT_ADMIN';
  end if;

  v_message := nullif(regexp_replace(p_public_message, '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');
  if v_message is not null and char_length(v_message) > 1000 then
    raise exception 'The message is too long.' using detail = 'MESSAGE_TOO_LONG';
  end if;

  v_note := nullif(regexp_replace(p_private_note, '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');
  if v_note is not null and char_length(v_note) > 1000 then
    raise exception 'The note is too long.' using detail = 'NOTE_TOO_LONG';
  end if;

  select r.buyer_id, r.shop_id, r.order_id, r.removed_at
    into v_buyer_id, v_shop_id, v_order_id, v_existing_removed_at
    from public.reviews r
    where r.id = p_review_id
    for update;

  if not found then
    raise exception 'Review not found.' using detail = 'REVIEW_NOT_FOUND';
  end if;

  -- ===================== idempotent: already visible is a safe no-op =====================
  if v_existing_removed_at is null then
    return query select p_review_id, null::timestamptz, true, null::uuid;
    return;
  end if;

  v_now := now();

  update public.reviews as r
    set removed_at = null
    where r.id = p_review_id;

  select o.public_code into v_order_public_code
    from public.orders o
    where o.id = v_order_id;

  insert into public.review_moderation_actions (admin_id, review_id, action_type, previous_state, new_state, public_message, private_note)
    values (v_caller, p_review_id, 'review_restored', 'removed', 'visible', v_message, v_note)
    returning id into v_audit_id;

  perform public.enqueue_email(
    'review_restored'::public.email_event_type_enum,
    v_buyer_id,
    v_audit_id,
    jsonb_build_object(
      'review_id', p_review_id,
      'order_public_code', v_order_public_code,
      'public_message', v_message
    )
  );

  insert into public.notifications (recipient_id, type, actor_id, order_id, review_id, public_message, dedupe_key)
    select v_buyer_id, 'review_restored', null, v_order_id, p_review_id, v_message, v_audit_id::text || ':restored'
    where not exists (
      select 1 from public.profiles p where p.id = v_buyer_id and p.deleted_at is not null
    )
    on conflict on constraint notifications_recipient_type_dedupe_key do nothing;

  perform public.recalculate_trusted_seller(v_shop_id);

  return query select p_review_id, null::timestamptz, false, v_audit_id;
end;
$$;

-- Gated: see remove_review above.
revoke all on function public.restore_review(uuid, text, text) from public;
revoke all on function public.restore_review(uuid, text, text) from anon;
revoke all on function public.restore_review(uuid, text, text) from authenticated;

-- ------------------------------------------------------------
-- get_order_review_removal: removal status for the order's review.
-- Dual-role like get_order_review: the buyer and the shop's current owner
-- may read the status; anyone else gets zero rows, indistinguishable from an
-- order with no review. Only the buyer receives the user-facing message.
-- The private note is never returned by this function.
-- ------------------------------------------------------------
create or replace function public.get_order_review_removal(p_order_id uuid)
returns table (
  order_id uuid,
  is_removed boolean,
  removed_at timestamptz,
  public_message text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_buyer_id uuid;
  v_shop_owner_id uuid;
  v_review_id uuid;
  v_removed_at timestamptz;
  v_message text;
begin
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'Authentication required.' using detail = 'NOT_AUTHENTICATED';
  end if;

  select o.buyer_id, s.owner_id
    into v_buyer_id, v_shop_owner_id
    from public.orders o
    join public.shops s on s.id = o.shop_id
    where o.id = p_order_id;

  if not found then
    return;
  end if;

  if v_caller is distinct from v_buyer_id and v_caller is distinct from v_shop_owner_id then
    return;
  end if;

  select r.id, r.removed_at
    into v_review_id, v_removed_at
    from public.reviews r
    where r.order_id = p_order_id;

  if v_review_id is null then
    return;
  end if;

  if v_removed_at is not null and v_caller = v_buyer_id then
    select a.public_message
      into v_message
      from public.review_moderation_actions a
      where a.review_id = v_review_id and a.action_type = 'review_removed'
      order by a.created_at desc, a.id desc
      limit 1;
  end if;

  return query
    select
      p_order_id,
      v_removed_at is not null,
      v_removed_at,
      v_message;
end;
$$;

revoke all on function public.get_order_review_removal(uuid) from public;
revoke all on function public.get_order_review_removal(uuid) from anon;
grant execute on function public.get_order_review_removal(uuid) to authenticated;
