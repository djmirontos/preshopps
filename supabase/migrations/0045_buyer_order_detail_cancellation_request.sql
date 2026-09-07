-- Buyer Order Actions module: extends the existing public.get_my_order_detail
-- (0042) with two additional output columns so the buyer's own order detail
-- view can display a pending cancellation request and prevent the buyer
-- from submitting a duplicate one. No new table/enum/index/trigger/policy;
-- no other function touched. Mirrors the identical, already-approved
-- pattern used for the seller side (get_my_shop_order_detail, 0043) exactly,
-- for the identical reason: request_order_cancellation (0040) never
-- changes orders.status (an accepted/ready order stays accepted/ready
-- while a request is pending), so orders.status alone cannot tell the
-- buyer's own detail view "a request is already pending" -- something has
-- to expose the request row itself.
--
-- Why this migration is needed (found during inspection, not assumed)
-- -----------------------------------------------------------------------
-- Task instruction (Buyer Order Actions, section 4/5) requires: "After
-- success: refresh order detail; show that cancellation request is
-- pending" and "do not allow duplicate cancellation requests" and "clearly
-- show that it is awaiting seller review." Read-only inspection of
-- get_my_order_detail (0042_buyer_orders_read_rpcs.sql) immediately before
-- writing this migration confirmed it returns no cancellation-request
-- information at all -- there is no way for the frontend to distinguish
-- "accepted order, no pending request" from "accepted order, cancellation
-- request pending" without this data, since request_order_cancellation
-- itself never touches orders.status. This is the smallest fix that closes
-- that specific, required gap; no other order-detail behavior is touched.
--
-- Canonical-doc recheck: PRD 23.1 / ARCHITECTURE(_ESSENTIALS).md 15
-- describe the accepted-order cancellation-request flow (buyer requests,
-- seller confirms/rejects) but do not specify how the buyer's own UI
-- learns a request is pending -- that is left to implementation, same as
-- the seller side's own 0043 migration already established. Nothing here
-- invents new lifecycle rules; it only exposes existing
-- order_cancellation_requests data (0013, unchanged) to its own requester.
--
-- Shape choice, mirroring 0043 exactly: only the CURRENT PENDING request
-- (id + reason) is denormalized onto the order-level columns -- a
-- resolved (confirmed/rejected) request is NOT surfaced. This matches the
-- seller-side get_my_shop_order_detail's identical choice (that RPC also
-- only ever surfaces a pending request, never historical ones), keeps the
-- return contract minimal, and is sufficient for both required behaviors:
-- duplicate prevention (a pending id present means the button is hidden)
-- and "reflect the canonical order/request state after refresh" (once a
-- request is resolved, whether confirmed or rejected, the pending id
-- reverts to NULL and the order's own live status -- 'cancelled' if
-- confirmed, unchanged accepted/ready if rejected -- is what the buyer
-- sees, with no separate rejection-notice UI invented here).
--
-- Pre-inspection findings (read-only, immediately before writing this
-- file)
-- -----------------------------------------------------------------------
-- Migration history ends at 0044_confirm_order_received_auto_complete
-- (confirmed live, no drift); this is the next migration.
-- order_cancellation_requests (0013, unchanged) columns confirmed: id,
-- order_id, requested_by, status (cancellation_request_status_enum:
-- pending/confirmed/rejected), reason, reviewed_by, review_note,
-- requested_at, reviewed_at. order_cancellation_requests_one_pending_per_
-- order (0013) is a partial unique index on (order_id) where status =
-- 'pending' -- at most one pending request can ever exist per order, so a
-- scalar (non-array) left join is always safe, identical to 0043's own
-- reasoning. Postgres does not allow CREATE OR REPLACE FUNCTION to change
-- an existing function's RETURNS TABLE column list -- the function is
-- therefore dropped and recreated in this migration, not merely replaced;
-- its name, parameter signature, security/search_path settings, and
-- grants are otherwise unchanged.
--
-- Security: SECURITY DEFINER, SET search_path = '', every table reference
-- fully schema-qualified, every column alias-qualified (o., oi., ocr.).
-- REVOKE ALL FROM public/anon, GRANT EXECUTE TO authenticated only --
-- unchanged from 0042. The added left join is scoped by both
-- ocr.order_id = o.id and ocr.status = 'pending' -- it can only ever
-- surface a request belonging to the exact order already scoped to
-- o.buyer_id = v_caller_id by the function's own WHERE clause; no new way
-- to read another buyer's data is introduced.

drop function if exists public.get_my_order_detail(text);

create function public.get_my_order_detail(
  p_public_code text
)
returns table (
  order_id uuid,
  order_public_code text,
  shop_id uuid,
  shop_slug text,
  shop_name text,
  status public.order_status_enum,
  fulfillment_method public.fulfillment_method_enum,
  buyer_note text,
  created_at timestamptz,
  pending_cancellation_request_id uuid,
  pending_cancellation_reason text,
  order_item_id uuid,
  listing_id uuid,
  listing_public_code_snapshot text,
  listing_title_snapshot text,
  listing_cover_image_snapshot_path text,
  item_quantity integer,
  item_price_cents_snapshot bigint,
  item_status public.order_item_status_enum
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_id uuid;
  v_deleted_at timestamptz;
begin
  v_caller_id := auth.uid();
  if v_caller_id is null then
    raise exception 'Authentication required.' using detail = 'NOT_AUTHENTICATED';
  end if;

  select p.deleted_at into v_deleted_at
    from public.profiles p
    where p.id = v_caller_id;

  if not found or v_deleted_at is not null then
    return;
  end if;

  return query
    select
      o.id as order_id,
      o.public_code as order_public_code,
      s.id as shop_id,
      s.slug as shop_slug,
      oi.shop_name_snapshot as shop_name,
      o.status,
      o.fulfillment_method,
      o.buyer_note,
      o.created_at,
      ocr.id as pending_cancellation_request_id,
      ocr.reason as pending_cancellation_reason,
      oi.id as order_item_id,
      oi.listing_id,
      oi.listing_public_code_snapshot,
      oi.listing_title_snapshot,
      oi.listing_cover_image_snapshot_path,
      oi.quantity as item_quantity,
      oi.price_cents_snapshot as item_price_cents_snapshot,
      oi.status as item_status
    from public.orders o
    join public.order_items oi on oi.order_id = o.id
    join public.shops s on s.id = o.shop_id
    left join public.order_cancellation_requests ocr
      on ocr.order_id = o.id and ocr.status = 'pending'
    where o.buyer_id = v_caller_id
      and o.public_code = p_public_code
    order by oi.created_at asc, oi.id asc;
end;
$$;

revoke all on function public.get_my_order_detail(text) from public;
revoke all on function public.get_my_order_detail(text) from anon;
grant execute on function public.get_my_order_detail(text) to authenticated;
