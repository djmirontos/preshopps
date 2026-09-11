-- Fixes a confirmed PL/pgSQL RETURNS TABLE output-column collision in
-- replace_listing_images, the same bug class as 0079's five fixes: the
-- function's `returns table (listing_id uuid, image_count integer,
-- cover_image_id uuid)` clause implicitly declares a PL/pgSQL variable
-- named `listing_id` in scope for the whole function body. The body's
-- very first mutating statement,
--
--   delete from public.listing_images where listing_id = p_listing_id;
--
-- references `listing_id` bare, with no table alias -- and
-- public.listing_images itself has a real `listing_id` column. Postgres's
-- default plpgsql variable-conflict resolution (`#variable_conflict
-- error`) refuses to pick one silently and raises
-- `42702: column reference "listing_id" is ambiguous` the instant this
-- statement executes, which is exactly the HTTP 400 the client hit calling
-- rest/v1/rpc/replace_listing_images.
--
-- Pre-inspection (read-only, immediately before writing this migration):
-- live pg_get_functiondef for replace_listing_images was re-fetched and
-- confirmed to match 0082's local definition exactly -- no drift. Every
-- other listing_id reference in this same function body was checked and
-- is already unambiguous: the two INSERT ... (listing_id, ...) column
-- lists are always resolved against the target table, never a plpgsql
-- variable; the second listing_images lookup (`select li.id into
-- v_cover_image_id from public.listing_images li where li.listing_id =
-- p_listing_id and li.position = 0`) is already alias-qualified; the
-- `update public.listings as l ... where l.id = p_listing_id` and the
-- final `return query select p_listing_id, ...` both reference the
-- parameter p_listing_id, never the bare output-column name. So the one
-- DELETE above is the only offending statement in this function.
--
-- Fix strategy (identical to 0079): give the statement's target table an
-- explicit alias and qualify only the exact bare reference that was
-- ambiguous -- `delete from public.listing_images as li where li.listing_id
-- = p_listing_id`. No other line changes: same signature, same
-- SECURITY DEFINER, same SET search_path = '', same grants, same
-- authentication/deleted-account/shop-ownership/seller-restriction checks,
-- same row lock, same Draft-only rule, same 8-image limit, same
-- reference-flag length check, same path ownership/prefix validation, same
-- duplicate-path check, same image insert loop and position ordering, same
-- cover-image selection and listings.cover_image_id update, same return
-- shape.
--
-- Narrow systemic check (this migration's own scope; see task report for
-- the full write-up): create_listing, publish_listing,
-- update_listing_status, and get_my_listing were each re-inspected for the
-- identical RETURNS TABLE/unqualified-bare-column pattern and are NOT
-- affected -- every listing_id-shaped reference in those four is either a
-- differently-named local variable (v_listing_id), an INSERT column list,
-- or already alias-qualified. update_listing DOES have this same
-- confirmed bug (multiple bare `where listing_id = p_listing_id` deletes
-- against listing_fulfillment_methods/listing_vehicle_details/
-- listing_rental_details) but is deliberately NOT fixed here -- out of
-- this migration's scope per instruction, reported separately for a
-- follow-up, dedicated migration.

create or replace function public.replace_listing_images(p_listing_id uuid, p_image_paths text[] default '{}'::text[], p_reference_flags boolean[] default null::boolean[])
returns table(listing_id uuid, image_count integer, cover_image_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_caller_deleted_at timestamptz;
  v_shop_id uuid;
  v_listing_shop_id uuid;
  v_listing_status public.listing_status_enum;
  v_image_count integer;
  v_flag_count integer;
  v_path text;
  v_reference_flags boolean[];
  v_cover_image_id uuid;
  i integer;
begin
  -- ===================== authentication =====================
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'Authentication required.' using detail = 'NOT_AUTHENTICATED';
  end if;

  -- ===================== caller eligibility (deleted account) =====================
  select p.deleted_at into v_caller_deleted_at
    from public.profiles p
    where p.id = v_caller;

  if not found or v_caller_deleted_at is not null then
    raise exception 'Account is not available.' using detail = 'INTERACTION_BLOCKED';
  end if;

  -- ===================== caller must own an existing shop =====================
  select s.id into v_shop_id
    from public.shops s
    where s.owner_id = v_caller;

  if not found then
    raise exception 'Create your shop first.' using detail = 'SHOP_NOT_FOUND';
  end if;

  -- ===================== seller admin restrictions (existing check, unchanged, defense-in-depth) =====================
  if exists (
    select 1 from public.user_restrictions ur
    where ur.user_id = v_caller
      and ur.lifted_at is null
      and ur.restriction_type in ('seller_suspended', 'account_suspended')
  ) then
    raise exception 'You are not able to edit listings right now.' using detail = 'INTERACTION_BLOCKED';
  end if;

  -- ===================== lock the listing row (universal serialization point) =====================
  select l.shop_id, l.status
    into v_listing_shop_id, v_listing_status
    from public.listings l
    where l.id = p_listing_id
    for update;

  if not found then
    raise exception 'Listing not found.' using detail = 'LISTING_NOT_FOUND';
  end if;

  if v_listing_shop_id <> v_shop_id then
    raise exception 'You do not have permission to edit this listing.' using detail = 'NOT_LISTING_OWNER';
  end if;

  -- ===================== draft-only editing (same convention/finding as update_listing, see its own header) =====================
  if v_listing_status <> 'draft' then
    raise exception 'Only draft listings can be edited with this operation.' using detail = 'LISTING_NOT_DRAFT';
  end if;

  -- ===================== count: 0-8 =====================
  v_image_count := coalesce(array_length(p_image_paths, 1), 0);

  if v_image_count > 8 then
    raise exception 'A listing may have at most 8 photos.' using detail = 'TOO_MANY_LISTING_IMAGES';
  end if;

  -- ===================== reference flags: same length as paths when supplied, all-false otherwise =====================
  if p_reference_flags is not null then
    v_flag_count := coalesce(array_length(p_reference_flags, 1), 0);
    if v_flag_count <> v_image_count then
      raise exception 'Reference-image flags must match the number of photos.' using detail = 'IMAGE_ARRAYS_LENGTH_MISMATCH';
    end if;
    v_reference_flags := p_reference_flags;
  else
    v_reference_flags := array_fill(false, array[v_image_count]);
  end if;

  -- ===================== path ownership + structural validity =====================
  if v_image_count > 0 then
    foreach v_path in array p_image_paths loop
      if v_path is null
         or v_path !~ '[^[:space:]]'
         or v_path !~ ('^listing-images/' || v_caller::text || '/') then
        raise exception 'One or more listing photos are invalid.' using detail = 'LISTING_IMAGE_PATH_INVALID';
      end if;
    end loop;
  end if;

  -- ===================== no duplicate path within this listing's own new set =====================
  if v_image_count > 0
     and v_image_count <> (select count(distinct p) from unnest(p_image_paths) p) then
    raise exception 'The same photo was submitted more than once.' using detail = 'DUPLICATE_LISTING_IMAGE_PATH';
  end if;

  -- ===================== atomic whole-set replace: positions are the array indices, so they are contiguous 0..N-1 by construction =====================
  delete from public.listing_images as li where li.listing_id = p_listing_id;

  if v_image_count > 0 then
    for i in 1..v_image_count loop
      insert into public.listing_images (listing_id, storage_path, position, is_reference_image)
        values (p_listing_id, p_image_paths[i], i - 1, coalesce(v_reference_flags[i], false));
    end loop;

    select li.id into v_cover_image_id
      from public.listing_images li
      where li.listing_id = p_listing_id and li.position = 0;
  else
    v_cover_image_id := null;
  end if;

  update public.listings as l
    set cover_image_id = v_cover_image_id
    where l.id = p_listing_id;

  return query
    select p_listing_id, v_image_count, v_cover_image_id;
end;
$$;

revoke all on function public.replace_listing_images(uuid, text[], boolean[]) from public;
revoke all on function public.replace_listing_images(uuid, text[], boolean[]) from anon;
grant execute on function public.replace_listing_images(uuid, text[], boolean[]) to authenticated;
