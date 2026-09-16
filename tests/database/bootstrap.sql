-- Local PostgreSQL-only Supabase surface. No Storage HTTP service is simulated.
-- Used in a fresh, disposable database by published-listing-editing.mjs.
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls; end if;
end $$;
create schema extensions;
create extension pgcrypto with schema extensions;
create schema auth;
create table auth.users (
  id uuid primary key, email text, email_confirmed_at timestamptz,
  raw_user_meta_data jsonb not null default '{}'
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
grant usage on schema auth to anon, authenticated, service_role;
create schema storage;
create table storage.buckets (
  id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id),
  name text, owner_id text, metadata jsonb, unique(bucket_id,name)
);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1]
$$;
grant usage on schema storage to anon, authenticated, service_role;
grant all on all tables in schema storage to anon, authenticated, service_role;
create publication supabase_realtime;
-- Match Supabase's API table grants: RLS, rather than absent table grants, must
-- block direct application-table mutation in these tests.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
