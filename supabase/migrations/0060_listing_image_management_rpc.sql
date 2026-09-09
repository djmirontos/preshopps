-- Seller Listing Management: replace_listing_images, the Draft photo-editing
-- counterpart to update_listing (0059). Additive only: one new function. No
-- table, enum, RLS policy, or column is created here -- reuses
-- listing_images and listings.cover_image_id exactly as they already exist
-- (0009), including the existing is_reference_image column.
--
-- RPC design choice: one whole-set replace, not four fine-grained RPCs
-- -----------------------------------------------------------------------
-- Add, remove, reorder, and "choose a new cover" are all, structurally, the
-- same operation: the caller already knows the complete photo set they want
-- and the order they want it in (that is how every photo picker/reorder UI
-- naturally produces its result) -- add is "the new array is longer,"
-- remove is "the new array is shorter," reorder is "the same elements in a
-- different order," and cover is always just "whichever path is now at
-- index 0." A single replace_listing_images(p_listing_id, p_image_paths,
-- p_reference_flags) that atomically swaps the listing's entire image set
-- under one row lock is therefore both the smallest possible RPC surface
-- and the one that best satisfies this task's own explicit preference
-- ("the design that best preserves atomic order/cover consistency and
-- minimizes race conditions"): positions are contiguous 0..N-1 by
-- construction (they are just the array indices), the cover is always
-- exactly position 0 by construction, and there is no window in which two
-- concurrent partial mutations (e.g. two overlapping "remove one image"
-- calls) could interleave and leave positions non-contiguous or the cover
-- pointing at a since-removed image -- the entire old set is replaced by
-- the entire new set in one statement sequence inside one locked
-- transaction. Four separate add/remove/reorder/set-cover RPCs would each
-- need to re-derive and re-write the full position/cover state anyway to
-- stay correct, with strictly more surface area for the same guarantee.
--
-- Pre-inspection findings (read-only, immediately before writing this file)
-- -----------------------------------------------------------------------
-- Migration history ends at 0059_update_listing_rpc (this migration is the
-- very next one, no drift). listing_images (0009) was re-read in full:
-- (id, listing_id, storage_path, position, is_reference_image, created_at),
-- unique (listing_id, position), unique (id, listing_id), storage_path
-- required non-blank, position >= 0, ON DELETE CASCADE from listings. The
-- listings.cover_image_id composite FK (0009) requires cover_image_id to
-- reference a listing_images row belonging to the SAME listing_id -- this
-- function's writes already satisfy that by construction, since it only
-- ever selects a cover image id from a row it just inserted for this exact
-- listing_id. The listing-images storage bucket's RLS (0048) only checks
-- that the first path segment equals auth.uid()::text; create_listing
-- (0056) mirrors that with the same regex
-- ('^listing-images/' || v_caller::text || '/'), and this function reuses
-- the identical check, unchanged -- no stricter path-ownership rule is
-- invented here than what create_listing already enforces. No
-- replace_listing_images or similarly-named function exists anywhere --
-- clean namespace.
--
-- Scope boundary confirmed against canon
-- -----------------------------------------------------------------------
-- PRD 10.6/11.1/11.2: a Draft may be saved with zero images; the 1-8
-- count, the actual-item-photo requirement, and the Pre-loved/Brand-New
-- actual-vs-reference rules are enforced only at publish (already built in
-- publish_listing, 0057/0058) -- this function deliberately does not
-- duplicate or pre-empt any of that at Draft-editing time, per this task's
-- own explicit instruction. The only rules enforced here are structural/
-- ownership ones that must hold at every moment regardless of publish
-- state: at most 8 images, every path actually owned by the caller, and no
-- duplicate path within the same listing. No other "impossible/unsafe
-- combination" was found in canon that would apply to Draft-time image
-- editing specifically -- none is invented beyond what is listed here.
--
-- Security / atomicity: SECURITY DEFINER, set search_path = '', REVOKE ALL
-- FROM public/anon, GRANT EXECUTE TO authenticated only. Identity comes
-- exclusively from auth.uid(). The listing row is locked FOR UPDATE before
-- any read or write of listing_images, the same universal serialization
-- point convention used by update_listing and every other ownership-gated
-- write RPC in this schema -- two concurrent calls against the same
-- listing serialize, so the "replace whole set" is never split across two
-- interleaved transactions. Zero references to orders/order_items/
-- inventory_reservations.

create or replace function public.replace_listing_images(
  p_listing_id uuid,
  p_image_paths text[] default '{}'::text[],
  p_reference_flags boolean[] default null
)
returns table (
  listing_id uuid,
  image_count integer,
  cover_image_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
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

  -- ===================== caller must own an existing shop =====================
  select s.id into v_shop_id
    from public.shops s
    where s.owner_id = v_caller;

  if not found then
    raise exception 'Create your shop first.' using detail = 'SHOP_NOT_FOUND';
  end if;

  -- ===================== seller admin restrictions =====================
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
  delete from public.listing_images where listing_id = p_listing_id;

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
