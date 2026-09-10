-- Disputes MVP, hardening slice (security review follow-up): create_dispute
-- image path validation only. Everything else in create_dispute is
-- unchanged in meaning -- this is a CREATE OR REPLACE under the identical
-- (uuid, text, text, text[]) signature, per this project's locked "never
-- edit an already-applied migration" rule. No schema, storage policy,
-- signed-URL, or dispute-lifecycle change of any kind.
--
-- Pre-inspection: migration history ends at 0075_admin_dispute_rpcs
-- (confirmed live, no drift). create_dispute's current live body confirmed
-- exactly as 0074 left it.
--
-- What the prior review found
-- -----------------------------------------------------------------------
-- create_dispute validated only (a) count <= 3 and (b) each path being a
-- non-blank string -- it never checked that a submitted path actually
-- belonged to the caller, to this order, or to the dispute-images bucket
-- convention at all, and never rejected duplicate entries in the same
-- array. Read-time authorization was (and remains) independently enforced
-- by the dispute_images_select_participants_or_admin storage RLS policy
-- (0073), which re-derives real access from the actual path and the
-- viewer's own auth.uid() regardless of what create_dispute accepted --
-- so this gap was never a confidentiality bypass, but it let a dispute row
-- reference a path the opener never uploaded and never owned, which is a
-- real integrity/hygiene gap worth closing at the write boundary rather
-- than relying solely on storage RLS to catch it at read time.
--
-- The fix: an exact, caller/order-derived prefix requirement
-- -----------------------------------------------------------------------
-- Every path in p_image_paths must now start with exactly
-- `dispute-images/{auth.uid()}/{p_order_id}/` followed by a non-empty
-- remainder. Both auth.uid() and p_order_id are read from server-side
-- state already established earlier in this same function call (v_caller
-- from auth.uid(); p_order_id has already been confirmed, by this point in
-- the function, to be an order the caller genuinely participates in via
-- the NOT_ORDER_PARTICIPANT check above) -- no client-supplied identity of
-- any kind is trusted for this comparison. This does not add a
-- storage.objects existence check (out of scope for this slice, and
-- storage write RLS already guarantees any object that DOES exist under
-- this exact prefix was written by this same caller) -- it only rejects
-- paths that could not possibly be this caller's own upload for this
-- order, which every legitimate DisputeImagePicker upload already
-- satisfies by construction (0073's insert_own storage policy uploads to
-- exactly this prefix). A legitimate caller's real paths are therefore
-- unaffected; only spoofed/foreign/malformed paths are newly rejected.
-- Duplicate entries in the same array are also now rejected -- the prior
-- version silently allowed the same path to be inserted into
-- dispute_images multiple times.
--
-- Error codes: TOO_MANY_DISPUTE_IMAGES and DISPUTE_IMAGE_PATH_INVALID are
-- preserved exactly (same trigger conditions plus the new prefix/remainder
-- checks folded into DISPUTE_IMAGE_PATH_INVALID, since they are all "this
-- path is not acceptable" cases from the client's point of view -- no
-- extra information about *why* a path was rejected is leaked, which
-- matters here because a wrong-prefix rejection and a
-- doesn't-exist-in-storage rejection must be indistinguishable to avoid
-- turning this validation into a cross-user existence oracle. A dedicated
-- DUPLICATE_DISPUTE_IMAGE_PATH code is added only for the genuinely
-- distinct "you submitted the same path twice" case, which reveals nothing
-- about any other user's data.
--
-- Everything else -- authentication, deleted-account handling, order
-- locking, participant/eligibility/active-dispute checks,
-- reason/explanation validation, the dispute/dispute_images/
-- dispute_status_history inserts, the order -> disputed transition,
-- disputed_at, order_status_history, the dispute_opened notification, and
-- the returned (dispute_id, created_at) shape -- is byte-for-byte
-- unchanged from 0074. Grants (revoke public/anon, grant authenticated),
-- SECURITY DEFINER, and search_path = '' are also unchanged.

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
    insert into public.disputes (order_id, opened_by, reason, explanation, created_at)
      values (p_order_id, v_caller, v_reason, v_explanation, v_now)
      returning id, created_at into v_dispute_id, v_created_at;
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
