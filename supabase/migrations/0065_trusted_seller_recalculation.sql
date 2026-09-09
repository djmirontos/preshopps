-- Trusted Seller: closes the gap 0007's own header reported ("Trusted
-- Seller fields... are materialized/system-computed only. No eligibility
-- columns and no recalculation RPC exist yet (deferred, as approved)").
-- Adds exactly two new SECURITY DEFINER functions (recalculate_trusted_
-- seller, recalculate_all_trusted_sellers, both service_role-only -- never
-- callable by anon/authenticated) and re-applies CREATE OR REPLACE to
-- exactly three already-applied functions (complete_order, create_review,
-- update_review) to invoke the recalculation at the three canonically
-- relevant events. No new table, enum, column, index, or RLS policy. No
-- other function is touched -- publish_listing, update_listing_status,
-- accept_order_items, cancel_accepted_order, resolve_order_cancellation,
-- upsert_review_reply, and every other RPC remain byte-for-byte as they
-- are. shops.is_trusted_seller/trusted_seller_calculated_at (0007) are the
-- only columns written here, and only by these two new functions.
--
-- Why complete_order/create_review/update_review are not edited in place
-- -----------------------------------------------------------------------
-- All three are already applied live. Per this project's repeatedly-
-- established rule (0050/0055/0056/0058/0062's own headers for the
-- identical situation), an already-applied migration file is never edited
-- -- a correction gets its own new file, via CREATE OR REPLACE FUNCTION
-- against the identical signature. Every existing line of behavior in all
-- three functions is preserved verbatim; the only addition to each is one
-- new `perform public.recalculate_trusted_seller(<shop id>);` call, placed
-- immediately after the function's own core state mutation and before its
-- history-row/notification inserts (the same "state first, side effects
-- after" ordering each function's own body already follows). Grants for
-- all three are explicitly re-stated after each CREATE OR REPLACE, mirror-
-- ing 0058's own established convention for touching an existing
-- function's grants even though CREATE OR REPLACE never actually revokes
-- existing privileges on its own.
--
-- Pre-inspection findings (read-only, immediately before writing this file)
-- -----------------------------------------------------------------------
-- Migration history ends at 0064_seller_listing_management_rpcs (confirmed
-- live via list_migrations, no drift). shops.is_trusted_seller (boolean,
-- not null, default false) and shops.trusted_seller_calculated_at
-- (nullable timestamptz) confirmed unchanged since 0007, and confirmed by a
-- full-text search of every migration to have never once been written by
-- any function (create_shop/update_shop, 0049, explicitly never accept or
-- write either column). auth.users.email_confirmed_at (timestamptz,
-- Supabase's own standard column) confirmed live via information_schema.
-- orders.shop_id / orders.status (order_status_enum, includes 'completed')
-- confirmed unchanged since 0012/0013. reviews.shop_id / reviews.rating
-- (smallint 1-5) / reviews.order_id (unique, not null) confirmed unchanged
-- since 0033. user_restrictions.restriction_type_enum ('seller_suspended',
-- 'buyer_restricted', 'account_suspended') and .lifted_at confirmed
-- unchanged since 0004. No recalculate_trusted_seller or similarly-named
-- function exists anywhere -- clean namespace (confirmed via pg_proc).
-- complete_order/create_review/update_review re-read in full, live,
-- immediately before writing this file; the bodies reproduced below are
-- byte-for-byte identical to what is currently applied, apart from the one
-- documented addition to each (and, for update_review only, one new local
-- variable and one added column in its own initial locked-row SELECT,
-- both needed only to know which shop to recalculate).
--
-- Canonical criteria (PRD 27.2) mapped to what actually exists today
-- -----------------------------------------------------------------------
-- PRD 27.2's five criteria, and exactly how each is computed:
--   "Verified email"            -> auth.users.email_confirmed_at is not
--                                   null, for the shop owner. auth.users is
--                                   already documented (0004) as the sole
--                                   source of truth for email; this is the
--                                   first function in this schema to read
--                                   it directly, which a SECURITY DEFINER
--                                   function owned by the same role as
--                                   every other trusted RPC here is able to
--                                   do (confirmed live).
--   "At least 5 completed        -> count(*) from orders where shop_id =
--    orders"                        this shop and status = 'completed'.
--   "At least 3 verified          -> count(*) from reviews where shop_id =
--    reviews"                        this shop. No separate "verified"
--                                   flag is added or needed: create_review
--                                   (0034/0040) already requires the
--                                   underlying order to be 'completed' and
--                                   enforces exactly one review per order
--                                   (UNIQUE(order_id)) -- every review row
--                                   that can ever exist is therefore
--                                   already tied to a real completed
--                                   transaction by construction. Treating
--                                   "verified reviews" as "reviews" is not
--                                   a relaxation of canon; it is canon,
--                                   given what this schema already
--                                   guarantees at insert time.
--   "Average rating >= 4.0"      -> avg(rating) over the same review set,
--                                   identical computation to the existing
--                                   get_shop_review_summary (0034). A shop
--                                   with zero reviews naturally fails this
--                                   (coalesced to 0), which is moot anyway
--                                   since it would already fail the >= 3
--                                   reviews criterion.
--   "No active serious            -> NOT EXISTS an active
--    moderation issues"              user_restrictions row for the shop
--                                   owner with restriction_type IN
--                                   ('seller_suspended', 'account_
--                                   suspended') AND lifted_at IS NULL.
--                                   REPORTED, NOT SILENTLY DECIDED: no
--                                   reports/moderation_actions table or any
--                                   "severity" concept exists anywhere in
--                                   this schema yet (confirmed by a full-
--                                   text search) -- moderation/admin
--                                   tooling is explicitly out of this
--                                   task's scope, and out of every prior
--                                   task's scope to date. user_restrictions
--                                   (seller_suspended/account_suspended,
--                                   not buyer_restricted alone) is the
--                                   established "seller blocked from
--                                   acting" signal in this codebase
--                                   (create_listing, publish_listing,
--                                   update_listing_status all gate on the
--                                   identical predicate for
--                                   INTERACTION_BLOCKED). Using it here is
--                                   the smallest correct proxy available
--                                   today, not an invented new concept --
--                                   but it is a real judgment call, since
--                                   canon's "serious" qualifier implies a
--                                   severity distinction this schema cannot
--                                   yet express. When moderation/admin
--                                   tooling is eventually built, this
--                                   predicate is the one line to revisit.
--
-- Invocation points chosen, and one gap reported rather than worked around
-- -----------------------------------------------------------------------
-- Hooked (each is a genuine, already-existing mutation of a value this
-- calculation depends on): complete_order (completed-order count can only
-- ever change here -- no other function transitions any order to
-- 'completed'), create_review (review count and average both change),
-- update_review (average can change; PRD 26's 7-day buyer edit window
-- means a rating can move a shop across the 4.0 line after its original
-- review). NOT hooked, because no function exists anywhere in this schema
-- that would need it: email verification is entirely Supabase Auth's own
-- internal flow (no application RPC ever writes auth.users), and no RPC
-- anywhere writes user_restrictions (moderation/admin tooling that would
-- do so has never been built, per this and every prior task's explicit
-- scope boundary) or deletes/hides a review (canon: "buyer cannot directly
-- delete... admin cannot hide... admin moderation only," and no such RPC
-- exists). This is a real, reported coverage gap: a shop whose only
-- blocking factor is an unverified owner email, or an existing
-- restriction, will not be automatically re-evaluated the moment that
-- factor resolves -- it will only be re-evaluated on that shop's next
-- order completion or review event, or via the manual/bulk path below.
-- When either a future admin-restriction RPC or an auth-side hook is
-- built, invoking recalculate_trusted_seller(shop_id) from it is the
-- correct extension point.
--
-- recalculate_trusted_seller: one shop, one deterministic pass
-- -----------------------------------------------------------------------
-- Locks the shop row FOR UPDATE (the universal serialization point
-- convention used everywhere else in this schema), so two concurrent
-- recalculation triggers for the same shop (e.g. an order completing and a
-- review being edited in close succession) cannot race. Always writes both
-- is_trusted_seller (true or false -- this is how "badge may be removed if
-- seller no longer qualifies," PRD 27.3, is implemented: every invocation
-- re-evaluates all five criteria from scratch and can flip the flag either
-- direction) and trusted_seller_calculated_at (the transaction-stable
-- now(), every time -- "the last time this was actually recomputed," not
-- "the last time the value changed"). Uses the existing shops.updated_at
-- moddatetime trigger like any other UPDATE to this table; a recalculation
-- pass bumping updated_at is an accepted, harmless side effect, not
-- suppressed here (no other function in this schema has ever bypassed its
-- own table's updated_at trigger, and adding a bypass mechanism found
-- nowhere else in this codebase for this one function would be a bigger
-- change than the smallest-fix this task calls for).
--
-- recalculate_all_trusted_sellers: the backfill/recalculate-all path
-- -----------------------------------------------------------------------
-- Loops over every shop, calling recalculate_trusted_seller once per shop.
-- This migration invokes it exactly once, at the very end (below), so
-- every shop that already meets all five criteria today becomes trusted
-- immediately rather than waiting for its next qualifying event -- the
-- concrete backfill this task asks for. The function itself is left in
-- place (service_role-only, same as recalculate_trusted_seller) for reuse
-- by a future scheduled job or admin action; nothing currently invokes it
-- again after this migration's own one-time call.
--
-- Never client-writable: both new functions are REVOKE ALL FROM public,
-- anon, AND authenticated -- GRANT EXECUTE TO service_role only, the
-- identical posture complete_order (0029) already established for a
-- function meant to be invoked only from trusted, already-SECURITY-
-- DEFINER code (0044's own header documents exactly why this works: a
-- SECURITY DEFINER function executes with its owner's privileges, so
-- complete_order/create_review/update_review calling
-- public.recalculate_trusted_seller(...) internally runs as that shared
-- owner and succeeds regardless of the callee's own REVOKE ALL FROM
-- authenticated -- no authenticated or anon caller can ever invoke either
-- new function directly).
--
-- Security: every function here is SECURITY DEFINER, SET search_path = '',
-- every table reference fully schema-qualified, every column alias-
-- qualified. No client-supplied identity, timestamp, rating, or count of
-- any kind -- the only parameter either new function accepts is an opaque
-- shop id (recalculate_trusted_seller) or nothing at all (recalculate_all_
-- trusted_sellers).

-- ============================================================
-- recalculate_trusted_seller
-- ============================================================
create or replace function public.recalculate_trusted_seller(
  p_shop_id uuid
)
returns table (
  shop_id uuid,
  is_trusted_seller boolean,
  trusted_seller_calculated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid;
  v_email_confirmed_at timestamptz;
  v_completed_order_count integer;
  v_review_count integer;
  v_average_rating numeric;
  v_has_active_restriction boolean;
  v_eligible boolean;
  v_now timestamptz;
begin
  -- ===================== lock the shop row (universal serialization point) =====================
  select s.owner_id into v_owner_id
    from public.shops s
    where s.id = p_shop_id
    for update;

  if not found then
    raise exception 'Shop not found.' using detail = 'SHOP_NOT_FOUND';
  end if;

  -- ===================== verified email (auth.users is the sole source of truth for email/verification) =====================
  select u.email_confirmed_at into v_email_confirmed_at
    from auth.users u
    where u.id = v_owner_id;

  -- ===================== at least 5 completed orders (seller-side) =====================
  select count(*) into v_completed_order_count
    from public.orders o
    where o.shop_id = p_shop_id
      and o.status = 'completed';

  -- ===================== at least 3 reviews (already "verified" by construction) with average >= 4.0 =====================
  select count(*), avg(r.rating)
    into v_review_count, v_average_rating
    from public.reviews r
    where r.shop_id = p_shop_id;

  -- ===================== no active serious moderation issue (user_restrictions is the only implemented proxy today) =====================
  select exists (
    select 1 from public.user_restrictions ur
    where ur.user_id = v_owner_id
      and ur.lifted_at is null
      and ur.restriction_type in ('seller_suspended', 'account_suspended')
  ) into v_has_active_restriction;

  -- ===================== PRD 27.2: all five criteria required =====================
  v_eligible :=
    v_email_confirmed_at is not null
    and v_completed_order_count >= 5
    and v_review_count >= 3
    and coalesce(v_average_rating, 0) >= 4.0
    and not v_has_active_restriction;

  v_now := now();

  update public.shops as s
    set is_trusted_seller = v_eligible,
        trusted_seller_calculated_at = v_now
    where s.id = p_shop_id;

  return query
    select p_shop_id, v_eligible, v_now;
end;
$$;

revoke all on function public.recalculate_trusted_seller(uuid) from public;
revoke all on function public.recalculate_trusted_seller(uuid) from anon;
revoke all on function public.recalculate_trusted_seller(uuid) from authenticated;
grant execute on function public.recalculate_trusted_seller(uuid) to service_role;

-- ============================================================
-- recalculate_all_trusted_sellers
-- ============================================================
create or replace function public.recalculate_all_trusted_sellers()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shop_id uuid;
  v_count integer := 0;
begin
  for v_shop_id in select s.id from public.shops s order by s.id loop
    perform public.recalculate_trusted_seller(v_shop_id);
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.recalculate_all_trusted_sellers() from public;
revoke all on function public.recalculate_all_trusted_sellers() from anon;
revoke all on function public.recalculate_all_trusted_sellers() from authenticated;
grant execute on function public.recalculate_all_trusted_sellers() to service_role;

-- ============================================================
-- complete_order (adds the Trusted Seller recalculation call only)
-- ============================================================
create or replace function public.complete_order(p_order_id uuid)
returns table (order_id uuid, order_status public.order_status_enum, was_already_completed boolean, completed_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_status public.order_status_enum;
  v_existing_completed_at timestamptz;
  v_now timestamptz;
  v_order_buyer_id uuid;
  v_order_shop_id uuid;
  v_shop_owner_id uuid;

  v_accepted_count integer;

  v_listing_ids uuid[] := '{}';
  v_agg_qtys integer[] := '{}';
  v_new_stock integer[] := '{}';
  v_new_reserved integer[] := '{}';
  v_new_status public.listing_status_enum[] := '{}';

  v_listing_id uuid;
  v_agg_qty integer;
  v_stock_qty integer;
  v_reserved_qty integer;
  v_listing_status public.listing_status_enum;
  v_other_active_exists boolean;

  i integer;
begin
  -- ===================== lock order row (universal serialization point; service-role only, no auth.uid()) =====================
  select o.status, o.completed_at, o.buyer_id, o.shop_id
    into v_order_status, v_existing_completed_at, v_order_buyer_id, v_order_shop_id
    from public.orders o
    where o.id = p_order_id
    for update;

  if not found then
    raise exception 'Order not found.' using detail = 'ORDER_NOT_FOUND';
  end if;

  -- ===================== idempotency: already-completed is success, zero mutation, checked before any deeper lock =====================
  if v_order_status = 'completed' then
    return query
      select p_order_id, v_order_status, true, v_existing_completed_at;
    return;
  end if;

  -- ===================== only received_confirmed orders may progress to completed =====================
  if v_order_status <> 'received_confirmed' then
    raise exception 'Order is not in a state that can be completed.' using detail = 'ORDER_NOT_COMPLETABLE';
  end if;

  -- ===================== transaction-stable time, captured after eligibility, before deeper locking/mutation =====================
  v_now := now();

  -- ===================== lock this order's order_items (their locked status/quantity back every check below) =====================
  perform 1 from public.order_items oi where oi.order_id = p_order_id order by oi.id for update;

  -- ===================== at least one accepted item is required =====================
  select count(*) into v_accepted_count
    from public.order_items oi
    where oi.order_id = p_order_id and oi.status = 'accepted';

  if v_accepted_count = 0 then
    raise exception 'Order has no accepted items to complete.' using detail = 'RESERVATION_STATE_INVALID';
  end if;

  -- ===================== lock this order's active reservations =====================
  perform 1 from public.inventory_reservations ir where ir.order_id = p_order_id and ir.status = 'active' order by ir.id for update;

  -- ===================== coverage guard: every accepted item must have exactly one matching active reservation =====================
  if exists (
    select 1
    from public.order_items oi
    where oi.order_id = p_order_id
      and oi.status = 'accepted'
      and not exists (
        select 1
        from public.inventory_reservations ir
        where ir.order_item_id = oi.id
          and ir.status = 'active'
          and ir.quantity = oi.quantity
      )
  ) then
    raise exception 'An accepted item is missing a valid active reservation.' using detail = 'RESERVATION_STATE_INVALID';
  end if;

  -- ===================== consistency guard: every active reservation for this order must belong to an accepted item with matching quantity =====================
  -- ownership (order/shop/listing) is already structurally guaranteed by
  -- inventory_reservations_order_item_ownership_fkey; only status and
  -- quantity need checking here
  if exists (
    select 1
    from public.inventory_reservations ir
    join public.order_items oi on oi.id = ir.order_item_id
    where ir.order_id = p_order_id
      and ir.status = 'active'
      and (oi.status <> 'accepted' or ir.quantity <> oi.quantity)
  ) then
    raise exception 'Reservation state is inconsistent with order items.' using detail = 'RESERVATION_STATE_INVALID';
  end if;

  -- ===================== aggregate consumed quantity per listing from this order's locked active reservations =====================
  for v_listing_id, v_agg_qty in
    select ir.listing_id, sum(ir.quantity)::integer
      from public.inventory_reservations ir
      where ir.order_id = p_order_id and ir.status = 'active'
      group by ir.listing_id
      order by ir.listing_id
  loop
    v_listing_ids := v_listing_ids || v_listing_id;
    v_agg_qtys := v_agg_qtys || v_agg_qty;
  end loop;

  -- ===================== lock affected listings in deterministic order, validate arithmetic, compute resulting values =====================
  for i in 1 .. coalesce(array_length(v_listing_ids, 1), 0) loop
    select l.stock_quantity, l.reserved_quantity, l.status
      into v_stock_qty, v_reserved_qty, v_listing_status
      from public.listings l
      where l.id = v_listing_ids[i]
      for update;

    if not found then
      raise exception 'Reserved listing no longer exists.' using detail = 'RESERVATION_STATE_INVALID';
    end if;

    if v_stock_qty < v_agg_qtys[i] or v_reserved_qty < v_agg_qtys[i] then
      raise exception 'Listing stock/reserved quantity is insufficient to complete.' using detail = 'RESERVATION_STATE_INVALID';
    end if;

    if (v_stock_qty - v_agg_qtys[i]) < (v_reserved_qty - v_agg_qtys[i]) then
      raise exception 'Resulting listing quantities would be inconsistent.' using detail = 'RESERVATION_STATE_INVALID';
    end if;

    v_new_stock := v_new_stock || (v_stock_qty - v_agg_qtys[i]);
    v_new_reserved := v_new_reserved || (v_reserved_qty - v_agg_qtys[i]);

    -- status algorithm: only 'reserved' with no other order's active
    -- reservation remaining transitions to 'sold'; every other current
    -- status (available/paused/archived/sold/draft) is left untouched
    select exists (
      select 1
      from public.inventory_reservations ir2
      where ir2.listing_id = v_listing_ids[i]
        and ir2.status = 'active'
        and ir2.order_id <> p_order_id
    ) into v_other_active_exists;

    v_new_status := v_new_status || (
      case
        when v_listing_status = 'reserved' and not v_other_active_exists
          then 'sold'::public.listing_status_enum
        else v_listing_status
      end
    );
  end loop;

  -- ===================== consume this order's active reservations (the ledger is authoritative, updated before the cached aggregates) =====================
  update public.inventory_reservations ir
    set status = 'consumed',
        resolved_at = v_now
    where ir.order_id = p_order_id and ir.status = 'active';

  -- ===================== apply computed stock/reserved/status per listing =====================
  for i in 1 .. coalesce(array_length(v_listing_ids, 1), 0) loop
    update public.listings
      set stock_quantity = v_new_stock[i],
          reserved_quantity = v_new_reserved[i],
          status = v_new_status[i]
      where id = v_listing_ids[i];
  end loop;

  -- ===================== parent completion: status + lifecycle timestamp together, nothing else touched =====================
  update public.orders as o
    set status = 'completed',
        completed_at = v_now
    where o.id = p_order_id;

  -- ===================== recalculate Trusted Seller eligibility now that this shop's completed-order count may have changed =====================
  perform public.recalculate_trusted_seller(v_order_shop_id);

  -- ===================== exactly one parent history row, last mutation for late-failure rollback testability =====================
  insert into public.order_status_history (order_id, from_status, to_status, changed_by, note)
    values (p_order_id, 'received_confirmed', 'completed', null, null);

  -- ===================== notifications: both buyer and seller receive completion event =====================
  -- actor is NULL: this function has no auth.uid() (trusted/system-callable
  -- path per its own existing comment), so fabricating an actor would be
  -- incorrect rather than merely incomplete.
  select s.owner_id into v_shop_owner_id
    from public.shops s
    where s.id = v_order_shop_id;

  insert into public.notifications (recipient_id, type, actor_id, order_id, dedupe_key)
  select v_order_buyer_id, 'order_completed', null, p_order_id, p_order_id::text || ':completed'
  where not exists (
    select 1 from public.profiles p where p.id = v_order_buyer_id and p.deleted_at is not null
  )
  on conflict on constraint notifications_recipient_type_dedupe_key do nothing;

  insert into public.notifications (recipient_id, type, actor_id, order_id, dedupe_key)
  select v_shop_owner_id, 'order_completed', null, p_order_id, p_order_id::text || ':completed'
  where not exists (
    select 1 from public.profiles p where p.id = v_shop_owner_id and p.deleted_at is not null
  )
  on conflict on constraint notifications_recipient_type_dedupe_key do nothing;

  return query
    select p_order_id, 'completed'::public.order_status_enum, false, v_now;
end;
$$;

revoke all on function public.complete_order(uuid) from public;
revoke all on function public.complete_order(uuid) from anon;
revoke all on function public.complete_order(uuid) from authenticated;
grant execute on function public.complete_order(uuid) to service_role;

-- ============================================================
-- create_review (adds the Trusted Seller recalculation call only)
-- ============================================================
create or replace function public.create_review(p_order_id uuid, p_rating integer, p_body text default null, p_image_paths text[] default '{}'::text[])
returns table (review_id uuid, created_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_caller_deleted_at timestamptz;
  v_order_buyer_id uuid;
  v_order_shop_id uuid;
  v_order_status public.order_status_enum;
  v_order_completed_at timestamptz;
  v_shop_owner_id uuid;
  v_body text;
  v_image_count integer;
  v_path text;
  v_now timestamptz;
  v_review_id uuid;
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
    raise exception 'Your account cannot create reviews.' using detail = 'INTERACTION_BLOCKED';
  end if;

  -- ===================== lock order row (universal serialization point) =====================
  select o.buyer_id, o.shop_id, o.status, o.completed_at
    into v_order_buyer_id, v_order_shop_id, v_order_status, v_order_completed_at
    from public.orders o
    where o.id = p_order_id
    for update;

  if not found then
    raise exception 'Order not found.' using detail = 'ORDER_NOT_FOUND';
  end if;

  if v_order_buyer_id <> v_caller then
    raise exception 'You are not the buyer of this order.' using detail = 'NOT_ORDER_BUYER';
  end if;

  if v_order_status <> 'completed' or v_order_completed_at is null then
    raise exception 'This order is not eligible for review.' using detail = 'ORDER_NOT_REVIEWABLE';
  end if;

  -- ===================== one review per order (pre-check; UNIQUE(order_id) is the final guard) =====================
  if exists (select 1 from public.reviews r where r.order_id = p_order_id) then
    raise exception 'A review already exists for this order.' using detail = 'REVIEW_ALREADY_EXISTS';
  end if;

  -- ===================== derive current shop owner (not trusted from client) =====================
  select s.owner_id into v_shop_owner_id
    from public.shops s
    where s.id = v_order_shop_id;

  -- ===================== peer blocking, both directions -- NEW review only =====================
  if exists (
    select 1 from public.user_blocks ub
    where (ub.blocker_id = v_caller and ub.blocked_id = v_shop_owner_id)
       or (ub.blocker_id = v_shop_owner_id and ub.blocked_id = v_caller)
  ) then
    raise exception 'You cannot review this seller.' using detail = 'INTERACTION_BLOCKED';
  end if;

  -- ===================== admin restrictions -- buyer only; seller suspension does not suppress this =====================
  if exists (
    select 1 from public.user_restrictions ur
    where ur.user_id = v_caller
      and ur.lifted_at is null
      and ur.restriction_type in ('buyer_restricted', 'account_suspended')
  ) then
    raise exception 'You are not able to create reviews right now.' using detail = 'INTERACTION_BLOCKED';
  end if;

  -- ===================== rating validation (explicit; not solely relying on the CHECK) =====================
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'Rating must be between 1 and 5.' using detail = 'RATING_INVALID';
  end if;

  -- ===================== body normalization (optional; whitespace-only collapses to NULL) =====================
  v_body := nullif(regexp_replace(p_body, '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');

  if v_body is not null and char_length(v_body) > 1000 then
    raise exception 'Review text is too long.' using detail = 'REVIEW_BODY_TOO_LONG';
  end if;

  -- ===================== image path validation (0..2, complete ordered set) =====================
  v_image_count := coalesce(array_length(p_image_paths, 1), 0);

  if v_image_count > 2 then
    raise exception 'A review may have at most 2 images.' using detail = 'TOO_MANY_REVIEW_IMAGES';
  end if;

  if v_image_count > 0 then
    foreach v_path in array p_image_paths loop
      if v_path is null or v_path !~ '[^[:space:]]' then
        raise exception 'One or more review image paths are invalid.' using detail = 'REVIEW_IMAGE_PATH_INVALID';
      end if;
    end loop;
  end if;

  -- ===================== transaction-stable time, captured after all validation =====================
  v_now := now();

  -- ===================== insert the review (race-safe: order lock already serializes; UNIQUE is the final guard) =====================
  begin
    insert into public.reviews as r (order_id, buyer_id, shop_id, rating, body, created_at, updated_at)
      values (p_order_id, v_caller, v_order_shop_id, p_rating, v_body, v_now, v_now)
      returning r.id, r.created_at into v_review_id, v_created_at;
  exception
    when unique_violation then
      raise exception 'A review already exists for this order.' using detail = 'REVIEW_ALREADY_EXISTS';
  end;

  -- ===================== insert image rows, preserving array order as sort_order 0/1 =====================
  if v_image_count > 0 then
    for i in 1..v_image_count loop
      insert into public.review_images (review_id, storage_path, sort_order)
        values (v_review_id, p_image_paths[i], i - 1);
    end loop;
  end if;

  -- ===================== recalculate Trusted Seller eligibility now that this shop's review count/average may have changed =====================
  perform public.recalculate_trusted_seller(v_order_shop_id);

  -- ===================== notification: seller receives the new review =====================
  insert into public.notifications (recipient_id, type, actor_id, review_id, dedupe_key)
  select v_shop_owner_id, 'new_review', v_caller, v_review_id, v_review_id::text
  where not exists (
    select 1 from public.profiles p where p.id = v_shop_owner_id and p.deleted_at is not null
  )
  on conflict on constraint notifications_recipient_type_dedupe_key do nothing;

  return query
    select v_review_id, v_created_at;
end;
$$;

revoke all on function public.create_review(uuid, integer, text, text[]) from public;
revoke all on function public.create_review(uuid, integer, text, text[]) from anon;
grant execute on function public.create_review(uuid, integer, text, text[]) to authenticated;

-- ============================================================
-- update_review (adds one shop_id lookup + the Trusted Seller recalculation call)
-- ============================================================
create or replace function public.update_review(
  p_review_id uuid,
  p_rating integer,
  p_body text default null,
  p_image_paths text[] default '{}'::text[]
)
returns table (
  review_id uuid,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_caller_deleted_at timestamptz;
  v_review_buyer_id uuid;
  v_review_created_at timestamptz;
  v_review_shop_id uuid;
  v_body text;
  v_image_count integer;
  v_path text;
  v_now timestamptz;
  v_updated_at timestamptz;
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
    raise exception 'Your account cannot edit reviews.' using detail = 'INTERACTION_BLOCKED';
  end if;

  -- ===================== lock review row (universal serialization point) =====================
  select r.buyer_id, r.created_at, r.shop_id
    into v_review_buyer_id, v_review_created_at, v_review_shop_id
    from public.reviews r
    where r.id = p_review_id
    for update;

  if not found then
    raise exception 'Review not found.' using detail = 'REVIEW_NOT_FOUND';
  end if;

  if v_review_buyer_id <> v_caller then
    raise exception 'You are not the author of this review.' using detail = 'NOT_REVIEW_AUTHOR';
  end if;

  -- ===================== 7-day buyer edit window, anchored to reviews.created_at =====================
  if now() >= v_review_created_at + interval '7 days' then
    raise exception 'The review edit window has closed.' using detail = 'REVIEW_EDIT_WINDOW_CLOSED';
  end if;

  -- ===================== admin restrictions -- account_suspended blocks editing; buyer_restricted alone does not =====================
  if exists (
    select 1 from public.user_restrictions ur
    where ur.user_id = v_caller
      and ur.lifted_at is null
      and ur.restriction_type = 'account_suspended'
  ) then
    raise exception 'You are not able to edit reviews right now.' using detail = 'INTERACTION_BLOCKED';
  end if;

  -- ===================== rating validation (identical to create_review) =====================
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'Rating must be between 1 and 5.' using detail = 'RATING_INVALID';
  end if;

  -- ===================== body normalization (identical to create_review) =====================
  v_body := nullif(regexp_replace(p_body, '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');

  if v_body is not null and char_length(v_body) > 1000 then
    raise exception 'Review text is too long.' using detail = 'REVIEW_BODY_TOO_LONG';
  end if;

  -- ===================== image path validation (identical to create_review) =====================
  v_image_count := coalesce(array_length(p_image_paths, 1), 0);

  if v_image_count > 2 then
    raise exception 'A review may have at most 2 images.' using detail = 'TOO_MANY_REVIEW_IMAGES';
  end if;

  if v_image_count > 0 then
    foreach v_path in array p_image_paths loop
      if v_path is null or v_path !~ '[^[:space:]]' then
        raise exception 'One or more review image paths are invalid.' using detail = 'REVIEW_IMAGE_PATH_INVALID';
      end if;
    end loop;
  end if;

  -- ===================== transaction-stable time =====================
  v_now := now();

  -- ===================== update rating/body only; order_id/buyer_id/shop_id/created_at/reply_* untouched =====================
  update public.reviews as r
    set rating = p_rating,
        body = v_body,
        updated_at = v_now
    where r.id = p_review_id
    returning r.updated_at into v_updated_at;

  -- ===================== atomic image-set replacement =====================
  delete from public.review_images as ri where ri.review_id = p_review_id;

  if v_image_count > 0 then
    for i in 1..v_image_count loop
      insert into public.review_images (review_id, storage_path, sort_order)
        values (p_review_id, p_image_paths[i], i - 1);
    end loop;
  end if;

  -- ===================== recalculate Trusted Seller eligibility now that this shop's average rating may have changed =====================
  perform public.recalculate_trusted_seller(v_review_shop_id);

  return query
    select p_review_id, v_updated_at;
end;
$$;

revoke all on function public.update_review(uuid, integer, text, text[]) from public;
revoke all on function public.update_review(uuid, integer, text, text[]) from anon;
grant execute on function public.update_review(uuid, integer, text, text[]) to authenticated;

-- ============================================================
-- One-time backfill: recalculate every existing shop now, so any shop that
-- already meets all five criteria becomes trusted immediately rather than
-- waiting for its next order-completion/review event.
-- ============================================================
select public.recalculate_all_trusted_sellers();
