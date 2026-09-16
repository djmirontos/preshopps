select test_reset_listing();
do $$
declare l constant uuid := '30000000-0000-0000-0000-000000000001'; other uuid;
  buyer constant uuid := '10000000-0000-0000-0000-000000000002';
  seller constant uuid := '10000000-0000-0000-0000-000000000001';
  o uuid; accepted_item uuid; declined_item uuid; r bigint;
begin
  insert into public.listings(shop_id,category_id,title,slug,public_code,listing_type,condition,
    description,price_cents,stock_quantity,province_id,city_id,status,published_at,cover_image_id)
  select shop_id,category_id,'Second item','second-item','SECOND0094',listing_type,condition,
    description,price_cents,stock_quantity,province_id,city_id,status,published_at,null
    from public.listings where id=l returning id into other;
  insert into public.listing_fulfillment_methods values(other,'meetup');
  perform set_config('request.jwt.claim.sub',buyer::text,false);
  -- Test the same shared core called by Cart/Buy Now, with two items in one shop.
  select order_id into o from public.create_orders_from_selection(
    jsonb_build_array(jsonb_build_object('listing_id',l,'quantity',1,'expected_price_cents',1000),
      jsonb_build_object('listing_id',other,'quantity',1,'expected_price_cents',1000)),
    jsonb_build_array(jsonb_build_object('shop_id','20000000-0000-0000-0000-000000000001','method','meetup')),null);
  select id into accepted_item from public.order_items where order_id=o and listing_id=l;
  select id into declined_item from public.order_items where order_id=o and listing_id=other;
  select revision into r from public.listings where id=l;
  perform set_config('request.jwt.claim.sub',seller::text,false);
  perform public.accept_order_items(o,array[accepted_item],array[declined_item]);
  perform test_assert((select status='changes_pending' from public.orders where id=o),'partial acceptance awaits buyer');
  perform test_assert((select revision=r and reserved_quantity=0 from public.listings where id=l),'partial proposal does not reserve');
  perform set_config('request.jwt.claim.sub',buyer::text,false);
  perform public.confirm_order_changes(o);
  perform test_assert((select revision=r+1 and reserved_quantity=1 from public.listings where id=l),'confirmation reserves and advances once');
  perform set_config('request.jwt.claim.sub',seller::text,false);
  perform public.cancel_accepted_order(o,'Test cancellation');
  perform test_assert((select revision=r+2 and reserved_quantity=0 and stock_quantity=10 from public.listings where id=l),'cancellation releases and advances once');
  perform test_assert(not exists(select 1 from public.order_items oi join test_historical h using(id)
    where oi.listing_type_snapshot is not null or oi.listing_condition_snapshot is not null
      or to_jsonb(oi)-array['listing_type_snapshot','listing_condition_snapshot'] <> h.snapshot),'historical order remains unknown and unchanged');
  perform test_assert(not exists(select 1 from public.order_items oi where not exists(select 1 from test_historical h where h.id=oi.id)
    and (oi.listing_type_snapshot is null or oi.listing_condition_snapshot is null)),'all new orders have both snapshots');
end $$;
