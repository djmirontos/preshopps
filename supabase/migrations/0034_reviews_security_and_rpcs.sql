-- Reviews module, security and RPCs. Finishes the MVP Reviews backend on top
-- of 0033_reviews_schema (which created public.reviews / public.review_images
-- schema-only, RLS auto-enabled, zero policies). This migration adds exactly
-- five SECURITY DEFINER functions and their privilege grants -- no new
-- tables, policies, indexes, triggers, or enum changes.
--
-- Pre-inspection findings (read-only, immediately before writing this file)
-- -----------------------------------------------------------------------
-- Migration history ends at 0033_reviews_schema; this is the next migration,
-- no drift. public.reviews and public.review_images exist exactly as applied
-- in 0033 (all constraints/indexes re-read and confirmed unchanged: FKs
-- RESTRICT on order_id/buyer_id/shop_id, CASCADE on review_images.review_id,
-- reviews_rating_check (1..5), reviews_body_check (whitespace-aware, <=1000),
-- reviews_reply_body_check (same shape), the two reply-pair consistency
-- checks, review_images_sort_order_check (0..1),
-- review_images_review_id_sort_order_key UNIQUE, review_images_storage_path
-- whitespace-aware check, and the exact six indexes from 0033). No
-- review_replies table exists. RLS is enabled on both review tables
-- (relrowsecurity = true, relforcerowsecurity = false) with zero policies on
-- either. No function whose name matches '%review%' or '%rating%' exists
-- anywhere in the public schema -- clean namespace, no collision.
--
-- orders.buyer_id / orders.shop_id: uuid not null, FK RESTRICT to
-- profiles(id) / shops(id) respectively. orders.status is order_status_enum
-- (pending, changes_pending, accepted, ready, handed_over_or_shipped,
-- received_confirmed, completed, declined, cancelled, expired, disputed).
-- orders.completed_at: timestamptz, nullable. order_items snapshot columns
-- confirmed unchanged: listing_title_snapshot, listing_public_code_snapshot,
-- price_cents_snapshot, shop_name_snapshot, listing_cover_image_snapshot_path
-- (nullable), quantity, status (order_item_status_enum: pending, accepted,
-- declined). shops.owner_id: uuid not null. profiles.deleted_at: timestamptz,
-- nullable. user_blocks(blocker_id, blocked_id, created_at), both FK
-- RESTRICT to profiles. user_restrictions(user_id, restriction_type,
-- lifted_at, ...), restriction_type_enum: seller_suspended, buyer_restricted,
-- account_suspended -- all exactly as used by the existing messaging RPCs.
--
-- Canonical requirements reconfirmed against PRD.md / ARCHITECTURE.md /
-- CLAUDE.md / AGENTS.md: seller-focused review (not product-scored);
-- completed-order buyer only; one review per completed order; 1-5 stars;
-- PRD 26.3 lists "short written review" alongside "up to 2 review photos"
-- using parallel "supports" phrasing for both -- neither is stated as
-- mandatory the way "one review per completed order" is -- so review text
-- remains optional, matching 0033's own nullable body column and the prior
-- design-analysis decision; up to 2 review photos; purchased item reference;
-- buyer may edit for 7 days after posting, read-only after; buyer cannot
-- directly delete; seller may reply once, editable 7 days; blocking prevents
-- new reviews while existing review/history remains preserved (PRD S30).
-- No live/canonical assumption differed from the approved design -- proceeding
-- as instructed, no STOP triggered.
--
-- RLS / write-model
-- -----------------------------------------------------------------------
-- reviews and review_images get ZERO direct client policies of any kind, in
-- either direction (SELECT/INSERT/UPDATE/DELETE), for both anon and
-- authenticated. This is a deliberate departure from messaging's
-- participant-RLS model: reviews rows carry order_id/buyer_id/shop_id, which
-- public clients have no legitimate reason to read directly, and every
-- mutation must pass through business-rule validation (order eligibility,
-- edit windows, blocking) that only a trusted function can enforce. RLS stays
-- enabled (already true from 0033's auto-enable) with a default-deny policy
-- set; all reads go through get_shop_reviews / get_shop_review_summary
-- (safe public projections), and all writes go through create_review /
-- update_review / upsert_review_reply. No table policy of any kind is added
-- here.
--
-- Timestamp semantics
-- -----------------------------------------------------------------------
-- reviews carries the existing 0033 set_updated_at/moddatetime trigger.
-- upsert_review_reply's UPDATE statements therefore also advance
-- reviews.updated_at, exactly like a buyer edit would. reviews.updated_at is
-- not a canonical/PRD-defined concept (the PRD never surfaces "review last
-- modified" as a product concept) -- it is purely an internal "row last
-- touched" convention identical to every other updated_at column in this
-- schema, so a seller-reply write legitimately advancing it creates no
-- semantic conflict with any documented behavior. Not stopping, proceeding
-- as instructed.
--
-- Deleted-profile write-gate (authorization consistency, not a new product
-- feature): create_review, update_review, and upsert_review_reply all check
-- the authenticated caller's own public.profiles.deleted_at immediately
-- after resolving auth.uid(), before any further lookup or mutation, and
-- reject with the existing INTERACTION_BLOCKED code (no new error code) when
-- deleted_at is not null. A soft-deleted/anonymized account must not
-- continue creating or modifying user-generated marketplace interactions if
-- an authenticated session somehow still exists. This does not affect
-- read/history behavior: get_shop_reviews still returns reviews authored
-- before a profile's deletion, anonymized as 'Deleted user' -- soft deletion
-- gates future writes by that account, it does not hide past history.

-- ============================================================
-- create_review
-- ============================================================
-- Buyer-only creation of a verified review for a completed order. buyer_id
-- and shop_id are always derived from the locked order row, never trusted
-- from the client. Peer blocking (both directions, buyer <-> current shop
-- owner) blocks NEW review creation per PRD S30; existing history is
-- unaffected because this path only ever creates, never reads/hides prior
-- rows. Seller admin restrictions (seller_suspended/account_suspended) do
-- NOT block buyer review creation -- a suspended seller should not become
-- unreviewable for an already-completed transaction; only the buyer's own
-- buyer_restricted/account_suspended restrictions block creation, mirroring
-- messaging's existing caller-side restriction checks. UNIQUE(order_id) is
-- the final race guard behind an explicit pre-check; the order row is locked
-- FOR UPDATE first (universal lock-order convention), which already
-- serializes concurrent create_review calls for the same order.
create or replace function public.create_review(
  p_order_id uuid,
  p_rating integer,
  p_body text default null,
  p_image_paths text[] default '{}'::text[]
)
returns table (
  review_id uuid,
  created_at timestamptz
)
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

  return query
    select v_review_id, v_created_at;
end;
$$;

revoke all on function public.create_review(uuid, integer, text, text[]) from public;
revoke all on function public.create_review(uuid, integer, text, text[]) from anon;
grant execute on function public.create_review(uuid, integer, text, text[]) to authenticated;

-- ============================================================
-- update_review
-- ============================================================
-- Buyer-only edit of their own review within the 7-day window anchored to
-- reviews.created_at (never order.completed_at). The caller's own
-- profiles.deleted_at is checked immediately after authentication (same
-- authorization-consistency rule as create_review): a soft-deleted account
-- must not continue modifying content even inside an already-earned edit
-- window. Peer blocking is deliberately NOT re-checked here: canon blocks
-- NEW reviews, and editing an already-existing review inside its
-- already-earned correction window is not creation of a new/second review.
-- account_suspended blocks editing; buyer_restricted alone does not, since it
-- governs new marketplace actions (order requests, new reviews) rather than
-- erasing a limited correction window on content the buyer already
-- legitimately posted. order_id, buyer_id, shop_id, created_at, and every
-- reply_* column are structurally untouched by this function's UPDATE
-- statement.
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
  select r.buyer_id, r.created_at
    into v_review_buyer_id, v_review_created_at
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

  return query
    select p_review_id, v_updated_at;
end;
$$;

revoke all on function public.update_review(uuid, integer, text, text[]) from public;
revoke all on function public.update_review(uuid, integer, text, text[]) from anon;
grant execute on function public.update_review(uuid, integer, text, text[]) to authenticated;

-- ============================================================
-- upsert_review_reply
-- ============================================================
-- Current-shop-owner-only create/edit of the single public reply on a
-- review. The caller's own profiles.deleted_at is checked immediately after
-- authentication (same authorization-consistency rule as create_review /
-- update_review): a soft-deleted seller account must not continue creating
-- or editing replies. A reply is a new/continuing interpersonal interaction,
-- so peer blocking (both directions, review.buyer_id <-> caller) is checked
-- for BOTH first reply and every edit -- unlike update_review's deliberate
-- omission, because a reply is an active outbound act toward the buyer each
-- time, never a private correction of the seller's own already-posted
-- content. seller_suspended/account_suspended on the caller blocks both
-- creation and editing. Buyer-side admin restrictions are deliberately NOT
-- inspected here -- peer blocking already governs user-to-user interaction
-- control, and the buyer is not the actor performing this write. First reply
-- may be posted at any time after the review exists (not limited by the
-- review's own 7-day window); reply_created_at is fixed at first creation and
-- reply_updated_at stays NULL until a genuine second edit, matching the
-- timestamp semantic locked for 0033. Edits are allowed for 7 days from
-- reply_created_at.
create or replace function public.upsert_review_reply(
  p_review_id uuid,
  p_body text
)
returns table (
  review_id uuid,
  reply_created_at timestamptz,
  reply_updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_caller_deleted_at timestamptz;
  v_review_buyer_id uuid;
  v_review_shop_id uuid;
  v_existing_reply_created_at timestamptz;
  v_shop_owner_id uuid;
  v_body text;
  v_now timestamptz;
  v_reply_created_at timestamptz;
  v_reply_updated_at timestamptz;
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
    raise exception 'Your account cannot reply to reviews.' using detail = 'INTERACTION_BLOCKED';
  end if;

  -- ===================== lock review row (universal serialization point) =====================
  select r.buyer_id, r.shop_id, r.reply_created_at
    into v_review_buyer_id, v_review_shop_id, v_existing_reply_created_at
    from public.reviews r
    where r.id = p_review_id
    for update;

  if not found then
    raise exception 'Review not found.' using detail = 'REVIEW_NOT_FOUND';
  end if;

  -- ===================== caller must be the shop's current owner =====================
  select s.owner_id into v_shop_owner_id
    from public.shops s
    where s.id = v_review_shop_id;

  if v_shop_owner_id is null or v_shop_owner_id <> v_caller then
    raise exception 'You are not the seller for this review.' using detail = 'NOT_REVIEW_SELLER';
  end if;

  -- ===================== peer blocking, both directions -- applies to first reply AND every edit =====================
  if exists (
    select 1 from public.user_blocks ub
    where (ub.blocker_id = v_caller and ub.blocked_id = v_review_buyer_id)
       or (ub.blocker_id = v_review_buyer_id and ub.blocked_id = v_caller)
  ) then
    raise exception 'You cannot reply to this review.' using detail = 'INTERACTION_BLOCKED';
  end if;

  -- ===================== seller admin restrictions -- applies to first reply AND every edit =====================
  if exists (
    select 1 from public.user_restrictions ur
    where ur.user_id = v_caller
      and ur.lifted_at is null
      and ur.restriction_type in ('seller_suspended', 'account_suspended')
  ) then
    raise exception 'You are not able to reply to reviews right now.' using detail = 'INTERACTION_BLOCKED';
  end if;

  -- ===================== body normalization (required, non-blank) =====================
  v_body := nullif(regexp_replace(p_body, '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');

  if v_body is null then
    raise exception 'Reply cannot be empty.' using detail = 'REPLY_EMPTY';
  end if;

  if char_length(v_body) > 1000 then
    raise exception 'Reply is too long.' using detail = 'REPLY_TOO_LONG';
  end if;

  -- ===================== transaction-stable time =====================
  v_now := now();

  if v_existing_reply_created_at is null then
    -- ===================== first reply: reply_created_at fixed now, reply_updated_at stays NULL =====================
    update public.reviews as r
      set reply_body = v_body,
          reply_created_at = v_now,
          reply_updated_at = null
      where r.id = p_review_id
      returning r.reply_created_at, r.reply_updated_at into v_reply_created_at, v_reply_updated_at;
  else
    -- ===================== edit: 7-day window anchored to the existing reply_created_at =====================
    if v_now >= v_existing_reply_created_at + interval '7 days' then
      raise exception 'The reply edit window has closed.' using detail = 'REPLY_EDIT_WINDOW_CLOSED';
    end if;

    update public.reviews as r
      set reply_body = v_body,
          reply_updated_at = v_now
      where r.id = p_review_id
      returning r.reply_created_at, r.reply_updated_at into v_reply_created_at, v_reply_updated_at;
  end if;

  return query
    select p_review_id, v_reply_created_at, v_reply_updated_at;
end;
$$;

revoke all on function public.upsert_review_reply(uuid, text) from public;
revoke all on function public.upsert_review_reply(uuid, text) from anon;
grant execute on function public.upsert_review_reply(uuid, text) to authenticated;

-- ============================================================
-- get_shop_reviews
-- ============================================================
-- Public/guest-safe projection of a shop's reviews. Never returns order_id,
-- buyer_id, or any internal ownership identifier. Buyer identity is joined
-- from profiles and anonymized when profiles.deleted_at is not null (no
-- other exact deleted-user label is specified anywhere in the canonical
-- docs, so the literal 'Deleted user' string from the task brief is used).
-- Images are aggregated ordered by sort_order ascending. Purchased-item
-- context is derived from order_items filtered to status = 'accepted' only
-- (declined/pending line items were never fulfilled), ordered by
-- order_items.id per the locked design. Newest-first pagination uses a
-- (created_at, id) DESC/DESC keyset cursor against the existing
-- reviews_shop_id_created_at_id_idx index -- no OFFSET.
create or replace function public.get_shop_reviews(
  p_shop_id uuid,
  p_limit integer default 20,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null
)
returns table (
  review_id uuid,
  rating smallint,
  body text,
  created_at timestamptz,
  updated_at timestamptz,
  buyer_display_name text,
  buyer_avatar_storage_path text,
  reply_body text,
  reply_created_at timestamptz,
  reply_updated_at timestamptz,
  image_paths text[],
  purchased_item_titles text[]
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.shops s where s.id = p_shop_id) then
    raise exception 'Shop not found.' using detail = 'SHOP_NOT_FOUND';
  end if;

  if p_limit is null or p_limit < 1 or p_limit > 50 then
    raise exception 'Limit must be between 1 and 50.' using detail = 'LIMIT_INVALID';
  end if;

  if (p_before_created_at is null) <> (p_before_id is null) then
    raise exception 'Cursor values must be supplied together.' using detail = 'CURSOR_INVALID';
  end if;

  return query
    select
      r.id as review_id,
      r.rating,
      r.body,
      r.created_at,
      r.updated_at,
      case when p.deleted_at is null then p.display_name else 'Deleted user' end as buyer_display_name,
      case when p.deleted_at is null then p.avatar_storage_path else null end as buyer_avatar_storage_path,
      r.reply_body,
      r.reply_created_at,
      r.reply_updated_at,
      coalesce(img.image_paths, '{}'::text[]) as image_paths,
      coalesce(items.purchased_item_titles, '{}'::text[]) as purchased_item_titles
    from public.reviews r
    join public.profiles p on p.id = r.buyer_id
    left join lateral (
      select array_agg(ri.storage_path order by ri.sort_order) as image_paths
      from public.review_images ri
      where ri.review_id = r.id
    ) img on true
    left join lateral (
      select array_agg(oi.listing_title_snapshot order by oi.id) as purchased_item_titles
      from public.order_items oi
      where oi.order_id = r.order_id and oi.status = 'accepted'
    ) items on true
    where r.shop_id = p_shop_id
      and (
        p_before_created_at is null
        or (r.created_at, r.id) < (p_before_created_at, p_before_id)
      )
    order by r.created_at desc, r.id desc
    limit p_limit;
end;
$$;

revoke all on function public.get_shop_reviews(uuid, integer, timestamptz, uuid) from public;
grant execute on function public.get_shop_reviews(uuid, integer, timestamptz, uuid) to anon;
grant execute on function public.get_shop_reviews(uuid, integer, timestamptz, uuid) to authenticated;

-- ============================================================
-- get_shop_review_summary
-- ============================================================
-- Public/guest-safe live aggregate: total verified review count and average
-- rating for a shop. No cached column is read or written -- shops.rating
-- aggregates do not exist and are not added; count(*)/avg(rating) are
-- computed directly from public.reviews on every call, matching the MVP
-- performance guidance not to prematurely cache dynamic data. avg() over
-- zero matching rows naturally returns NULL and count(*) naturally returns
-- 0, giving exactly "review_count = 0, average_rating = NULL" for a shop
-- with no reviews without any special-case branching.
create or replace function public.get_shop_review_summary(
  p_shop_id uuid
)
returns table (
  review_count bigint,
  average_rating numeric
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.shops s where s.id = p_shop_id) then
    raise exception 'Shop not found.' using detail = 'SHOP_NOT_FOUND';
  end if;

  return query
    select
      count(*) as review_count,
      avg(r.rating)::numeric as average_rating
    from public.reviews r
    where r.shop_id = p_shop_id;
end;
$$;

revoke all on function public.get_shop_review_summary(uuid) from public;
grant execute on function public.get_shop_review_summary(uuid) to anon;
grant execute on function public.get_shop_review_summary(uuid) to authenticated;
