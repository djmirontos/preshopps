-- Pilot restriction: reject newly-attached review photos server-side.
-- Repository-local until reviewed/applied.
--
-- Why (owner-requested pilot scope cut, not a product decision reversal)
-- -----------------------------------------------------------------------
-- For the pilot launch, buyers must not be able to attach NEW photos to a
-- review, whether creating one or editing one, while rating/text review
-- creation and editing keep working exactly as before. Hiding the upload
-- control in ReviewImagePicker is a UX convenience only -- it is not the
-- enforcement boundary, since create_review/update_review are callable
-- directly. This migration enforces the restriction inside both RPCs.
--
-- Rule:
--   - create_review: there is no existing review yet, so by definition
--     every path in p_image_paths would be a brand-new attachment. Any
--     non-empty p_image_paths is rejected outright with a new error code,
--     REVIEW_IMAGES_DISABLED. A review with zero photos still creates
--     normally -- rating/body are completely unaffected.
--   - update_review: every path in p_image_paths must already be one of
--     THIS review's own currently-stored review_images.storage_path rows
--     (public.review_images, keyed by review_id -- not a prefix/Storage-
--     existence check as before, but a direct membership check against the
--     review's own already-validated, already-legitimate photo set). Any
--     path that is not already attached to this exact review -- a new
--     upload, another review's photo, or a fabricated path -- is rejected
--     with the same REVIEW_IMAGES_DISABLED code. Resubmitting the exact
--     existing set (or any subset of it, e.g. if a caller's photo picker
--     reports fewer paths) is accepted, so a buyer editing only rating/body
--     is never forced to touch or lose their existing photos, and nothing
--     here requires a photo deletion to save. The current pilot frontend
--     (ReviewImagePicker) never reports anything other than exactly the
--     existing set, since it no longer offers add/remove controls at all.
--
-- This supersedes, for the one case it actually changes (a genuinely new
-- path), the general ownership/prefix/storage.objects-existence rule
-- 0105_harden_review_image_path_validation.sql and
-- 0117_review_moderation_edit_guards.sql installed for update_review --
-- every path that could pass the review_images-membership check here was
-- already validated by that exact rule at the time it was first inserted
-- (by create_review, the only path that can ever insert a new photo row),
-- so this is a strictly narrower, not weaker, check. create_review's own
-- hardened prefix/storage.objects validation block is removed because it
-- is now unreachable: any non-empty array is rejected before reaching it.
--
-- Not touched: rating validation, body validation/normalization, the
-- 7-day edit window, the removed-by-moderation guard (0117), peer
-- blocking, admin-restriction checks, the one-review-per-order rule,
-- Trusted Seller recalculation, notification inserts, return shape,
-- SECURITY DEFINER/search_path, or grants. No table, enum, policy, or
-- Storage bucket change of any kind. No image is deleted by this
-- migration -- existing review_images rows for already-created reviews
-- are left exactly as they are; this only narrows what a FUTURE call can
-- attach. No image moderation (content review/approval) is implemented.
--
-- This migration does not revert on its own -- lifting the pilot
-- restriction after launch is a separate, explicit migration that
-- restores (or further revises) the image-path validation rule.

-- ============================================================
-- create_review (rejects any new photo outright; everything else unchanged from 0105)
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

  -- ===================== PILOT RESTRICTION: no new review has any existing photo, so any non-empty p_image_paths is a new attachment =====================
  v_image_count := coalesce(array_length(p_image_paths, 1), 0);

  if v_image_count > 2 then
    raise exception 'A review may have at most 2 images.' using detail = 'TOO_MANY_REVIEW_IMAGES';
  end if;

  if v_image_count > 0 then
    raise exception 'Photo uploads are temporarily unavailable for reviews.' using detail = 'REVIEW_IMAGES_DISABLED';
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

  -- ===================== insert image rows (unreachable today -- v_image_count is always 0 above -- kept so a future lift of this restriction needs no schema/insert-logic change) =====================
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
-- update_review (rejects any photo not already attached to this exact review; everything else unchanged from 0117)
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
  v_review_removed_at timestamptz;
  v_body text;
  v_image_count integer;
  v_path text;
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
  select r.buyer_id, r.created_at, r.shop_id, r.order_id, r.removed_at
    into v_review_buyer_id, v_review_created_at, v_review_shop_id, v_review_order_id, v_review_removed_at
    from public.reviews r
    where r.id = p_review_id
    for update;

  if not found then
    raise exception 'Review not found.' using detail = 'REVIEW_NOT_FOUND';
  end if;

  if v_review_buyer_id <> v_caller then
    raise exception 'You are not the author of this review.' using detail = 'NOT_REVIEW_AUTHOR';
  end if;

  -- ===================== removed by moderation: no buyer edits (read under the review row lock above) =====================
  if v_review_removed_at is not null then
    raise exception 'This review was removed by moderation.' using detail = 'REVIEW_REMOVED';
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

  -- ===================== PILOT RESTRICTION: every submitted path must already be one of THIS review's own currently-stored photos -- no new attachment, no other review's photo, no fabricated path. Resubmitting the existing set (or any subset) is accepted, so editing rating/body never requires touching or losing existing photos. =====================
  v_image_count := coalesce(array_length(p_image_paths, 1), 0);

  if v_image_count > 2 then
    raise exception 'A review may have at most 2 images.' using detail = 'TOO_MANY_REVIEW_IMAGES';
  end if;

  if v_image_count > 0 then
    foreach v_path in array p_image_paths loop
      if v_path is null
         or not exists (
           select 1 from public.review_images ri
           where ri.review_id = p_review_id
             and ri.storage_path = v_path
         )
      then
        raise exception 'Photo uploads are temporarily unavailable for reviews.' using detail = 'REVIEW_IMAGES_DISABLED';
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

  -- ===================== atomic image-set replacement (every path here was just confirmed to already belong to this review, so this never drops a photo the caller didn't already omit) =====================
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
