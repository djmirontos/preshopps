-- Test identities and objects only, in the runner's fresh disposable database.
insert into public.provinces(id,country_code,name) values(900001,'PH','Test province');
insert into public.cities_municipalities(id,province_id,name) values(900001,900001,'Test city');
insert into public.barangays(id,city_id,name) values(900001,900001,'Test barangay');
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
('10000000-0000-0000-0000-000000000001','seller@example.invalid',now(),'{"display_name":"Seller","policies_accepted":true}'),
('10000000-0000-0000-0000-000000000002','buyer@example.invalid',now(),'{"display_name":"Buyer","policies_accepted":true}'),
('10000000-0000-0000-0000-000000000003','foreign@example.invalid',now(),'{"display_name":"Other","policies_accepted":true}');
update public.profiles set seller_policies_accepted_at=now();
insert into public.shops(id,owner_id,name,slug,province_id,city_id)
select '20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',
  'Test shop','test-shop',c.province_id,c.id from public.cities_municipalities c order by c.id limit 1;
insert into public.shops(id,owner_id,name,slug,province_id,city_id)
select '20000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000003',
  'Foreign shop','foreign-shop',c.province_id,c.id from public.cities_municipalities c order by c.id limit 1;
insert into public.listings(id,shop_id,category_id,title,slug,public_code,listing_type,condition,
  description,price_cents,stock_quantity,province_id,city_id,status,published_at)
select '30000000-0000-0000-0000-000000000001',s.id,
  (select id from public.categories where not is_inquiry_only order by id limit 1),
  'Test listing','test-listing','TEST0094','brand_new','brand_new','Test description',1000,10,
  s.province_id,s.city_id,'available',now() from public.shops s where s.slug='test-shop';
insert into public.listing_fulfillment_methods values ('30000000-0000-0000-0000-000000000001','meetup');
insert into storage.objects(bucket_id,name,owner_id)
select 'listing-images','10000000-0000-0000-0000-000000000001/30000000-0000-0000-0000-000000000001/'||n||'.jpg',
  '10000000-0000-0000-0000-000000000001' from generate_series(1,3) n;
insert into public.listing_images(id,listing_id,storage_path,position,is_reference_image) values
('40000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',
 'listing-images/10000000-0000-0000-0000-000000000001/30000000-0000-0000-0000-000000000001/1.jpg',0,false),
('40000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000001',
 'listing-images/10000000-0000-0000-0000-000000000001/30000000-0000-0000-0000-000000000001/2.jpg',1,true);
update public.listings set cover_image_id='40000000-0000-0000-0000-000000000001';
-- A ready-to-publish Draft and an invalid-media Draft both predate 0094.
-- Their paths use the established owner/listing folder and ordinary JPG names.
insert into public.listings(id,shop_id,category_id,title,slug,public_code,listing_type,condition,
  description,price_cents,stock_quantity,province_id,city_id,status)
select d.id,s.id,l.category_id,d.title,d.slug,d.code,'preloved','good',
  'Description before 0094',1,1,s.province_id,s.city_id,'draft'
from public.shops s cross join public.listings l
cross join (values
  ('30000000-0000-0000-0000-000000000004'::uuid,'Legacy draft','legacy-draft','LEGACY0094'),
  ('30000000-0000-0000-0000-000000000005'::uuid,'Invalid media draft','invalid-media-draft','BADMEDIA0094')
) d(id,title,slug,code)
where s.slug='test-shop' and l.id='30000000-0000-0000-0000-000000000001';
insert into public.listing_fulfillment_methods(listing_id,method) values
  ('30000000-0000-0000-0000-000000000004','meetup'),
  ('30000000-0000-0000-0000-000000000005','meetup');
insert into storage.objects(bucket_id,name,owner_id) values
  ('listing-images','10000000-0000-0000-0000-000000000001/30000000-0000-0000-0000-000000000004/old-upload.jpg',
    '10000000-0000-0000-0000-000000000001');
insert into public.listing_images(id,listing_id,storage_path,position,is_reference_image) values
  ('40000000-0000-0000-0000-000000000014','30000000-0000-0000-0000-000000000004',
    'listing-images/10000000-0000-0000-0000-000000000001/30000000-0000-0000-0000-000000000004/old-upload.jpg',0,false),
  ('40000000-0000-0000-0000-000000000015','30000000-0000-0000-0000-000000000005',
    'listing-images/10000000-0000-0000-0000-000000000001/30000000-0000-0000-0000-000000000005/missing-object.jpg',0,false);
update public.listings set cover_image_id='40000000-0000-0000-0000-000000000014'
  where id='30000000-0000-0000-0000-000000000004';
update public.listings set cover_image_id='40000000-0000-0000-0000-000000000015'
  where id='30000000-0000-0000-0000-000000000005';
set request.jwt.claim.sub='10000000-0000-0000-0000-000000000002';
select * from public.submit_buy_now_order('30000000-0000-0000-0000-000000000001',1,'meetup',1000,null);
create table test_historical as select id,to_jsonb(oi) snapshot from public.order_items oi;

create function test_assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Assertion failed: %',label; end if; end $$;
create function test_error(query text,expected text) returns void language plpgsql as $$
declare actual text;
begin
  begin execute query;
  exception when others then
    get stacked diagnostics actual=pg_exception_detail;
    if actual=expected or sqlstate=expected then return; end if;
    raise exception 'Expected %, received % / % / %',expected,actual,sqlstate,sqlerrm;
  end;
  raise exception 'Expected error %, but operation succeeded',expected;
end $$;
-- Test setup only, not part of migration or production privileges.
create function test_reset_listing() returns void language plpgsql as $$
begin
  update public.listings set title='Test listing',description='Test description',price_cents=1000,
    original_price_cents=null,stock_quantity=10,reserved_quantity=0,status='available'
    where id='30000000-0000-0000-0000-000000000001';
  delete from public.listing_fulfillment_methods where listing_id='30000000-0000-0000-0000-000000000001';
  insert into public.listing_fulfillment_methods values('30000000-0000-0000-0000-000000000001','meetup');
end $$;
