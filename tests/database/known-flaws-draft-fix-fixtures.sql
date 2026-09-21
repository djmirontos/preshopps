-- Test identity/category/location fixtures for known-flaws-draft-fix.mjs
-- only. Deliberately minimal -- this suite is independently runnable and
-- does not share fixtures or state with published-listing-editing.mjs.
insert into public.provinces(id,country_code,name) values(900001,'PH','Test province');
insert into public.cities_municipalities(id,province_id,name) values(900001,900001,'Test city');
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
('10000000-0000-0000-0000-000000000001','seller@example.invalid',now(),'{"display_name":"Seller"}');
update public.profiles set seller_policies_accepted_at=now()
  where id='10000000-0000-0000-0000-000000000001';
insert into public.shops(id,owner_id,name,slug,province_id,city_id)
values('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',
  'Test shop','test-shop',900001,900001);

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
