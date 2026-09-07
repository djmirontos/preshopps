-- Marketplace media storage foundation. Creates exactly three Supabase
-- Storage buckets (listing-images, review-images, shop-images) and their
-- storage.objects RLS policies -- no application table, RPC, or existing
-- policy is touched. This is pure storage infrastructure, built ahead of
-- the listing-creation/shop-creation upload UIs (deliberately out of scope
-- here) so the already-complete Reviews module can finish its one
-- remaining piece: review photo upload.
--
-- Why this migration is needed (found during inspection, not assumed)
-- -----------------------------------------------------------------------
-- Confirmed live (immediately before writing this file, via
-- `select * from storage.buckets` and `select * from pg_policies where
-- schemaname = 'storage'`): ZERO buckets and ZERO storage.objects policies
-- exist anywhere on this project. Confirmed via full migration-file grep
-- (all 47 prior migrations): no `storage.buckets`/`storage.objects`
-- reference anywhere. `lib/marketplace/listing-image-url.ts`'s own comment
-- already documented this ("No storage bucket exists live yet ... this
-- path is currently unexercised by any real row") -- this migration
-- resolves that gap for the three media types the canonical docs already
-- require: listing photos (PRD S11, 1-8), review photos (PRD S26.3, up to
-- 2), and shop logo (PRD S6.1, optional single image). Dispute images
-- (PRD S34.2) and profile avatars are explicitly out of this task's scope
-- and get no bucket here.
--
-- Path convention -- a deliberate, reasoned deviation from
-- ARCHITECTURE.md/ARCHITECTURE_ESSENTIALS.md's illustrated paths
-- -----------------------------------------------------------------------
-- Both docs show (identically): `listing-images/{shop_id}/{listing_id}/...`,
-- `review-images/{review_id}/...`, `shop-images/{shop_id}/profile.webp`.
-- These are illustrative "Recommended storage paths" (not a locked
-- schema/RPC contract the way table/column/RPC signatures are), and two of
-- the three are confirmed infeasible as literally written:
--   1. `orders` (confirmed live: relrowsecurity = true, ZERO policies --
--      identical default-deny posture to `reviews`) cannot be queried by a
--      plain authenticated subquery from a storage policy at all -- every
--      order read goes through a SECURITY DEFINER RPC. A review-images
--      policy anchored on order/review ownership would need either a new
--      SECURITY DEFINER helper function (a bigger surface change than this
--      foundation warrants) or the RLS-visible `shops_select_owner`-style
--      row -- neither cleanly supports `review-images/{review_id}/...`
--      anyway, since **no review_id exists yet at upload time** (photos
--      must be uploaded before `create_review` is called, since it takes
--      already-existing storage paths as input).
--   2. Anchoring solely on `shop_id`/`listing_id` (no owner-user-id segment
--      at all) would require the exact same kind of cross-table
--      SECURITY-DEFINER-or-RLS-visible-row check for every one of the
--      three buckets, for no real benefit over the simpler alternative.
-- The chosen convention instead anchors every path on the **uploading
-- user's own auth.uid()** as the first segment -- exactly the shape this
-- task's own Section 3 already suggested ("{ownerUserId}/{listingId}/...",
-- "{buyerUserId}/{orderId}/...", "{ownerUserId}/{shopId}/..."). This is
-- also the standard, well-documented Supabase Storage RLS pattern
-- (`(storage.foldername(name))[1] = auth.uid()::text`), needs no new
-- SQL function, and is uniform across all three buckets:
--   listing-images/{ownerUserId}/{listingId}/{randomFileName}
--   review-images/{buyerUserId}/{orderId}/{randomFileName}
--   shop-images/{ownerUserId}/{shopId}/logo.jpg
-- The storage layer's only job is "no cross-user write/delete" -- it does
-- NOT re-verify that a given listingId/orderId/shopId is real or actually
-- owned by that business entity; that remains the job of the trusted RPC
-- that later persists the path into `listing_images`/`reviews`/`shops`
-- (create_review already does exactly this for review_images, checking
-- order ownership itself before ever storing a path).
--
-- Format: this project's client-side compressor (added alongside this
-- migration, lib/image-processing/compress-image.ts) always re-encodes to
-- image/jpeg
-- for universal browser/canvas support, so uploaded files are always
-- `.jpg` in practice -- allowed_mime_types below is a defensive allowlist
-- (image/jpeg, image/png, image/webp), not a claim that all three are
-- actively produced by this codebase today.
--
-- Size limits: chosen as a generous safety net behind client-side
-- compression (which targets a much smaller output), not as a target
-- size themselves -- 5 MB for listing/review photos, 3 MB for the single
-- shop logo. Neither is unusually high for a marketplace photo.
--
-- Visibility: all three buckets are public (`public = true`) -- listing
-- photos, review photos, and shop logos are all public marketplace content
-- per PRD (S11 listing images are shown on public listing/shop pages,
-- S26.7/S8 of the already-built Reviews module renders review photos on
-- the public shop review feed, S6.4 shop logo is shown on the public shop
-- page). Public buckets serve reads through Supabase's dedicated
-- `/object/public/...` endpoint without consulting storage.objects RLS at
-- all (confirmed Supabase Storage behavior) -- the explicit SELECT
-- policies below exist for defense-in-depth and for the authenticated
-- `.list()`/`.download()` code paths, which DO consult RLS even on a
-- public bucket.
--
-- Security: INSERT/UPDATE/DELETE are restricted to `authenticated` only,
-- gated on the caller's own auth.uid() matching the path's first segment
-- -- no anon writes, no service-role usage anywhere (bucket
-- creation/policies are pure SQL, not a service-role client call).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('listing-images', 'listing-images', true, 5242880, array['image/jpeg', 'image/png', 'image/webp']),
  ('review-images', 'review-images', true, 5242880, array['image/jpeg', 'image/png', 'image/webp']),
  ('shop-images', 'shop-images', true, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- ============================================================
-- listing-images
-- ============================================================
create policy listing_images_insert_own
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'listing-images'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy listing_images_update_own
on storage.objects for update
to authenticated
using (
  bucket_id = 'listing-images'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'listing-images'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy listing_images_delete_own
on storage.objects for delete
to authenticated
using (
  bucket_id = 'listing-images'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy listing_images_select_public
on storage.objects for select
to anon, authenticated
using (bucket_id = 'listing-images');

-- ============================================================
-- review-images
-- ============================================================
create policy review_images_insert_own
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'review-images'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy review_images_update_own
on storage.objects for update
to authenticated
using (
  bucket_id = 'review-images'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'review-images'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy review_images_delete_own
on storage.objects for delete
to authenticated
using (
  bucket_id = 'review-images'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy review_images_select_public
on storage.objects for select
to anon, authenticated
using (bucket_id = 'review-images');

-- ============================================================
-- shop-images
-- ============================================================
create policy shop_images_insert_own
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'shop-images'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy shop_images_update_own
on storage.objects for update
to authenticated
using (
  bucket_id = 'shop-images'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'shop-images'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy shop_images_delete_own
on storage.objects for delete
to authenticated
using (
  bucket_id = 'shop-images'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy shop_images_select_public
on storage.objects for select
to anon, authenticated
using (bucket_id = 'shop-images');
