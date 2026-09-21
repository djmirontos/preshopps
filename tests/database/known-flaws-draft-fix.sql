-- Real-Postgres behavior tests for migration 0100 (Fair-condition Draft
-- fix). Run by known-flaws-draft-fix.mjs after known-flaws-draft-fix-
-- fixtures.sql. All ten cases required by LAUNCH UX S1.1 STEP 2 live here,
-- independently of the published-listing-editing.mjs/.sql suite, so this
-- fix's own coverage stays independently runnable and revertible.

set role authenticated;
set request.jwt.claim.sub='10000000-0000-0000-0000-000000000001';

-- ===================== Case 1: create a Fair Draft with blank Known Flaws succeeds =====================
select listing_id as case1_id, status as case1_status from public.create_listing(
  p_title := 'Fair draft one',
  p_listing_type := 'preloved',
  p_condition := 'fair'
) \gset

select test_assert(:'case1_status' = 'draft', 'case 1: create_listing succeeds for Fair + blank Known Flaws');
select test_assert((select known_flaws is null from public.listings where id=:'case1_id'),
  'case 1: known_flaws is stored as null, not coerced to empty text');

-- ===================== Case 2: update a Draft to Fair with blank Known Flaws succeeds =====================
select listing_id as case2_id from public.create_listing(
  p_title := 'Case two base draft',
  p_listing_type := 'preloved',
  p_condition := 'good'
) \gset

select test_assert((select condition='good' from public.listings where id=:'case2_id'),
  'case 2: base draft starts as good condition');

select public.update_listing(:'case2_id'::uuid, '{"condition":"fair"}'::jsonb);

select test_assert((select condition='fair' and known_flaws is null from public.listings where id=:'case2_id'),
  'case 2: update_listing to Fair with blank Known Flaws succeeds');

-- ===================== Case 3: update an existing Fair Draft while Known Flaws remains blank succeeds =====================
select public.update_listing(:'case2_id'::uuid, '{"description":"still drafting"}'::jsonb);

select test_assert(
  (select condition='fair' and known_flaws is null and description='still drafting'
     from public.listings where id=:'case2_id'),
  'case 3: updating an existing Fair Draft while Known Flaws remains blank succeeds');

-- ===================== Cases 4-5: publish rejects blank Known Flaws, then succeeds once supplied =====================
-- A fully publish-ready Fair Draft except for Known Flaws: real category,
-- price, stock, location, fulfillment method, and one real actual-item photo.
select listing_id as case4_id from public.create_listing(
  p_title := 'Fair draft ready except flaws',
  p_listing_type := 'preloved',
  p_condition := 'fair',
  p_category_id := (select id from public.categories where slug='women'),
  p_price_cents := 1500,
  p_stock_quantity := 2,
  p_province_id := 900001,
  p_city_id := 900001,
  p_fulfillment_methods := array['meetup']::public.fulfillment_method_enum[]
) \gset

insert into storage.objects(bucket_id,name,owner_id)
values('listing-images','10000000-0000-0000-0000-000000000001/'||:'case4_id'||'/photo1.jpg',
  '10000000-0000-0000-0000-000000000001');

select public.replace_listing_images(
  :'case4_id'::uuid,
  array['listing-images/10000000-0000-0000-0000-000000000001/'||:'case4_id'||'/photo1.jpg'],
  array[false]
);

-- Case 4: publishing that Draft fails with KNOWN_FLAWS_REQUIRED (every other
-- publish-readiness field is satisfied, isolating this one requirement).
select test_error(format('select public.publish_listing(%L)',:'case4_id'),'KNOWN_FLAWS_REQUIRED');

-- Case 5: adding nonblank Known Flaws then publishing succeeds.
select public.update_listing(:'case4_id'::uuid, '{"known_flaws":"Small scratch on the back."}'::jsonb);
select status as case5_status from public.publish_listing(:'case4_id'::uuid) \gset
select test_assert(:'case5_status' = 'available', 'case 5: publish succeeds once Known Flaws is supplied');

-- ===================== Case 6: the table CHECK itself rejects a non-Draft Fair row with blank Known Flaws =====================
-- Bypasses RLS deliberately (reset to the connecting superuser role) so this
-- isolates the raw CHECK constraint, independent of RLS or any RPC guard.
reset role;
select test_error(format('update public.listings set known_flaws=null where id=%L',:'case4_id'),'23514');
set role authenticated;
set request.jwt.claim.sub='10000000-0000-0000-0000-000000000001';

select test_assert((select known_flaws='Small scratch on the back.' from public.listings where id=:'case4_id'),
  'case 6: the rejected direct update left known_flaws untouched');

-- ===================== Case 7: update_published_listing cannot produce a blank-known-flaws Fair published listing =====================
select revision as case7_revision from public.listings where id=:'case4_id' \gset
select test_error(
  format('select public.update_published_listing(%L,%s,%L)',:'case4_id',:'case7_revision','{"known_flaws":null}'),
  'INVALID_PUBLISHED_LISTING');

-- ===================== Case 8: Paused -> Available still passes through published validation (regression, unrelated to Known Flaws) =====================
select public.update_listing_status(:'case4_id'::uuid,'paused');
select revision as case8_revision from public.listings where id=:'case4_id' \gset
-- Zero available stock is only ever allowed while Paused (validate_published_listing's own p_allow_zero relaxation).
select public.update_published_listing(:'case4_id'::uuid,:'case8_revision'::bigint,'{"available_quantity":0}'::jsonb);
select test_error(format('select public.update_listing_status(%L,''available'')',:'case4_id'),'STOCK_QUANTITY_INVALID');
select revision as case8_revision_after from public.listings where id=:'case4_id' \gset
select public.update_published_listing(:'case4_id'::uuid,:'case8_revision_after'::bigint,'{"available_quantity":2}'::jsonb);
select status as case8_status from public.update_listing_status(:'case4_id'::uuid,'available') \gset
select test_assert(:'case8_status'='available',
  'case 8: resume to Available succeeds once stock is restored, proving the shared validator still gates this transition');

-- ===================== Case 9: other condition values remain unaffected at every status =====================
select listing_id as case9_id from public.create_listing(
  p_title := 'Good condition draft',
  p_listing_type := 'preloved',
  p_condition := 'good',
  p_category_id := (select id from public.categories where slug='women'),
  p_price_cents := 800,
  p_stock_quantity := 1,
  p_province_id := 900001,
  p_city_id := 900001,
  p_fulfillment_methods := array['meetup']::public.fulfillment_method_enum[]
) \gset

insert into storage.objects(bucket_id,name,owner_id)
values('listing-images','10000000-0000-0000-0000-000000000001/'||:'case9_id'||'/photo1.jpg',
  '10000000-0000-0000-0000-000000000001');
select public.replace_listing_images(
  :'case9_id'::uuid,
  array['listing-images/10000000-0000-0000-0000-000000000001/'||:'case9_id'||'/photo1.jpg'],
  array[false]
);

select status as case9_status from public.publish_listing(:'case9_id'::uuid) \gset
select test_assert(:'case9_status'='available',
  'case 9a: a non-Fair Draft with blank Known Flaws publishes without ever needing Known Flaws');

select revision as case9_revision from public.listings where id=:'case9_id' \gset
select public.update_published_listing(:'case9_id'::uuid,:'case9_revision'::bigint,'{"known_flaws":null}'::jsonb);
select test_assert((select known_flaws is null from public.listings where id=:'case9_id'),
  'case 9b: a non-Fair published listing can freely carry blank Known Flaws -- 0100 changes nothing for other conditions');

-- ===================== Case 10: existing title-only Draft behavior remains intact =====================
select listing_id as case10_id, status as case10_status from public.create_listing(
  p_title := 'Title only draft'
) \gset
select test_assert(:'case10_status'='draft', 'case 10: a Draft with only a title still succeeds');
select test_assert(
  (select description is null and category_id is null and listing_type is null and condition is null
     and price_cents is null and province_id is null and city_id is null
     from public.listings where id=:'case10_id'),
  'case 10: every other field remains unset, exactly as before 0100');

select 'ALL 10 KNOWN-FLAWS-DRAFT-FIX CASES PASSED' as result;
