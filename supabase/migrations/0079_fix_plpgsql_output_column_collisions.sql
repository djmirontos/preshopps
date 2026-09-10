-- Fixes exactly five confirmed PL/pgSQL RETURNS TABLE output-column name
-- collisions, per the read-only audit accepted immediately before this
-- migration. Each of the five functions below has a `returns table (...)`
-- clause whose output column list implicitly declares a PL/pgSQL variable
-- of the same name in the function's scope; the function body then
-- referenced a real table column of that identical bare name (no table
-- alias) inside an INSERT ... RETURNING or DELETE ... WHERE, which
-- PostgreSQL's plpgsql variable-conflict resolution (the default
-- `#variable_conflict error` behavior) refuses to disambiguate, raising
-- `42702: column reference "..." is ambiguous` at call time. This was
-- proven live for bootstrap_first_super_admin (the exact call was
-- executed and failed) and confirmed by static analysis, cross-checked
-- against each function's live pg_get_functiondef body, for the other
-- four.
--
-- Pre-inspection: migration history ends at 0078_admin_role_management_
-- rpcs (confirmed live, no drift). Each of the five functions' live
-- bodies were re-fetched via pg_get_functiondef immediately before
-- writing this migration and confirmed to match the corresponding local
-- migration file exactly -- the diffs below are against that confirmed
-- live state, not a stale local copy.
--
-- Fix strategy: explicit statement-target table aliasing, not a
-- function-wide #variable_conflict pragma
-- -----------------------------------------------------------------------
-- Each offending statement's target table is given an explicit alias
-- (`insert into public.<table> as <alias> (...) ... returning
-- <alias>.<column> into ...`, or `delete from public.<table> as <alias>
-- where <alias>.<column> = ...`), and only the exact bare reference that
-- was ambiguous is qualified with that alias -- both are standard,
-- long-supported PostgreSQL syntax (confirmed against this project's live
-- Postgres 17.6; INSERT INTO ... AS alias ... RETURNING alias.col and
-- DELETE FROM ... AS alias ... WHERE alias.col = ... have been valid
-- since PG 9.5). This mirrors how every other, unaffected function in
-- this schema already resolves references -- via explicit table aliases
-- -- rather than introducing a `#variable_conflict use_column` pragma,
-- which would silently change resolution behavior for the *entire*
-- function body (including any future bare reference added later) rather
-- than fixing exactly the one proven-ambiguous statement in each
-- function. No other line in any of these five functions is touched:
-- same signature, same SECURITY DEFINER, same SET search_path = '', same
-- grants, same validation, same inserts/updates/deletes, same
-- notification/audit behavior, same return shape.

-- ============================================================
-- bootstrap_first_super_admin (0077): created_at collision
-- ============================================================
create or replace function public.bootstrap_first_super_admin(
  p_user_id uuid
)
returns table (
  user_id uuid,
  role public.user_role_enum,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_created_at timestamptz;
begin
  if exists (select 1 from public.user_roles) then
    raise exception 'Bootstrap has already been used.' using detail = 'BOOTSTRAP_ALREADY_USED';
  end if;

  if not exists (select 1 from public.profiles p where p.id = p_user_id and p.deleted_at is null) then
    raise exception 'Target user not found.' using detail = 'TARGET_USER_NOT_FOUND';
  end if;

  insert into public.user_roles as ur (user_id, role, granted_by)
    values (p_user_id, 'super_admin', null)
    returning ur.created_at into v_created_at;

  insert into public.admin_audit_logs (actor_id, target_user_id, action, previous_role, new_role, reason)
    values (null, p_user_id, 'admin_role_granted', null, 'super_admin', 'Bootstrap: first super_admin');

  return query
    select p_user_id, 'super_admin'::public.user_role_enum, v_created_at;
end;
$$;

revoke all on function public.bootstrap_first_super_admin(uuid) from public;
revoke all on function public.bootstrap_first_super_admin(uuid) from anon;
revoke all on function public.bootstrap_first_super_admin(uuid) from authenticated;
grant execute on function public.bootstrap_first_super_admin(uuid) to service_role;

-- ============================================================
-- submit_support_ticket (0069): created_at collision
-- ============================================================
create or replace function public.submit_support_ticket(
  p_category public.support_ticket_category_enum,
  p_message text
)
returns table (
  ticket_id uuid,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_caller_deleted_at timestamptz;
  v_message text;
  v_ticket_id uuid;
  v_created_at timestamptz;
begin
  -- ===================== authentication =====================
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'Authentication required.' using detail = 'NOT_AUTHENTICATED';
  end if;

  -- ===================== caller eligibility (deleted account) =====================
  select p.deleted_at into v_caller_deleted_at
    from public.profiles p
    where p.id = v_caller;

  if v_caller_deleted_at is not null then
    raise exception 'Your account cannot submit support requests.' using detail = 'INTERACTION_BLOCKED';
  end if;

  -- ===================== message validation =====================
  v_message := btrim(p_message);
  if v_message is null or char_length(v_message) = 0 then
    raise exception 'Please describe your issue.' using detail = 'MESSAGE_REQUIRED';
  end if;
  if char_length(v_message) > 2000 then
    raise exception 'Please shorten your message.' using detail = 'MESSAGE_TOO_LONG';
  end if;

  -- ===================== insert the ticket =====================
  insert into public.support_tickets as st (user_id, category, message)
    values (v_caller, p_category, v_message)
    returning st.id, st.created_at into v_ticket_id, v_created_at;

  return query
    select v_ticket_id, v_created_at;
end;
$$;

revoke all on function public.submit_support_ticket(public.support_ticket_category_enum, text) from public;
revoke all on function public.submit_support_ticket(public.support_ticket_category_enum, text) from anon;
grant execute on function public.submit_support_ticket(public.support_ticket_category_enum, text) to authenticated;

-- ============================================================
-- create_dispute (0074/0076): created_at collision -- 0076's image-path
-- hardening preserved exactly, unchanged
-- ============================================================
create or replace function public.create_dispute(
  p_order_id uuid,
  p_reason text,
  p_explanation text,
  p_image_paths text[] default '{}'::text[]
)
returns table (
  dispute_id uuid,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_deleted_at timestamptz;
  v_order_status public.order_status_enum;
  v_order_shop_id uuid;
  v_order_buyer_id uuid;
  v_shop_owner_id uuid;
  v_from_status public.order_status_enum;
  v_reason text;
  v_explanation text;
  v_image_count integer;
  v_path text;
  v_expected_prefix text;
  v_dispute_id uuid;
  v_created_at timestamptz;
  v_now timestamptz;
  v_recipient_id uuid;
  i integer;
begin
  -- ===================== authentication =====================
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'Authentication required.' using detail = 'NOT_AUTHENTICATED';
  end if;

  -- ===================== caller eligibility (deleted account) =====================
  select p.deleted_at into v_deleted_at
    from public.profiles p
    where p.id = v_caller;

  if not found or v_deleted_at is not null then
    raise exception 'Account is not available.' using detail = 'INTERACTION_BLOCKED';
  end if;

  -- ===================== lock order row (universal serialization point) =====================
  select o.status, o.shop_id, o.buyer_id
    into v_order_status, v_order_shop_id, v_order_buyer_id
    from public.orders o
    where o.id = p_order_id
    for update;

  if not found then
    raise exception 'Order not found.' using detail = 'ORDER_NOT_FOUND';
  end if;

  select s.owner_id into v_shop_owner_id
    from public.shops s
    where s.id = v_order_shop_id;

  -- ===================== authorization: caller must be the buyer or the shop owner =====================
  if v_caller <> v_order_buyer_id and v_caller <> v_shop_owner_id then
    raise exception 'You do not have permission to open a dispute on this order.' using detail = 'NOT_ORDER_PARTICIPANT';
  end if;

  -- ===================== eligibility: only an active order may be disputed (see 0074's header) =====================
  if v_order_status not in ('accepted', 'ready', 'handed_over_or_shipped', 'received_confirmed') then
    raise exception 'This order cannot be disputed right now.' using detail = 'ORDER_NOT_DISPUTABLE';
  end if;

  -- ===================== duplicate-active-dispute guard (explicit, friendly -- the unique index is the final guard) =====================
  if exists (select 1 from public.disputes d where d.order_id = p_order_id and d.status <> 'resolved') then
    raise exception 'A dispute is already open for this order.' using detail = 'DISPUTE_ALREADY_ACTIVE';
  end if;

  -- ===================== reason/explanation validation =====================
  v_reason := btrim(p_reason);
  if v_reason is null or length(v_reason) = 0 then
    raise exception 'A reason is required.' using detail = 'DISPUTE_REASON_REQUIRED';
  end if;
  if char_length(v_reason) > 200 then
    raise exception 'Please shorten the reason.' using detail = 'DISPUTE_REASON_TOO_LONG';
  end if;

  v_explanation := btrim(p_explanation);
  if v_explanation is null or length(v_explanation) = 0 then
    raise exception 'An explanation is required.' using detail = 'DISPUTE_EXPLANATION_REQUIRED';
  end if;
  if char_length(v_explanation) > 2000 then
    raise exception 'Please shorten the explanation.' using detail = 'DISPUTE_EXPLANATION_TOO_LONG';
  end if;

  -- ===================== image path validation (0..3): non-blank, exact caller/order prefix, non-empty remainder, no duplicates =====================
  -- Hardened (0076): each path must literally start with
  -- dispute-images/{auth.uid()}/{p_order_id}/ -- built here from v_caller
  -- (server-derived) and p_order_id (already confirmed above to be an
  -- order this caller participates in), never from any client-supplied
  -- identity -- followed by a non-empty remainder. This rejects any path
  -- that could not possibly be this caller's own upload for this order,
  -- without adding a storage.objects existence check (out of scope here;
  -- storage write RLS, 0073, already guarantees a real object under this
  -- exact prefix was written by this same caller). All rejections in this
  -- block share DISPUTE_IMAGE_PATH_INVALID -- a wrong-prefix path and a
  -- merely-malformed path are intentionally indistinguishable to the
  -- client, so this validation cannot be used as a cross-user existence
  -- oracle.
  v_image_count := coalesce(array_length(p_image_paths, 1), 0);

  if v_image_count > 3 then
    raise exception 'A dispute may include at most 3 images.' using detail = 'TOO_MANY_DISPUTE_IMAGES';
  end if;

  if v_image_count > 0 then
    v_expected_prefix := 'dispute-images/' || v_caller::text || '/' || p_order_id::text || '/';

    foreach v_path in array p_image_paths loop
      if v_path is null or v_path !~ '[^[:space:]]' then
        raise exception 'One or more dispute image paths are invalid.' using detail = 'DISPUTE_IMAGE_PATH_INVALID';
      end if;

      if left(v_path, char_length(v_expected_prefix)) <> v_expected_prefix then
        raise exception 'One or more dispute image paths are invalid.' using detail = 'DISPUTE_IMAGE_PATH_INVALID';
      end if;

      if char_length(v_path) <= char_length(v_expected_prefix) then
        raise exception 'One or more dispute image paths are invalid.' using detail = 'DISPUTE_IMAGE_PATH_INVALID';
      end if;
    end loop;

    if (select count(distinct u) from unnest(p_image_paths) as u) <> v_image_count then
      raise exception 'Duplicate dispute image paths are not allowed.' using detail = 'DUPLICATE_DISPUTE_IMAGE_PATH';
    end if;
  end if;

  v_from_status := v_order_status;
  v_now := now();

  -- ===================== insert the dispute (race-safe: order lock already serializes; UNIQUE is the final guard) =====================
  begin
    insert into public.disputes as d (order_id, opened_by, reason, explanation, created_at)
      values (p_order_id, v_caller, v_reason, v_explanation, v_now)
      returning d.id, d.created_at into v_dispute_id, v_created_at;
  exception
    when unique_violation then
      raise exception 'A dispute is already open for this order.' using detail = 'DISPUTE_ALREADY_ACTIVE';
  end;

  -- ===================== image rows =====================
  if v_image_count > 0 then
    for i in 1..v_image_count loop
      insert into public.dispute_images (dispute_id, storage_path)
        values (v_dispute_id, p_image_paths[i]);
    end loop;
  end if;

  -- ===================== dispute's own status timeline: null -> opened =====================
  insert into public.dispute_status_history (dispute_id, from_status, to_status, changed_by)
    values (v_dispute_id, null, 'opened', v_caller);

  -- ===================== order transitions to disputed, transactionally, history preserved =====================
  update public.orders
    set status = 'disputed',
        disputed_at = v_now
    where id = p_order_id;

  insert into public.order_status_history (order_id, from_status, to_status, changed_by, note)
    values (p_order_id, v_from_status, 'disputed', v_caller, null);

  -- ===================== notify the other participant only =====================
  v_recipient_id := case when v_caller = v_order_buyer_id then v_shop_owner_id else v_order_buyer_id end;

  insert into public.notifications (recipient_id, type, actor_id, order_id, dedupe_key)
  select v_recipient_id, 'dispute_opened', v_caller, p_order_id, v_dispute_id::text || ':opened'
  where not exists (
    select 1 from public.profiles p where p.id = v_recipient_id and p.deleted_at is not null
  )
  on conflict on constraint notifications_recipient_type_dedupe_key do nothing;

  return query
    select v_dispute_id, v_created_at;
end;
$$;

revoke all on function public.create_dispute(uuid, text, text, text[]) from public;
revoke all on function public.create_dispute(uuid, text, text, text[]) from anon;
grant execute on function public.create_dispute(uuid, text, text, text[]) to authenticated;

-- ============================================================
-- add_dispute_admin_note (0075): created_at collision
-- ============================================================
create or replace function public.add_dispute_admin_note(
  p_dispute_id uuid,
  p_note text
)
returns table (
  note_id uuid,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_note text;
  v_note_id uuid;
  v_created_at timestamptz;
begin
  -- ===================== authentication + admin authorization =====================
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'Authentication required.' using detail = 'NOT_AUTHENTICATED';
  end if;

  if not exists (select 1 from public.user_roles ur where ur.user_id = v_caller) then
    raise exception 'Admin access required.' using detail = 'NOT_ADMIN';
  end if;

  if not exists (select 1 from public.disputes d where d.id = p_dispute_id) then
    raise exception 'Dispute not found.' using detail = 'DISPUTE_NOT_FOUND';
  end if;

  v_note := btrim(p_note);
  if v_note is null or length(v_note) = 0 then
    raise exception 'A note is required.' using detail = 'NOTE_REQUIRED';
  end if;
  if char_length(v_note) > 2000 then
    raise exception 'Please shorten the note.' using detail = 'NOTE_TOO_LONG';
  end if;

  insert into public.dispute_admin_notes as dan (dispute_id, admin_id, note)
    values (p_dispute_id, v_caller, v_note)
    returning dan.id, dan.created_at into v_note_id, v_created_at;

  return query
    select v_note_id, v_created_at;
end;
$$;

revoke all on function public.add_dispute_admin_note(uuid, text) from public;
revoke all on function public.add_dispute_admin_note(uuid, text) from anon;
grant execute on function public.add_dispute_admin_note(uuid, text) to authenticated;

-- ============================================================
-- revoke_admin_role (0078): user_id collision (DELETE ... WHERE, not
-- RETURNING)
-- ============================================================
create or replace function public.revoke_admin_role(
  p_user_id uuid,
  p_reason text default null
)
returns table (
  user_id uuid,
  previous_role public.user_role_enum
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_previous_role public.user_role_enum;
  v_reason text;
  v_other_super_admin_count integer;
begin
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'Authentication required.' using detail = 'NOT_AUTHENTICATED';
  end if;

  if not exists (select 1 from public.user_roles ur where ur.user_id = v_caller and ur.role = 'super_admin') then
    raise exception 'Super admin access required.' using detail = 'NOT_SUPER_ADMIN';
  end if;

  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if v_reason is not null and char_length(v_reason) > 1000 then
    raise exception 'Please shorten the reason.' using detail = 'REASON_TOO_LONG';
  end if;

  -- ===================== lock the target's role row =====================
  select ur.role into v_previous_role
    from public.user_roles ur
    where ur.user_id = p_user_id
    for update;

  if v_previous_role is null then
    raise exception 'This user does not have an admin role.' using detail = 'TARGET_HAS_NO_ROLE';
  end if;

  -- ===================== lockout protection: never let the super_admin count reach zero =====================
  if v_previous_role = 'super_admin' then
    perform 1 from public.user_roles ur where ur.role = 'super_admin' for update;

    select count(*) into v_other_super_admin_count
      from public.user_roles ur
      where ur.role = 'super_admin' and ur.user_id <> p_user_id;

    if v_other_super_admin_count = 0 then
      raise exception 'Cannot remove the last remaining super admin.' using detail = 'LAST_SUPER_ADMIN';
    end if;
  end if;

  delete from public.user_roles as ur where ur.user_id = p_user_id;

  insert into public.admin_audit_logs (actor_id, target_user_id, action, previous_role, new_role, reason)
    values (v_caller, p_user_id, 'admin_role_revoked', v_previous_role, null, v_reason);

  return query select p_user_id, v_previous_role;
end;
$$;

revoke all on function public.revoke_admin_role(uuid, text) from public;
revoke all on function public.revoke_admin_role(uuid, text) from anon;
grant execute on function public.revoke_admin_role(uuid, text) to authenticated;
