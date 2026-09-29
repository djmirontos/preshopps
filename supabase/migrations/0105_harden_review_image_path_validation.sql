-- Harden create_review/update_review image-path validation.
-- Repository-local until reviewed/applied.
--
-- Why this migration is needed (found during a read-only audit, not assumed)
-- -----------------------------------------------------------------------
-- create_review and update_review (current live definitions: 0065's own
-- redefinition of both) validate each p_image_paths entry with only
-- `v_path is null or v_path !~ '[^[:space:]]'` -- i.e. "non-blank string".
-- Nothing checks that a submitted path belongs to the calling buyer, to
-- this specific order, to the review-images bucket, or that it exists in
-- Storage at all. review_images.storage_path is a plain text column with
-- no foreign key into storage.objects, so Storage RLS is never consulted
-- for this write -- it is an ordinary table insert via a SECURITY DEFINER
-- function. Both public review read paths (get_shop_reviews,
-- get_order_review) pass the raw stored value straight into
-- getListingImageUrl(), which builds `${supabaseUrl}/storage/v1/object/
-- public/${path}` with no bucket enforcement of its own. Confirmed live:
-- zero rows exist in public.review_images today, so this is a real,
-- currently-unexploited gap, not a claim of active abuse -- a buyer could
-- submit another user's own review-images path, a listing-images/
-- shop-images path, or a fabricated one, and it would render on the
-- public review feed as if it were their own review photo.
--
-- Every sibling media-attaching RPC already validates ownership at this
-- boundary (create_dispute: exact bucket/owner/order prefix, 0076;
-- update_published_listing: owner prefix plus a storage.objects existence
-- check, 0094; create_shop/update_shop: owner prefix, 0049/0082) --
-- reviews were the one exception. This migration brings create_review and
-- update_review up to the same standard, changing nothing else about
-- either function: same signature, same return shape, same error
-- contract for every other validation, same security definer/search_path,
-- same grants.
--
-- Rule (identical in both functions, for every non-empty p_image_paths
-- entry):
--   1. exact prefix `review-images/{caller auth.uid()}/{order_id}/`
--      (create_review: p_order_id itself; update_review: the review's own
--      order_id, freshly looked up from the row -- never trusted from the
--      client, and never the caller-supplied p_review_id's own id);
--   2. a non-empty object name beneath that prefix;
--   3. a matching row in storage.objects (bucket_id = 'review-images',
--      name = the bucket-relative remainder) actually exists.
-- update_review always deletes and re-inserts the complete review_images
-- set on every call (0034/0065, unchanged here) -- there is no separate
-- "retained vs. new" code path, so a genuinely retained image (originally
-- uploaded by this same caller for this same order) is re-validated by
-- the identical rule and passes exactly as a new upload would. Only the
-- original review author can ever call update_review (enforced earlier
-- in the function, unchanged), so the caller/order pairing checked here
-- is always the real one. The existing 0..2-images limit, the empty-array
-- (no images) case, and the REVIEW_IMAGE_PATH_INVALID error detail are
-- all unchanged.
--
-- No table CHECK constraint is added (a caller-identity-dependent check
-- cannot live in a CHECK constraint, which cannot call auth.uid()
-- meaningfully outside of a request context, and review_images has no
-- caller/order column of its own to key on without a schema change this
-- task did not ask for). No storage.objects policy is touched.

-- ============================================================
-- create_review (adds hardened image-path validation only)
-- ============================================================
create or replace function public.create_review(p_order_id uuid, p_rating integer, p_body text default null, p_image_paths text[] default '{}'::text[])
returns table (review_id uuid, created_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_caller_deleted_at timestamptz;
  v_order_buyer_id uuid;
  v_order_shop_id uuid;
  v_order_status public.order_status_enum;
  v_order_completed_at timestamptz;
  v_shop_owner_id uuid;
  v_body text;
  v_image_count integer;
  v_path text;
  v_path_prefix text;
  v_now timestamptz;
  v_review_id uuid;
  v_created_at timestamptz;
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

  if v_caller_deleted_at is not null then
    raise exception 'Your account cannot create reviews.' using detail = 'INTERACTION_BLOCKED';
  end if;

  -- ===================== lock order row (universal serialization point) =====================
  select o.buyer_id, o.shop_id, o.status, o.completed_at
    into v_order_buyer_id, v_order_shop_id, v_order_status, v_order_completed_at
    from public.orders o
    where o.id = p_order_id
    for update;

  if not found then
    raise exception 'Order not found.' using detail = 'ORDER_NOT_FOUND';
  end if;

  if v_order_buyer_id <> v_caller then
    raise exception 'You are not the buyer of this order.' using detail = 'NOT_ORDER_BUYER';
  end if;

  if v_order_status <> 'completed' or v_order_completed_at is null then
    raise exception 'This order is not eligible for review.' using detail = 'ORDER_NOT_REVIEWABLE';
  end if;

  -- ===================== one review per order (pre-check; UNIQUE(order_id) is the final guard) =====================
  if exists (select 1 from public.reviews r where r.order_id = p_order_id) then
    raise exception 'A review already exists for this order.' using detail = 'REVIEW_ALREADY_EXISTS';
  end if;

  -- ===================== derive current shop owner (not trusted from client) =====================
  select s.owner_id into v_shop_owner_id
    from public.shops s
    where s.id = v_order_shop_id;

  -- ===================== peer blocking, both directions -- NEW review only =====================
  if exists (
    select 1 from public.user_blocks ub
    where (ub.blocker_id = v_caller and ub.blocked_id = v_shop_owner_id)
       or (ub.blocker_id = v_shop_owner_id and ub.blocked_id = v_caller)
  ) then
    raise exception 'You cannot review this seller.' using detail = 'INTERACTION_BLOCKED';
  end if;

  -- ===================== admin restrictions -- buyer only; seller suspension does not suppress this =====================
  if exists (
    select 1 from public.user_restrictions ur
    where ur.user_id = v_caller
      and ur.lifted_at is null
      and ur.restriction_type in ('buyer_restricted', 'account_suspended')
  ) then
    raise exception 'You are not able to create reviews right now.' using detail = 'INTERACTION_BLOCKED';
  end if;

  -- ===================== rating validation (explicit; not solely relying on the CHECK) =====================
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'Rating must be between 1 and 5.' using detail = 'RATING_INVALID';
  end if;

  -- ===================== body normalization (optional; whitespace-only collapses to NULL) =====================
  v_body := nullif(regexp_replace(p_body, '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');

  if v_body is not null and char_length(v_body) > 1000 then
    raise exception 'Review text is too long.' using detail = 'REVIEW_BODY_TOO_LONG';
  end if;

  -- ===================== image path validation (0..2, complete ordered set) =====================
  -- Hardened: each path must be exactly this caller's own upload for this
  -- exact order, in the review-images bucket, and must actually exist in
  -- Storage -- not merely a non-blank string. See migration header.
  v_image_count := coalesce(array_length(p_image_paths, 1), 0);

  if v_image_count > 2 then
    raise exception 'A review may have at most 2 images.' using detail = 'TOO_MANY_REVIEW_IMAGES';
  end if;

  if v_image_count > 0 then
    v_path_prefix := 'review-images/' || v_caller::text || '/' || p_order_id::text || '/';

    foreach v_path in array p_image_paths loop
      if v_path is null
         or left(v_path, length(v_path_prefix)) <> v_path_prefix
         or length(v_path) = length(v_path_prefix)
         or not exists (
           select 1 from storage.objects so
           where so.bucket_id = 'review-images'
             and so.name = substring(v_path from length('review-images/') + 1)
         )
      then
        raise exception 'One or more review image paths are invalid.' using detail = 'REVIEW_IMAGE_PATH_INVALID';
      end if;
    end loop;
  end if;

  -- ===================== transaction-stable time, captured after all validation =====================
  v_now := now();

  -- ===================== insert the review (race-safe: order lock already serializes; UNIQUE is the final guard) =====================
  begin
    insert into public.reviews as r (order_id, buyer_id, shop_id, rating, body, created_at, updated_at)
      values (p_order_id, v_caller, v_order_shop_id, p_rating, v_body, v_now, v_now)
      returning r.id, r.created_at into v_review_id, v_created_at;
  exception
    when unique_violation then
      raise exception 'A review already exists for this order.' using detail = 'REVIEW_ALREADY_EXISTS';
  end;

  -- ===================== insert image rows, preserving array order as sort_order 0/1 =====================
  if v_image_count > 0 then
    for i in 1..v_image_count loop
      insert into public.review_images (review_id, storage_path, sort_order)
        values (v_review_id, p_image_paths[i], i - 1);
    end loop;
  end if;

  -- ===================== recalculate Trusted Seller eligibility now that this shop's review count/average may have changed =====================
  perform public.recalculate_trusted_seller(v_order_shop_id);

  -- ===================== notification: seller receives the new review =====================
  insert into public.notifications (recipient_id, type, actor_id, review_id, dedupe_key)
  select v_shop_owner_id, 'new_review', v_caller, v_review_id, v_review_id::text
  where not exists (
    select 1 from public.profiles p where p.id = v_shop_owner_id and p.deleted_at is not null
  )
  on conflict on constraint notifications_recipient_type_dedupe_key do nothing;

  return query
    select v_review_id, v_created_at;
end;
$$;

revoke all on function public.create_review(uuid, integer, text, text[]) from public;
revoke all on function public.create_review(uuid, integer, text, text[]) from anon;
grant execute on function public.create_review(uuid, integer, text, text[]) to authenticated;

-- ============================================================
-- update_review (adds hardened image-path validation only)
-- ============================================================
create or replace function public.update_review(
  p_review_id uuid,
  p_rating integer,
  p_body text default null,
  p_image_paths text[] default '{}'::text[]
)
returns table (
  review_id uuid,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_caller_deleted_at timestamptz;
  v_review_buyer_id uuid;
  v_review_created_at timestamptz;
  v_review_shop_id uuid;
  v_review_order_id uuid;
  v_body text;
  v_image_count integer;
  v_path text;
  v_path_prefix text;
  v_now timestamptz;
  v_updated_at timestamptz;
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

  if v_caller_deleted_at is not null then
    raise exception 'Your account cannot edit reviews.' using detail = 'INTERACTION_BLOCKED';
  end if;

  -- ===================== lock review row (universal serialization point) =====================
  -- order_id is now also read here (previously unused by this function) so
  -- the hardened image-path check below can validate against the review's
  -- own real order -- never trusted from the client, never p_review_id.
  select r.buyer_id, r.created_at, r.shop_id, r.order_id
    into v_review_buyer_id, v_review_created_at, v_review_shop_id, v_review_order_id
    from public.reviews r
    where r.id = p_review_id
    for update;

  if not found then
    raise exception 'Review not found.' using detail = 'REVIEW_NOT_FOUND';
  end if;

  if v_review_buyer_id <> v_caller then
    raise exception 'You are not the author of this review.' using detail = 'NOT_REVIEW_AUTHOR';
  end if;

  -- ===================== 7-day buyer edit window, anchored to reviews.created_at =====================
  if now() >= v_review_created_at + interval '7 days' then
    raise exception 'The review edit window has closed.' using detail = 'REVIEW_EDIT_WINDOW_CLOSED';
  end if;

  -- ===================== admin restrictions -- account_suspended blocks editing; buyer_restricted alone does not =====================
  if exists (
    select 1 from public.user_restrictions ur
    where ur.user_id = v_caller
      and ur.lifted_at is null
      and ur.restriction_type = 'account_suspended'
  ) then
    raise exception 'You are not able to edit reviews right now.' using detail = 'INTERACTION_BLOCKED';
  end if;

  -- ===================== rating validation (identical to create_review) =====================
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'Rating must be between 1 and 5.' using detail = 'RATING_INVALID';
  end if;

  -- ===================== body normalization (identical to create_review) =====================
  v_body := nullif(regexp_replace(p_body, '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');

  if v_body is not null and char_length(v_body) > 1000 then
    raise exception 'Review text is too long.' using detail = 'REVIEW_BODY_TOO_LONG';
  end if;

  -- ===================== image path validation (identical rule to create_review; applies equally to a retained existing image, since the full set is re-validated and re-inserted below) =====================
  v_image_count := coalesce(array_length(p_image_paths, 1), 0);

  if v_image_count > 2 then
    raise exception 'A review may have at most 2 images.' using detail = 'TOO_MANY_REVIEW_IMAGES';
  end if;

  if v_image_count > 0 then
    v_path_prefix := 'review-images/' || v_caller::text || '/' || v_review_order_id::text || '/';

    foreach v_path in array p_image_paths loop
      if v_path is null
         or left(v_path, length(v_path_prefix)) <> v_path_prefix
         or length(v_path) = length(v_path_prefix)
         or not exists (
           select 1 from storage.objects so
           where so.bucket_id = 'review-images'
             and so.name = substring(v_path from length('review-images/') + 1)
         )
      then
        raise exception 'One or more review image paths are invalid.' using detail = 'REVIEW_IMAGE_PATH_INVALID';
      end if;
    end loop;
  end if;

  -- ===================== transaction-stable time =====================
  v_now := now();

  -- ===================== update rating/body only; order_id/buyer_id/shop_id/created_at/reply_* untouched =====================
  update public.reviews as r
    set rating = p_rating,
        body = v_body,
        updated_at = v_now
    where r.id = p_review_id
    returning r.updated_at into v_updated_at;

  -- ===================== atomic image-set replacement =====================
  delete from public.review_images as ri where ri.review_id = p_review_id;

  if v_image_count > 0 then
    for i in 1..v_image_count loop
      insert into public.review_images (review_id, storage_path, sort_order)
        values (p_review_id, p_image_paths[i], i - 1);
    end loop;
  end if;

  -- ===================== recalculate Trusted Seller eligibility now that this shop's average rating may have changed =====================
  perform public.recalculate_trusted_seller(v_review_shop_id);

  return query
    select p_review_id, v_updated_at;
end;
$$;

revoke all on function public.update_review(uuid, integer, text, text[]) from public;
revoke all on function public.update_review(uuid, integer, text, text[]) from anon;
grant execute on function public.update_review(uuid, integer, text, text[]) to authenticated;
