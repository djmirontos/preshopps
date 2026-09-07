-- Reviews module, frontend integration read gap. Adds exactly one new
-- SECURITY DEFINER function, get_order_review -- no schema/enum change, no
-- new table, no new RLS policy, no existing function touched (create_review/
-- update_review/upsert_review_reply/get_shop_reviews/get_shop_review_summary
-- from 0034 remain byte-for-byte unchanged).
--
-- Why this migration is needed (found during inspection, not assumed)
-- -----------------------------------------------------------------------
-- 0034 built a complete review read/write surface, but every read RPC is
-- shop-scoped and public (get_shop_reviews, get_shop_review_summary) --
-- neither ever returns order_id or buyer_id (by design, for privacy), so
-- there is no existing way for the buyer's own order page to ask "does
-- order X already have a review, and if so what does it contain" (needed to
-- decide between Leave a review / View review / Edit review), nor for the
-- seller's own order page to ask "does this completed order's review need a
-- reply, and can I still edit an existing one" (needed for the seller reply
-- control). This is the same class of gap already solved twice this session
-- via the smallest safe new read-only RPC (get_my_shop_order_detail in
-- 0043; get_conversation_context in 0046) -- get_order_review follows that
-- exact precedent, and its dual-role shape (one function serving both the
-- order's buyer and its shop owner, returning zero rows for anyone else) is
-- a direct copy of get_conversation_context's own established pattern.
--
-- Pre-inspection findings (read-only, immediately before writing this file)
-- -----------------------------------------------------------------------
-- Migration history ends at 0046_messaging_read_rpcs (confirmed live via
-- list_migrations, no drift). orders.buyer_id/shop_id/status/completed_at
-- confirmed unchanged since 0034's own header (order_status_enum: pending,
-- changes_pending, accepted, ready, handed_over_or_shipped,
-- received_confirmed, completed, declined, cancelled, expired, disputed).
-- shops.owner_id confirmed unchanged. public.reviews columns confirmed
-- exactly as 0033/0034 left them: id, order_id (unique), buyer_id, shop_id,
-- rating, body, reply_body, reply_created_at, reply_updated_at, created_at,
-- updated_at. public.review_images columns confirmed exactly: id,
-- review_id, storage_path, sort_order (0/1, UNIQUE(review_id, sort_order)).
-- No function named get_order_review or similar exists -- clean namespace,
-- no collision.
--
-- Eligibility hints, not enforcement
-- -----------------------------------------------------------------------
-- can_create_review / can_edit_review / can_write_reply are UI convenience
-- hints only, computed to mirror create_review/update_review/
-- upsert_review_reply's own gating conditions as closely as a read-only
-- query can (order status + completed_at for creation eligibility; the
-- 7-day window anchored to reviews.created_at for buyer edit; the review
-- existing plus either no reply yet or its own 7-day window anchored to
-- reply_created_at for seller reply). They deliberately do NOT re-check
-- peer blocking or admin restrictions (unlike get_conversation_context's
-- can_send, which does) -- those RPCs already return specific, actionable
-- error codes (INTERACTION_BLOCKED, etc.) on an actual write attempt, and
-- computing them here as well would duplicate business logic the frontend
-- must handle correctly at write time regardless. The write RPCs remain the
-- sole source of truth; a stale/optimistic hint here can never bypass them.
--
-- Privacy: a caller who is neither the order's buyer nor its shop's current
-- owner, or a nonexistent order id, both resolve to zero rows -- the
-- frontend maps both identically to "not found", exactly mirroring
-- get_my_order_detail/get_my_shop_order_detail/get_conversation_context's
-- own established privacy pattern (never a distinguishing error that would
-- confirm the order exists to a non-participant).
--
-- Security: SECURITY DEFINER, SET search_path = '', every table reference
-- fully schema-qualified. Caller identity derived exclusively from
-- auth.uid() -- p_order_id is an opaque lookup key, not a trust claim; the
-- function re-derives buyer/seller membership from the order row itself.
-- REVOKE ALL FROM public/anon, GRANT EXECUTE TO authenticated only --
-- orders are a sign-in-only surface, matching every other order RPC.
create or replace function public.get_order_review(
  p_order_id uuid
)
returns table (
  order_id uuid,
  viewer_role text,
  review_id uuid,
  rating smallint,
  body text,
  image_paths text[],
  review_created_at timestamptz,
  review_updated_at timestamptz,
  can_create_review boolean,
  can_edit_review boolean,
  reply_body text,
  reply_created_at timestamptz,
  reply_updated_at timestamptz,
  can_write_reply boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_order_buyer_id uuid;
  v_order_shop_id uuid;
  v_order_status public.order_status_enum;
  v_order_completed_at timestamptz;
  v_shop_owner_id uuid;
  v_viewer_role text;
  v_review_id uuid;
  v_rating smallint;
  v_body text;
  v_review_created_at timestamptz;
  v_review_updated_at timestamptz;
  v_reply_body text;
  v_reply_created_at timestamptz;
  v_reply_updated_at timestamptz;
  v_image_paths text[];
  v_now timestamptz;
begin
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'Authentication required.' using detail = 'NOT_AUTHENTICATED';
  end if;

  select o.buyer_id, o.shop_id, o.status, o.completed_at
    into v_order_buyer_id, v_order_shop_id, v_order_status, v_order_completed_at
    from public.orders o
    where o.id = p_order_id;

  if not found then
    return;
  end if;

  select s.owner_id into v_shop_owner_id
    from public.shops s
    where s.id = v_order_shop_id;

  if v_caller = v_order_buyer_id then
    v_viewer_role := 'buyer';
  elsif v_caller = v_shop_owner_id then
    v_viewer_role := 'seller';
  else
    return;
  end if;

  select r.id, r.rating, r.body, r.created_at, r.updated_at, r.reply_body, r.reply_created_at, r.reply_updated_at
    into v_review_id, v_rating, v_body, v_review_created_at, v_review_updated_at, v_reply_body, v_reply_created_at, v_reply_updated_at
    from public.reviews r
    where r.order_id = p_order_id;

  if v_review_id is not null then
    select array_agg(ri.storage_path order by ri.sort_order) into v_image_paths
      from public.review_images ri
      where ri.review_id = v_review_id;
  end if;

  v_now := now();

  return query
    select
      p_order_id as order_id,
      v_viewer_role as viewer_role,
      v_review_id as review_id,
      v_rating as rating,
      v_body as body,
      coalesce(v_image_paths, '{}'::text[]) as image_paths,
      v_review_created_at as review_created_at,
      v_review_updated_at as review_updated_at,
      (
        v_viewer_role = 'buyer'
        and v_review_id is null
        and v_order_status = 'completed'
        and v_order_completed_at is not null
      ) as can_create_review,
      (
        v_viewer_role = 'buyer'
        and v_review_id is not null
        and v_now < v_review_created_at + interval '7 days'
      ) as can_edit_review,
      v_reply_body as reply_body,
      v_reply_created_at as reply_created_at,
      v_reply_updated_at as reply_updated_at,
      (
        v_viewer_role = 'seller'
        and v_review_id is not null
        and (v_reply_created_at is null or v_now < v_reply_created_at + interval '7 days')
      ) as can_write_reply;
end;
$$;

revoke all on function public.get_order_review(uuid) from public;
revoke all on function public.get_order_review(uuid) from anon;
grant execute on function public.get_order_review(uuid) to authenticated;
