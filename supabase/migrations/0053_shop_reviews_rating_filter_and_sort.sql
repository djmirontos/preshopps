-- Shop Reviews rating filter + sort (PRD 26.8). Extends the existing public
-- get_shop_reviews RPC only -- no schema/enum/RLS/trigger change, no new
-- table, no change to review write rules (create_review/update_review/
-- upsert_review_reply untouched), edit windows, notifications, storage, or
-- moderation behavior. get_shop_review_summary (the overall "★ 4.8 · 27
-- reviews" header, PRD 26.7) is also untouched -- that summary is always
-- computed over ALL of a shop's reviews regardless of the list-level filter
-- introduced here, so it must not be affected by p_rating_filter.
--
-- Pre-inspection findings (read-only, immediately before writing this file)
-- -----------------------------------------------------------------------
-- Migration history ends at 0052_ph_location_reference_data_correction
-- (confirmed live via list_migrations); this is the next migration, no
-- drift. Live get_shop_reviews signature confirmed exactly as
-- 0034 left it: (p_shop_id uuid, p_limit integer,
-- p_before_created_at timestamptz, p_before_id uuid) -- 4 parameters, no
-- rating filter, no sort mode. get_shop_review_summary confirmed unchanged
-- (p_shop_id uuid only). public.reviews confirmed unchanged since 0034's own
-- header: id, order_id (unique), buyer_id, shop_id, rating (smallint,
-- 1..5), body, reply_body, reply_created_at, reply_updated_at, created_at,
-- updated_at. Both indexes from 0033 confirmed present and reused as-is,
-- no new index needed:
--   reviews_shop_id_created_at_id_idx       (shop_id, created_at desc, id)
--   reviews_shop_id_rating_created_at_id_idx (shop_id, rating desc, created_at desc, id)
-- The second index already exactly matches the keyset this migration's new
-- "highest_rating" sort needs (shop_id -> rating desc -> created_at desc ->
-- id) -- it was already in place, unused until now.
--
-- Why get_shop_reviews is DROPPED and recreated, not simply
-- CREATE OR REPLACE'd with appended parameters
-- -----------------------------------------------------------------------
-- Postgres identifies a function by its full parameter-type signature, not
-- just its name. CREATE OR REPLACE FUNCTION with a different parameter
-- COUNT does not redefine the existing 4-parameter function in place -- it
-- creates a second, separately-overloaded function, leaving the original
-- 4-parameter version (and its grants) still callable side by side. That
-- would leave two get_shop_reviews functions in the schema, which is not
-- this project's convention (every other RPC in this schema is a single,
-- non-overloaded function) and would silently split future callers between
-- two signatures. The old 4-parameter function is therefore explicitly
-- DROPped first, then the 7-parameter version is created under the same
-- name and re-granted -- exactly one get_shop_reviews function exists
-- after this migration, matching every other RPC's convention.
--
-- Backward compatibility, precisely stated
-- -----------------------------------------------------------------------
-- The three new parameters (p_rating_filter, p_sort_mode, p_before_rating)
-- are appended after the existing four and all carry defaults reproducing
-- today's exact behavior (no filter, newest-first, no rating cursor). Every
-- existing call site in this repo (lib/reviews/get-shop-reviews.ts) invokes
-- this RPC with a named-argument object via supabase-js, not positionally,
-- so argument order/count was never load-bearing for it; that call site is
-- updated in this same task to pass the two new user-facing parameters, but
-- would have continued to work unmodified had it not been. "Backward
-- compatible" here means exactly this: any caller that omits the three new
-- arguments gets byte-identical results to the pre-existing function --
-- not that the literal old 4-argument overload continues to exist
-- alongside the new one (see above for why that would be the wrong shape
-- for this schema).
--
-- Rating filter (p_rating_filter)
-- -----------------------------------------------------------------------
-- NULL (default) = "All" = no filter, matching current behavior exactly.
-- 1..5 = exact rating match. Values outside 1..5 are rejected explicitly
-- (RATING_FILTER_INVALID) rather than silently returning zero rows, mirroring
-- every other RPC's explicit-validation-over-CHECK-constraint convention in
-- this schema (e.g. create_review's own p_rating validation).
--
-- Sort mode (p_sort_mode) and its cursor (p_before_rating)
-- -----------------------------------------------------------------------
-- 'newest' (default) = current behavior exactly: order by created_at desc,
-- id desc; cursor is (p_before_created_at, p_before_id), unchanged from
-- today. 'highest_rating' = order by rating desc, created_at desc, id desc
-- (ties broken identically to 'newest', just with rating as the leading
-- key); its keyset cursor additionally needs the last row's rating, carried
-- in the new p_before_rating parameter -- a single extra scalar, not a
-- second unrelated pagination scheme. Both branches are two-value/three-
-- value strict keyset comparisons against an index that already orders
-- rows in exactly that sequence, so pagination remains stable and
-- deterministic (no OFFSET, no possibility of skipped/duplicated rows
-- under concurrent inserts) in both modes, identical in kind to every other
-- keyset-paginated RPC in this schema. Any value other than 'newest' or
-- 'highest_rating' is rejected explicitly (SORT_MODE_INVALID).
--
-- Cursor consistency validation
-- -----------------------------------------------------------------------
-- (p_before_created_at is null) <> (p_before_id is null) is rejected exactly
-- as before, regardless of sort mode -- created_at and id always travel
-- together. When p_sort_mode = 'highest_rating' and a created_at/id cursor
-- is supplied, p_before_rating must be supplied too (and vice versa) --
-- rejected otherwise, since the highest_rating keyset predicate needs all
-- three values together to be meaningful. p_before_rating is simply ignored
-- (not required to be null, not an error if present) when p_sort_mode =
-- 'newest', so a client that always carries a full {createdAt, id, rating}
-- cursor object never needs to special-case clearing one field when the
-- viewer is in newest mode.
--
-- Privacy/security: byte-identical to 0034 -- SECURITY DEFINER,
-- set search_path = '', every table reference fully schema-qualified,
-- REVOKE ALL FROM public, GRANT EXECUTE TO anon AND authenticated (this
-- remains a public/guest-safe read, exactly as before). Never returns
-- order_id or buyer_id. No write, no RLS policy, no privilege change of any
-- kind beyond re-granting this one function under its new signature.

drop function if exists public.get_shop_reviews(uuid, integer, timestamptz, uuid);

create or replace function public.get_shop_reviews(
  p_shop_id uuid,
  p_limit integer default 20,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null,
  p_rating_filter integer default null,
  p_sort_mode text default 'newest',
  p_before_rating smallint default null
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

  if p_sort_mode is null or p_sort_mode not in ('newest', 'highest_rating') then
    raise exception 'Sort mode must be "newest" or "highest_rating".' using detail = 'SORT_MODE_INVALID';
  end if;

  if p_rating_filter is not null and (p_rating_filter < 1 or p_rating_filter > 5) then
    raise exception 'Rating filter must be between 1 and 5.' using detail = 'RATING_FILTER_INVALID';
  end if;

  if (p_before_created_at is null) <> (p_before_id is null) then
    raise exception 'Cursor values must be supplied together.' using detail = 'CURSOR_INVALID';
  end if;

  if p_sort_mode = 'highest_rating' and (p_before_created_at is not null) <> (p_before_rating is not null) then
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
      and (p_rating_filter is null or r.rating = p_rating_filter)
      and (
        (
          p_sort_mode = 'newest'
          and (
            p_before_created_at is null
            or (r.created_at, r.id) < (p_before_created_at, p_before_id)
          )
        )
        or (
          p_sort_mode = 'highest_rating'
          and (
            p_before_rating is null
            or (r.rating, r.created_at, r.id) < (p_before_rating, p_before_created_at, p_before_id)
          )
        )
      )
    order by
      case when p_sort_mode = 'highest_rating' then r.rating end desc,
      r.created_at desc,
      r.id desc
    limit p_limit;
end;
$$;

revoke all on function public.get_shop_reviews(uuid, integer, timestamptz, uuid, integer, text, smallint) from public;
grant execute on function public.get_shop_reviews(uuid, integer, timestamptz, uuid, integer, text, smallint) to anon;
grant execute on function public.get_shop_reviews(uuid, integer, timestamptz, uuid, integer, text, smallint) to authenticated;
