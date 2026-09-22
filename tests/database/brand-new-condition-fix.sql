-- Real-Postgres behavior tests for migration 0101 (Brand New condition
-- auto-assignment fix). Run by brand-new-condition-fix.mjs after
-- brand-new-condition-fix-fixtures.sql. All cases required by the
-- "Brand New publication blocker" fix task live here, independently of
-- published-listing-editing.mjs/.sql and known-flaws-draft-fix.mjs/.sql,
-- so this fix's own coverage stays independently runnable and revertible.

set role authenticated;
set request.jwt.claim.sub='10000000-0000-0000-0000-000000000001';

-- ===================== Case 1: create_listing derives brand_new for an omitted/NULL condition =====================
select listing_id as case1_id from public.create_listing(
  p_title := 'Brand new sealed box',
  p_listing_type := 'brand_new'
) \gset

select test_assert((select condition='brand_new' from public.listings where id=:'case1_id'),
  'case 1: create_listing derives condition=brand_new when listing_type=brand_new and condition is omitted');

-- ===================== Case 2: update_listing derives brand_new for a resolved NULL condition =====================
select listing_id as case2_id from public.create_listing(
  p_title := 'Case two base draft',
  p_listing_type := 'preloved',
  p_condition := 'good'
) \gset

select public.update_listing(:'case2_id'::uuid, '{"listing_type":"brand_new","condition":null}'::jsonb);

select test_assert((select listing_type='brand_new' and condition='brand_new' from public.listings where id=:'case2_id'),
  'case 2: update_listing derives condition=brand_new when the resolved listing_type is brand_new and the resolved condition is NULL');

-- ===================== Case 3: create_listing still rejects an explicit, incompatible condition =====================
select test_error(
  'select public.create_listing(p_title:=''Bad pair'',p_listing_type:=''brand_new'',p_condition:=''fair'')',
  'LISTING_TYPE_CONDITION_MISMATCH');

-- ===================== Case 4: update_listing still rejects an explicit, incompatible condition =====================
select test_error(
  format('select public.update_listing(%L::uuid, ''{"condition":"fair"}''::jsonb)',:'case2_id'),
  'LISTING_TYPE_CONDITION_MISMATCH');
-- The rejected attempt must not have silently partially applied.
select test_assert((select condition='brand_new' from public.listings where id=:'case2_id'),
  'case 4: the rejected update left condition unchanged at brand_new');

-- ===================== Case 5: Pre-loved + explicit Brand New condition remains rejected (both RPCs) =====================
select test_error(
  'select public.create_listing(p_title:=''Bad pair 2'',p_listing_type:=''preloved'',p_condition:=''brand_new'')',
  'LISTING_TYPE_CONDITION_MISMATCH');

select listing_id as case5_id from public.create_listing(
  p_title := 'Preloved base for case 5',
  p_listing_type := 'preloved',
  p_condition := 'good'
) \gset
select test_error(
  format('select public.update_listing(%L::uuid, ''{"condition":"brand_new"}''::jsonb)',:'case5_id'),
  'LISTING_TYPE_CONDITION_MISMATCH');

-- ===================== Case 6: incomplete Pre-loved Drafts remain saveable (unaffected regression) =====================
select listing_id as case6_id, status as case6_status from public.create_listing(
  p_title := 'Title only draft'
) \gset
select test_assert(:'case6_status'='draft', 'case 6: a title-only Draft still succeeds');
select test_assert(
  (select description is null and category_id is null and listing_type is null and condition is null
     from public.listings where id=:'case6_id'),
  'case 6: every other field remains unset, exactly as before 0101');

-- ===================== Case 7: Fair without Known Flaws still fails publication (unaffected regression) =====================
select listing_id as case7_id from public.create_listing(
  p_title := 'Fair no flaws',
  p_listing_type := 'preloved',
  p_condition := 'fair',
  p_category_id := (select id from public.categories where slug='women'),
  p_price_cents := 1000,
  p_stock_quantity := 1,
  p_province_id := 900001,
  p_city_id := 900001,
  p_fulfillment_methods := array['meetup']::public.fulfillment_method_enum[]
) \gset

insert into storage.objects(bucket_id,name,owner_id)
values('listing-images','10000000-0000-0000-0000-000000000001/'||:'case7_id'||'/photo1.jpg',
  '10000000-0000-0000-0000-000000000001');
select public.replace_listing_images(
  :'case7_id'::uuid,
  array['listing-images/10000000-0000-0000-0000-000000000001/'||:'case7_id'||'/photo1.jpg'],
  array[false]
);

select test_error(format('select public.publish_listing(%L)',:'case7_id'),'KNOWN_FLAWS_REQUIRED');

-- ===================== Case 8: a legacy Brand New Draft with a NULL condition (created before this fix existed) =====================
-- Fabricated directly as the connecting role, bypassing create_listing/
-- update_listing entirely, to represent a row that predates migration
-- 0101 and was never re-saved since -- exactly the scenario the earlier,
-- incomplete fix plan (0100-only normalization) would have missed. Fully
-- publish-ready except for condition, which is left NULL.
reset role;
insert into public.listings(
  id, shop_id, title, slug, public_code, listing_type, condition,
  description, price_cents, stock_quantity, province_id, city_id, status
) values (
  '30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',
  'Legacy brand new draft','legacy-brand-new-draft','PSL-LEGACY001','brand_new',null,
  'Still sealed in original packaging.',2500,1,900001,900001,'draft'
);
update public.listings set category_id=(select id from public.categories where slug='women')
  where id='30000000-0000-0000-0000-000000000001';
insert into public.listing_fulfillment_methods(listing_id,method)
  values('30000000-0000-0000-0000-000000000001','meetup');
insert into storage.objects(bucket_id,name,owner_id)
values('listing-images','10000000-0000-0000-0000-000000000001/30000000-0000-0000-0000-000000000001/photo1.jpg',
  '10000000-0000-0000-0000-000000000001');
insert into public.listing_images(listing_id,storage_path,position,is_reference_image)
  values('30000000-0000-0000-0000-000000000001',
    'listing-images/10000000-0000-0000-0000-000000000001/30000000-0000-0000-0000-000000000001/photo1.jpg',0,false);
update public.listings set cover_image_id=(select id from public.listing_images where listing_id='30000000-0000-0000-0000-000000000001')
  where id='30000000-0000-0000-0000-000000000001';
set role authenticated;
set request.jwt.claim.sub='10000000-0000-0000-0000-000000000001';

select test_assert((select condition is null from public.listings where id='30000000-0000-0000-0000-000000000001'),
  'case 8 setup: the fabricated legacy row genuinely starts with condition=NULL');

-- The direct publish call below is the ONLY RPC ever invoked against this
-- row in this case -- no update_listing/create_listing call precedes it,
-- proving publish_listing alone (not the other two RPCs) is what makes a
-- pre-existing null-condition Brand New Draft publishable.
select status as case8_status from public.publish_listing('30000000-0000-0000-0000-000000000001'::uuid) \gset

select test_assert(:'case8_status'='available',
  'case 8: a legacy Brand New Draft with a NULL condition publishes directly, with no prior update_listing/create_listing call');
select test_assert(
  (select condition='brand_new' and status='available' from public.listings where id='30000000-0000-0000-0000-000000000001'),
  'case 8: publish_listing itself normalized condition to brand_new before validating and transitioning to available');

-- ===================== Case 9: a failed publication rolls back the condition normalization =====================
-- Another legacy-shaped Brand New Draft with a NULL condition, complete
-- except for its one deliberately missing field (no photo) -- isolates
-- IMAGE_REQUIRED as the failure that fires AFTER this fix's own
-- normalization UPDATE has already run inside the same transaction.
reset role;
insert into public.listings(
  id, shop_id, title, slug, public_code, listing_type, condition,
  description, category_id, price_cents, stock_quantity, province_id, city_id, status
) values (
  '30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001',
  'Legacy brand new draft missing photo','legacy-brand-new-draft-2','PSL-LEGACY002','brand_new',null,
  'Still sealed in original packaging.',(select id from public.categories where slug='women'),2500,1,900001,900001,'draft'
);
insert into public.listing_fulfillment_methods(listing_id,method)
  values('30000000-0000-0000-0000-000000000002','meetup');
set role authenticated;
set request.jwt.claim.sub='10000000-0000-0000-0000-000000000001';

select test_error(format('select public.publish_listing(%L)','30000000-0000-0000-0000-000000000002'),'IMAGE_REQUIRED');

select test_assert(
  (select condition is null from public.listings where id='30000000-0000-0000-0000-000000000002'),
  'case 9: the failed publish attempt left condition NULL -- this fix''s own normalization UPDATE was rolled back with the rest of the failed transaction, not left dangling');

-- ===================== Case 10: unauthorized publication cannot repair or otherwise mutate another seller's row =====================
-- Seller B attempts to publish Seller A's still-NULL-condition legacy
-- Draft from case 9. The pre-existing NOT_LISTING_OWNER check must reject
-- this before this fix's own normalization UPDATE is ever reached.
set request.jwt.claim.sub='10000000-0000-0000-0000-000000000002';

select test_error(format('select public.publish_listing(%L)','30000000-0000-0000-0000-000000000002'),'NOT_LISTING_OWNER');

select test_assert(
  (select condition is null and status='draft' from public.listings where id='30000000-0000-0000-0000-000000000002'),
  'case 10: the unauthorized, rejected attempt left the row completely untouched -- no accidental condition repair as a side effect of a call that should never reach it');

set request.jwt.claim.sub='10000000-0000-0000-0000-000000000001';

select 'ALL 10 BRAND-NEW-CONDITION-FIX CASES PASSED' as result;
