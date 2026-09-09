-- Seller Listing Management: get_my_listing, the read-side counterpart to
-- update_listing (0061) and replace_listing_images (0060). Closes the
-- confirmed gap surfaced by the prior read-only frontend-integration
-- investigation: listings/listing_images/listing_fulfillment_methods/
-- listing_vehicle_details/listing_rental_details all carry RLS enabled with
-- zero policies (0035/0055's own headers), and the only existing read RPC,
-- get_listing_detail (0036), is unusable for a seller's own Draft -- it
-- excludes status = 'draft' from its visibility gate entirely, and inner
-- joins categories/provinces/cities_municipalities, so an incomplete Draft
-- (the entire point of a Draft, per PRD 10.6) missing a category or
-- location would not be returned at all. Additive only: one new function.
-- No table, enum, RLS policy, or column is created here, and no existing
-- write RPC (create_listing/update_listing/replace_listing_images/
-- publish_listing/accept_seller_policies) is touched.
--
-- Pre-inspection findings (read-only, immediately before writing this file)
-- -----------------------------------------------------------------------
-- Migration history ends at 0062_original_price_non_negative_validation
-- (confirmed live via list_migrations, no drift). Live column names/types
-- for all five tables were queried directly via information_schema.columns
-- immediately before writing this file (not assumed from memory) --
-- confirmed exactly as 0008/0009/0055/0056/0028 left them: listings.title/
-- slug/public_code/status/is_negotiable/stock_quantity/reserved_quantity/
-- created_at/updated_at are NOT NULL; category_id/listing_type/condition/
-- price_cents/province_id/city_id/description/brand/known_flaws/
-- original_price_cents/barangay_id/meetup_note/published_at/archived_at/
-- cover_image_id are all nullable. listing_images (id, listing_id,
-- storage_path, position, is_reference_image, created_at) are all NOT
-- NULL. listing_vehicle_details/listing_rental_details: listing_id is the
-- primary key (NOT NULL); every content field is nullable except
-- listing_rental_details.availability (NOT NULL, defaults 'available') and
-- both tables' own created_at/updated_at. No get_my_listing or
-- similarly-named function exists anywhere -- clean namespace.
--
-- Auth / ownership: identical pattern to update_listing/replace_listing_images
-- -----------------------------------------------------------------------
-- auth.uid() -> caller's own shop (owner_id = v_caller) -> the listing's
-- shop_id must equal the caller's shop_id, distinguishing LISTING_NOT_FOUND
-- (row doesn't exist) from NOT_LISTING_OWNER (exists, but is not the
-- caller's), exactly the same two-code convention update_listing/
-- replace_listing_images/publish_listing already use. No FOR UPDATE: this
-- function only ever reads and never writes anything, so there is no
-- write-write race to serialize against -- locking would only add
-- unnecessary contention against the same row a concurrent write RPC might
-- be holding. No status restriction is applied (this is deliberately NOT
-- scoped to "must be draft"): the same ownership-scoped read is equally
-- correct and reusable for a future published-listing view (PRD 29.1's
-- still-deferred post-publish editing) without requiring a second RPC --
-- and the task's own requirements list no LISTING_NOT_DRAFT-style
-- restriction for this read.
--
-- Never relies on public marketplace visibility: unlike get_listing_detail,
-- there is no `status in (...)` filter and no inner join on categories/
-- provinces/cities_municipalities/barangays at all -- category_id/
-- province_id/city_id/barangay_id are returned as plain nullable ids
-- (exactly what the edit form's own already-existing reference-data
-- selects -- getCategories/getProvinces/getCitiesForProvince/
-- getBarangaysForCity -- need to resolve display names and cascade
-- selections against), never resolved to names here and never used to
-- gate whether a row is returned at all. A title-only Draft with every
-- other column null returns cleanly, with zero images and zero fulfillment
-- methods represented as empty collections, not as a missing row.
--
-- Return shape: one row, arrays/JSON for every child collection
-- -----------------------------------------------------------------------
-- A single row (this RPC is always looked up by one specific p_listing_id,
-- which is the table's own primary key) carrying every scalar
-- update_listing can write, plus three child collections shaped for
-- direct JSON consumption by a Supabase JS client, mirroring
-- get_listing_detail's own established fulfillment_methods array pattern
-- and extending it: fulfillment_methods (public.fulfillment_method_enum[],
-- the complete current set, empty array when none), images (jsonb array of
-- {id, storage_path, position, is_reference_image} objects ordered by
-- position -- position 0 is always the cover/first image by the same
-- construction replace_listing_images already guarantees, so no separate
-- "is cover" flag is needed), vehicle_details / rental_details (a single
-- jsonb object with every editable field when a matching extension row
-- exists, or SQL NULL -- not an empty object -- when it does not,
-- distinguished cleanly via a LEFT JOIN LATERAL that either produces one
-- row or zero). One RPC, not several: every child collection is resolved
-- through its own LEFT JOIN LATERAL against the single locked-down
-- p_listing_id, so this remains one query, one round trip, one ownership
-- check -- splitting images/fulfillment/vehicle/rental into separate RPCs
-- would only multiply auth/ownership-check boilerplate for a form that
-- needs all of it at once anyway.
--
-- Security: SECURITY DEFINER, set search_path = '', REVOKE ALL FROM
-- public/anon, GRANT EXECUTE TO authenticated only. Identity comes
-- exclusively from auth.uid() -- no p_user_id/p_shop_id/p_owner_id
-- parameter exists. No new RLS policy of any kind is added to any table --
-- this SECURITY DEFINER function is the sole trusted path, exactly like
-- every other listing RPC in this schema. Zero references to orders/
-- order_items/inventory_reservations.

create or replace function public.get_my_listing(
  p_listing_id uuid
)
returns table (
  listing_id uuid,
  public_code text,
  slug text,
  status public.listing_status_enum,
  title text,
  description text,
  category_id integer,
  listing_type public.listing_type_enum,
  condition public.listing_condition_enum,
  price_cents bigint,
  original_price_cents bigint,
  is_negotiable boolean,
  brand text,
  known_flaws text,
  stock_quantity integer,
  province_id integer,
  city_id integer,
  barangay_id integer,
  meetup_note text,
  created_at timestamptz,
  updated_at timestamptz,
  published_at timestamptz,
  fulfillment_methods public.fulfillment_method_enum[],
  images jsonb,
  vehicle_details jsonb,
  rental_details jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_shop_id uuid;
  v_listing_shop_id uuid;
begin
  -- ===================== authentication =====================
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'Authentication required.' using detail = 'NOT_AUTHENTICATED';
  end if;

  -- ===================== caller must own an existing shop =====================
  select s.id into v_shop_id
    from public.shops s
    where s.owner_id = v_caller;

  if not found then
    raise exception 'Create your shop first.' using detail = 'SHOP_NOT_FOUND';
  end if;

  -- ===================== listing must exist and belong to the caller's shop =====================
  select l.shop_id into v_listing_shop_id
    from public.listings l
    where l.id = p_listing_id;

  if not found then
    raise exception 'Listing not found.' using detail = 'LISTING_NOT_FOUND';
  end if;

  if v_listing_shop_id <> v_shop_id then
    raise exception 'You do not have permission to view this listing.' using detail = 'NOT_LISTING_OWNER';
  end if;

  -- ===================== full projection, every child collection via its own LEFT JOIN LATERAL =====================
  return query
    select
      l.id as listing_id,
      l.public_code,
      l.slug,
      l.status,
      l.title,
      l.description,
      l.category_id,
      l.listing_type,
      l.condition,
      l.price_cents,
      l.original_price_cents,
      l.is_negotiable,
      l.brand,
      l.known_flaws,
      l.stock_quantity,
      l.province_id,
      l.city_id,
      l.barangay_id,
      l.meetup_note,
      l.created_at,
      l.updated_at,
      l.published_at,
      coalesce(fm.methods, '{}'::public.fulfillment_method_enum[]) as fulfillment_methods,
      coalesce(imgs.images, '[]'::jsonb) as images,
      veh.details as vehicle_details,
      rent.details as rental_details
    from public.listings l
    left join lateral (
      select array_agg(lfm.method order by lfm.method) as methods
      from public.listing_fulfillment_methods lfm
      where lfm.listing_id = l.id
    ) fm on true
    left join lateral (
      select jsonb_agg(
               jsonb_build_object(
                 'id', li.id,
                 'storage_path', li.storage_path,
                 'position', li.position,
                 'is_reference_image', li.is_reference_image
               )
               order by li.position asc
             ) as images
      from public.listing_images li
      where li.listing_id = l.id
    ) imgs on true
    left join lateral (
      select jsonb_build_object(
               'brand', v.brand,
               'model', v.model,
               'year', v.year,
               'mileage_km', v.mileage_km,
               'transmission', v.transmission,
               'fuel_type', v.fuel_type,
               'registration_status', v.registration_status,
               'documents_available', to_jsonb(v.documents_available)
             ) as details
      from public.listing_vehicle_details v
      where v.listing_id = l.id
    ) veh on true
    left join lateral (
      select jsonb_build_object(
               'rental_price_cents', r.rental_price_cents,
               'rental_period', r.rental_period,
               'security_deposit_cents', r.security_deposit_cents,
               'rental_terms', r.rental_terms,
               'minimum_rental_period', r.minimum_rental_period,
               'capacity', r.capacity,
               'whats_included', r.whats_included,
               'rules_restrictions', r.rules_restrictions,
               'availability', r.availability
             ) as details
      from public.listing_rental_details r
      where r.listing_id = l.id
    ) rent on true
    where l.id = p_listing_id;
end;
$$;

revoke all on function public.get_my_listing(uuid) from public;
revoke all on function public.get_my_listing(uuid) from anon;
grant execute on function public.get_my_listing(uuid) to authenticated;
