-- Runtime assertions. Caller-identity checks run through the real SECURITY
-- DEFINER RPCs; explicit SET ROLE cases exercise actual grants and Storage RLS.
select test_assert(not exists(select 1 from public.order_items where listing_type_snapshot is not null
  or listing_condition_snapshot is not null),'historical snapshots start NULL');
select test_assert((select revision=0 from public.listings limit 1),'existing revision starts zero');
-- Client-facing seller writes stay protected, but deliberate service-role
-- maintenance may correct identity and still advances the editor revision.
set role service_role;
do $$
declare l constant uuid := '30000000-0000-0000-0000-000000000001'; original_category integer; alternate_category integer;
begin
  select category_id into original_category from public.listings where id=l;
  select id into alternate_category from public.categories where id<>original_category order by id limit 1;
  perform test_assert(alternate_category is not null,'alternate category for trusted correction');
  update public.listings set category_id=alternate_category, listing_type='preloved', condition='good' where id=l;
  perform test_assert((select category_id=alternate_category and listing_type='preloved' and condition='good'
    and revision=1 from public.listings where id=l),'trusted identity correction advances revision');
  update public.listings set category_id=original_category, listing_type='brand_new', condition='brand_new' where id=l;
  perform test_assert((select category_id=original_category and listing_type='brand_new' and condition='brand_new'
    and revision=2 from public.listings where id=l),'trusted correction can restore valid identity');
end $$;
reset role;
set request.jwt.claim.sub='';
select test_error($q$select public.update_published_listing('30000000-0000-0000-0000-000000000001',0,'{}')$q$,'NOT_AUTHENTICATED');
set role anon;
select test_error($q$select public.update_published_listing('30000000-0000-0000-0000-000000000001',0,'{}')$q$,'42501');
reset role;
set request.jwt.claim.sub='10000000-0000-0000-0000-000000000003';
select test_error($q$select public.update_published_listing('30000000-0000-0000-0000-000000000001',0,'{}')$q$,'NOT_LISTING_OWNER');
set request.jwt.claim.sub='10000000-0000-0000-0000-000000000001';
update public.profiles set deleted_at=now() where id=auth.uid();
select test_error($q$select public.update_published_listing('30000000-0000-0000-0000-000000000001',0,'{}')$q$,'INTERACTION_BLOCKED');
update public.profiles set deleted_at=null where id=auth.uid();
insert into public.user_restrictions(user_id,restriction_type,reason,issued_by)
values(auth.uid(),'seller_suspended','Test restriction',auth.uid());
select test_error($q$select public.update_published_listing('30000000-0000-0000-0000-000000000001',0,'{}')$q$,'INTERACTION_BLOCKED');
update public.user_restrictions set lifted_at=now(),lifted_by=auth.uid();

do $$
declare l constant uuid := '30000000-0000-0000-0000-000000000001'; r bigint; out jsonb; k text; s public.listing_status_enum;
begin
  select revision into r from public.listings where id=l;
  out := public.update_published_listing(l,r,'{}');
  perform test_assert(out->>'revision'=r::text and out->>'changed'='false','no-op revision');
  perform test_assert(jsonb_typeof(out->'revision')='string','revision is decimal text');
  out := public.update_published_listing(l,r,'{"title":"Changed","description":"New description","price_cents":900,"original_price_cents":1000,"is_negotiable":true,"brand":"Brand","known_flaws":"Note","meetup_note":"Public place"}');
  perform test_assert(out->>'revision'=(r+1)::text and out->>'status'='available','material fields once/status preserved');
  perform test_error(format('select public.update_published_listing(%L,%s,%L)',l,r,'{"title":"Stale"}'),'STALE_LISTING_REVISION');
  r := r+1;
  foreach k in array array['category_id','listing_type','condition','status','stock_quantity','reserved_quantity','revision','owner_id','shop_id','id','public_code','updated_at'] loop
    perform test_error(format('select public.update_published_listing(%L,%s,%L)',l,r,jsonb_build_object(k,null)),'PROTECTED_FIELD');
  end loop;
  perform test_error(format('select public.update_published_listing(%L,%s,%L)',l,r,'{"surprise":1}'),'UNKNOWN_FIELD');
  foreach k in array array['title','description','price_cents','province_id','city_id'] loop
    perform test_error(format('select public.update_published_listing(%L,%s,%L)',l,r,jsonb_build_object(k,null)),'INVALID_PUBLISHED_LISTING');
  end loop;
  perform test_error(format('select public.update_published_listing(%L,%s,%L)',l,r,'{"available_quantity":0}'),'INVALID_PUBLISHED_LISTING');
  perform test_error(format('select public.update_published_listing(%L,%s,%L)',l,r,'{"available_quantity":1.5}'),'INVALID_PUBLISHED_LISTING');
  perform test_error(format('select public.update_published_listing(%L,%s,%L)',l,r,'{"available_quantity":2147483648}'),'INVALID_PUBLISHED_LISTING');
  out := public.update_published_listing(l,r,'{"available_quantity":5}'); r:=r+1;
  perform test_assert(out->>'available_quantity'='5' and out->>'revision'=r::text,'available quantity derives stock');
  out := public.update_published_listing(l,r,'{"fulfillment_methods":["pickup","shipping"]}'); r:=r+1;
  perform test_assert(out->>'revision'=r::text,'child-only revision once');
  out := public.update_published_listing(l,r,'{"fulfillment_methods":["shipping","pickup"]}');
  perform test_assert(out->>'revision'=r::text and out->>'changed'='false','fulfillment set no-op');
  update public.listings set updated_at=now() where id=l;
  perform test_assert((select revision=r from public.listings where id=l),'timestamp-only no revision');
  perform public.update_listing_status(l,'paused');
  select revision into r from public.listings where id=l;
  out := public.update_published_listing(l,r,'{"available_quantity":0}'); r:=r+1;
  perform test_assert(out->>'available_quantity'='0' and out->>'status'='paused','paused zero preserves status');
  perform test_error(format('select public.update_listing_status(%L,%L)',l,'available'),'STOCK_QUANTITY_INVALID');
  perform public.update_published_listing(l,r,'{"available_quantity":10}');
  perform public.update_listing_status(l,'available');
  foreach s in array array['reserved','sold','archived']::public.listing_status_enum[] loop
    update public.listings set status=s where id=l;
    select revision into r from public.listings where id=l;
    perform test_error(format('select public.update_published_listing(%L,%s,%L)',l,r,'{}'),'LISTING_NOT_EDITABLE');
  end loop;
  perform test_reset_listing();
  update public.listings set reserved_quantity=2 where id=l;
  select revision into r from public.listings where id=l;
  perform test_error(format('select public.update_published_listing(%L,%s,%L)',l,r,'{"available_quantity":5}'),'LISTING_HAS_ACTIVE_RESERVATION');
  out := public.update_published_listing(l,r,'{"title":"Text with reservations"}');
  perform test_assert(out->>'reserved_quantity'='2','text edit preserves reservations');
  perform test_reset_listing();
end $$;

-- Legacy positions are nonnegative/unique but not necessarily contiguous.
-- The complete gallery save must not collide with an existing position 8.
begin;
do $$
declare l constant uuid := '30000000-0000-0000-0000-000000000001'; r bigint; out jsonb;
begin
  update public.listing_images set position=8 where id='40000000-0000-0000-0000-000000000002';
  select revision into r from public.listings where id=l;
  out := public.update_published_listing(l,r,'{}',
    '[{"image_id":"40000000-0000-0000-0000-000000000002","is_reference_image":true,"is_cover":false},
      {"image_id":"40000000-0000-0000-0000-000000000001","is_reference_image":false,"is_cover":true}]');
  perform test_assert((select array_agg(position order by position)=array[0,1]::smallint[] from public.listing_images where listing_id=l),
    'positions 0 and 8 reorder to canonical positions');
  perform test_assert(out->>'revision'=(r+1)::text and out->>'cover_image_id'='40000000-0000-0000-0000-000000000001',
    'sparse reorder changes cover and revision once');

  -- Larger sparse gallery: reorder, remove one old row, and add a new path.
  insert into storage.objects(bucket_id,name,owner_id) values
    ('listing-images','10000000-0000-0000-0000-000000000001/'||l::text||'/4.jpg','10000000-0000-0000-0000-000000000001'),
    ('listing-images','10000000-0000-0000-0000-000000000001/'||l::text||'/5.jpg','10000000-0000-0000-0000-000000000001');
  update public.listing_images set position=8 where id='40000000-0000-0000-0000-000000000001';
  update public.listing_images set position=0 where id='40000000-0000-0000-0000-000000000002';
  insert into public.listing_images(id,listing_id,storage_path,position,is_reference_image) values
    ('40000000-0000-0000-0000-000000000003',l,'listing-images/10000000-0000-0000-0000-000000000001/'||l::text||'/3.jpg',17,false),
    ('40000000-0000-0000-0000-000000000004',l,'listing-images/10000000-0000-0000-0000-000000000001/'||l::text||'/4.jpg',32767,false);
  select revision into r from public.listings where id=l;
  out := public.update_published_listing(l,r,'{}',
    '[{"image_id":"40000000-0000-0000-0000-000000000004","is_reference_image":false,"is_cover":true},
      {"image_id":"40000000-0000-0000-0000-000000000003","is_reference_image":false,"is_cover":false},
      {"image_id":"40000000-0000-0000-0000-000000000001","is_reference_image":false,"is_cover":false},
      {"storage_path":"listing-images/10000000-0000-0000-0000-000000000001/30000000-0000-0000-0000-000000000001/5.jpg","is_reference_image":false,"is_cover":false}]');
  perform test_assert((select array_agg(position order by position)=array[0,1,2,3]::smallint[]
    from public.listing_images where listing_id=l),'larger sparse gallery canonical after remove/add');
  perform test_assert(not exists(select 1 from public.listing_images where id='40000000-0000-0000-0000-000000000002'),
    'removed sparse image detached');
  perform test_assert(out->>'revision'=(r+1)::text and out->>'cover_image_id'='40000000-0000-0000-0000-000000000004',
    'larger sparse gallery advances revision and changes cover once');
end $$;
rollback;
select test_assert((select array_agg(position order by position)=array[0,1]::smallint[]
  from public.listing_images where listing_id='30000000-0000-0000-0000-000000000001')
  and (select count(*) from public.listing_images where listing_id='30000000-0000-0000-0000-000000000001')=2
  and (select cover_image_id='40000000-0000-0000-0000-000000000001' from public.listings
    where id='30000000-0000-0000-0000-000000000001'),
  'sparse test rollback restores original gallery and cover');

do $$
declare l constant uuid := '30000000-0000-0000-0000-000000000001'; r bigint; out jsonb; images jsonb; before_state jsonb;
begin
  select revision into r from public.listings where id=l;
  images := '[{"image_id":"40000000-0000-0000-0000-000000000002","is_reference_image":true,"is_cover":true},
    {"image_id":"40000000-0000-0000-0000-000000000001","is_reference_image":false,"is_cover":false}]';
  out := public.update_published_listing(l,r,'{}',images); r:=r+1;
  perform test_assert(out->>'revision'=r::text and out->>'cover_image_id'='40000000-0000-0000-0000-000000000002','reorder/cover increments once');
  out := public.update_published_listing(l,r,'{}',images);
  perform test_assert(out->>'changed'='false' and out->>'revision'=r::text,'image no-op');
  perform test_error(format('select public.update_published_listing(%L,%s,%L,%L)',l,r,'{}',
    '[{"image_id":"40000000-0000-0000-0000-000000000002","is_reference_image":true,"is_cover":true}]'),'INVALID_IMAGE_STATE');
  perform test_error(format('select public.update_published_listing(%L,%s,%L,%L)',l,r,'{}',
    '[{"storage_path":"listing-images/foreign/foreign/x.jpg","is_reference_image":false,"is_cover":true}]'),'INVALID_IMAGE_STATE');
  perform test_error(format('select public.update_published_listing(%L,%s,%L,%L)',l,r,'{}',
    '[{"storage_path":"listing-images/10000000-0000-0000-0000-000000000001/30000000-0000-0000-0000-000000000001/missing.jpg","is_reference_image":false,"is_cover":true}]'),'INVALID_IMAGE_STATE');
  perform test_error(format('select public.update_published_listing(%L,%s,%L,%L)',l,r,'{}',images||images),'INVALID_IMAGE_STATE');
  before_state := public.get_published_listing_edit_state(l);
  perform test_error(format('select public.update_published_listing(%L,%s,%L,%L)',l,r,'{"title":"Must roll back","fulfillment_methods":["shipping"]}',
    '[{"image_id":"40000000-0000-0000-0000-000000000002","is_reference_image":true,"is_cover":true}]'),'INVALID_IMAGE_STATE');
  perform test_assert(before_state=public.get_published_listing_edit_state(l),'late failure rolls back parent and children');
  -- Remove historical cover 1 and replace with a new uploaded actual image.
  images := '[{"storage_path":"listing-images/10000000-0000-0000-0000-000000000001/30000000-0000-0000-0000-000000000001/3.jpg","is_reference_image":false,"is_cover":true}]';
  out := public.update_published_listing(l,r,'{}',images);
  perform test_assert(out->>'revision'=(r+1)::text and jsonb_array_length(out->'images')=1,'cover removal bumps exactly once');
  perform test_assert(exists(select 1 from storage.objects where name like '%/1.jpg'),'historical storage retained');
  perform test_assert(not exists(select 1 from public.order_items oi join test_historical h using(id)
    where to_jsonb(oi)-array['listing_type_snapshot','listing_condition_snapshot'] <> h.snapshot),'existing orders unchanged');
end $$;

set role authenticated;
-- RLS-denied UPDATE/DELETE affect zero rows, even when ownership matches.
with changed as (update storage.objects set metadata='{"changed":true}' where bucket_id='listing-images' returning id)
select test_assert(count(*)=0,'Storage UPDATE denied') from changed;
with removed as (delete from storage.objects where bucket_id='listing-images' returning id)
select test_assert(count(*)=0,'Storage DELETE denied') from removed;
insert into storage.objects(bucket_id,name,owner_id) values('listing-images',
  '10000000-0000-0000-0000-000000000001/new-unique.jpg','10000000-0000-0000-0000-000000000001');
select test_error($q$insert into storage.objects(bucket_id,name,owner_id) values('listing-images',
  '10000000-0000-0000-0000-000000000001/new-unique.jpg','10000000-0000-0000-0000-000000000001')
  on conflict(bucket_id,name) do update set metadata='{}'$q$,'42501');
with changed as (update public.listings set title='Direct bypass' returning id)
select test_assert(count(*)=0,'direct listing update denied') from changed;
reset role;

-- Draft RPCs, image replacement and publication remain usable; revision stays
-- zero until publication. Includes an inquiry-only optional extension example.
select test_assert((select revision=0 from public.listings where id='30000000-0000-0000-0000-000000000004'),
  'preexisting complete Draft begins at revision zero');
select public.publish_listing('30000000-0000-0000-0000-000000000004');
select test_assert((select status='available' and revision=1 from public.listings
  where id='30000000-0000-0000-0000-000000000004'),
  'preexisting owner/listing JPG path publishes after upgrade');
select test_error($q$select public.publish_listing('30000000-0000-0000-0000-000000000005')$q$,
  'INVALID_IMAGE_STATE');
select test_assert((select status='draft' and revision=0 from public.listings
  where id='30000000-0000-0000-0000-000000000005'),
  'missing Storage object fails publish without changing Draft');
do $$
declare d uuid; out jsonb; c integer; r bigint;
begin
  insert into public.listings(shop_id,title,slug,public_code,status)
    values('20000000-0000-0000-0000-000000000001','Draft','draft','DRAFT0094','draft') returning id into d;
  perform public.update_listing(d,'{"description":"Draft detail"}');
  perform test_assert((select revision=0 from public.listings where id=d),'draft edits do not churn revision');
  perform test_error(format('select public.update_published_listing(%L,0,%L)',d,'{}'),'LISTING_NOT_EDITABLE');
  select id into c from public.categories where slug='cars';
  perform public.update_listing(d,jsonb_build_object('description','Car description','category_id',c,
    'listing_type','preloved','condition','good','price_cents',1000,
    'province_id',(select province_id from public.shops where slug='test-shop'),
    'city_id',(select city_id from public.shops where slug='test-shop')));
  insert into storage.objects(bucket_id,name,owner_id) values('listing-images',auth.uid()::text||'/'||d::text||'/draft.jpg',auth.uid()::text);
  perform public.replace_listing_images(d,array['listing-images/'||auth.uid()::text||'/'||d::text||'/draft.jpg']);
  perform test_assert((select revision=0 from public.listings where id=d),'draft gallery does not churn revision');
  perform public.publish_listing(d);
  perform test_assert((select revision=1 from public.listings where id=d),'publication establishes revision');
  out := public.update_published_listing(d,1,'{"vehicle_details":{"model":"Example","year":2020}}');
  perform test_assert(out->>'revision'='2','extension only increments once');
  out := public.update_published_listing(d,2,'{"vehicle_details":{"model":"Example","year":2020}}');
  perform test_assert(out->>'revision'='2' and out->>'changed'='false','extension no-op');
  perform test_error(format('select public.update_published_listing(%L,2,%L)',d,'{"vehicle_details":{"surprise":1}}'),'UNKNOWN_FIELD');
  perform test_error(format('select public.update_published_listing(%L,2,%L)',d,'{"rental_details":{"capacity":2}}'),'INVALID_PUBLISHED_LISTING');
  perform test_error(format('select public.update_listing(%L,%L)',d,'{"title":"Draft bypass"}'),'LISTING_NOT_DRAFT');
  perform test_error(format('select public.replace_listing_images(%L)',d),'LISTING_NOT_DRAFT');
  perform test_error(format('select public.update_published_listing(%L,2,%L,%L)',d,'{}',
    (select jsonb_agg(jsonb_build_object('image_id',id,'is_reference_image',true,'is_cover',true)) from public.listing_images where listing_id=d)), 'INVALID_IMAGE_STATE');
end $$;
select test_reset_listing();

-- Optional rental data, location hierarchy, Fair flaws, and report preservation.
do $$
declare l uuid; r bigint; img uuid; report_id uuid; snapshot jsonb; out jsonb;
begin
  insert into public.listings(shop_id,category_id,title,slug,public_code,listing_type,condition,known_flaws,
    description,price_cents,province_id,city_id,status)
  select id,(select id from public.categories where slug='for-rent'),'Rental','rental','RENT0094',
    'preloved','fair','Existing wear','Rental description',0,province_id,city_id,'draft'
    from public.shops where slug='test-shop' returning id into l;
  insert into storage.objects(bucket_id,name,owner_id)
    values('listing-images',auth.uid()::text||'/'||l::text||'/rental.jpg',auth.uid()::text);
  perform public.replace_listing_images(l,array['listing-images/'||auth.uid()::text||'/'||l::text||'/rental.jpg']);
  perform public.publish_listing(l);
  out := public.update_published_listing(l,1,'{"rental_details":{"rental_price_cents":1500,"rental_period":"daily","capacity":2}}');
  perform test_assert(out->>'revision'='2','rental insert increments once');
  out := public.update_published_listing(l,2,'{"rental_details":{"capacity":3}}');
  perform test_assert(out->>'revision'='3' and out->'rental_details'->>'rental_period'='daily','rental merges existing state');
  out := public.update_published_listing(l,3,'{"rental_details":{}}');
  perform test_assert(out->>'revision'='3' and out->>'changed'='false','empty nested patch is no-op');
  perform test_error(format('select public.update_published_listing(%L,3,%L)',l,'{"known_flaws":null}'),'INVALID_PUBLISHED_LISTING');
  perform test_error(format('select public.update_published_listing(%L,3,%L)',l,'{"city_id":9999999}'),'INVALID_PUBLISHED_LISTING');
  perform test_error(format('select public.update_published_listing(%L,3,%L)',l,'{"rental_details":{"capacity":0}}'),'INVALID_PUBLISHED_LISTING');
  insert into public.reports(reporter_id,target_type,listing_id,reason)
    values('10000000-0000-0000-0000-000000000002','listing',l,'misleading') returning id into report_id;
  select to_jsonb(reports) into snapshot from public.reports where id=report_id;
  out := public.update_published_listing(l,3,'{"description":"Reported listing can still be edited"}');
  perform test_assert(out->>'revision'='4','ordinary report does not freeze editing');
  perform test_assert((select to_jsonb(reports)=snapshot from public.reports where id=report_id),'report preserved');
  select id into img from public.listing_images where listing_id=l;
  perform test_error(format('select public.update_published_listing(%L,4,%L,%L)',l,'{}',
    jsonb_build_array(jsonb_build_object('image_id',img,'is_reference_image',false,'is_cover',false))),'INVALID_IMAGE_STATE');
  out := public.update_published_listing(l,4,'{"rental_details":null}');
  perform test_assert(out->'rental_details'='null'::jsonb and out->>'revision'='5','optional details cleared atomically');
end $$;
