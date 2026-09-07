-- Real Messaging module, read layer: three SECURITY DEFINER RPCs --
-- get_my_conversations, get_conversation_context, get_conversation_messages.
-- No schema/enum change, no new table, no new RLS policy, no existing
-- function touched (start_conversation, send_message, and every RLS
-- policy from 0030/0031/0032 remain byte-for-byte unchanged).
--
-- Why this migration is needed (found during inspection, not assumed)
-- -----------------------------------------------------------------------
-- 0030/0031/0032 build a complete WRITE path (start_conversation,
-- send_message) and RLS that lets a participant directly SELECT their own
-- conversations/messages/conversation_user_states rows. But those RLS
-- policies only ever grant a participant visibility into rows on
-- conversations/messages/conversation_user_states themselves -- they say
-- nothing about shops, listings, or profiles, and confirmed live, no
-- policy anywhere grants a non-owner authenticated user SELECT on shops or
-- listings, and no policy anywhere grants any authenticated user SELECT on
-- another user's profiles row. shops_select_owner (0031) only exposes a
-- caller's OWN shop row. This means a buyer (conversation initiator, not
-- the shop owner) cannot resolve the shop's name/slug/logo via a direct
-- client join, and a seller cannot resolve the initiating buyer's
-- profiles.display_name/avatar via a direct client join either -- both are
-- required to render "other party / shop identity" (this task's own
-- section 4) and neither is reachable through any existing read path.
-- Message history and per-user conversation state ARE fully readable
-- today via existing RLS (conversation_user_states_select_own/update_own,
-- messages_select_participants, conversations_select_participants) --
-- this migration does not duplicate that; it adds exactly the three reads
-- that are otherwise impossible, following this project's own established
-- convention (get_my_shop_orders/get_my_order_detail before it) of the
-- smallest safe read-only migration when a genuine, confirmed gap exists.
--
-- Cursor pagination for message history specifically follows this
-- project's own consistent precedent (get_my_orders, get_my_shop_orders,
-- browse_listings, get_my_favorites): every paginated list in this schema
-- is implemented as SQL keyset pagination inside a SECURITY DEFINER RPC,
-- never as raw PostgREST composite-cursor filters from the client, even
-- where RLS would technically allow a direct table read -- get_conversation_
-- messages follows that same convention for consistency, rather than
-- inventing a new, less-tested client-side pagination mechanism for this
-- one feature.
--
-- Toggle actions (mark read/unread, archive/unarchive, mute/unmute)
-- deliberately get NO new RPC here, per 0030/0031's own explicit locked
-- design ("no toggle RPCs are created, per locked scope" -- conversation_
-- user_states_update_own already lets a user UPDATE only their own state
-- row) -- the frontend performs these as plain client-side UPDATEs against
-- conversation_user_states, exactly as designed. This migration does not
-- relitigate or duplicate that.
--
-- Canonical-doc recheck: PRD 25.7 lists inbox conversation-list fields
-- (other party/shop identity, listing context, latest message, unread) --
-- exactly what get_my_conversations resolves. PRD 25.7's inbox SEARCH and
-- the "All/Unread/Archived" filter tabs are NOT implemented by this
-- migration or the frontend built on it (see this task's own report) --
-- get_my_conversations supports only the binary archived/non-archived
-- split needed for "Archive hides a conversation from the main inbox but
-- preserves history" (PRD 25.8); unread is already computable per-row from
-- the fields this migration returns, so no separate "Unread" filter
-- parameter is needed to satisfy PRD 25.8's retention rule, and full-text
-- search over participant/shop/listing metadata is out of scope for this
-- pass (reported as deferred, not silently dropped).
--
-- Pre-inspection findings (read-only, immediately before writing this
-- file)
-- -----------------------------------------------------------------------
-- Migration history ends at 0045_buyer_order_detail_cancellation_request
-- (confirmed live, no drift); this is the next migration. Confirmed live,
-- via pg_get_functiondef, that start_conversation/send_message are exactly
-- as left by 0032, and that conversations/messages/conversation_user_states/
-- user_blocks carry exactly the RLS policies listed in 0031's own header
-- (no drift). conversation_type_enum confirmed exactly {listing_inquiry,
-- general_shop}. listing_status_enum confirmed exactly {draft, available,
-- reserved, paused, sold, archived}. shops columns confirmed: id, owner_id,
-- name, slug, description, logo_storage_path, status, is_trusted_seller,
-- ... (0007, unchanged). listings columns confirmed: id, shop_id, title,
-- public_code, status, cover_image_id, ... (0008, unchanged); cover image
-- resolved via listing_images.storage_path through listings.cover_image_id,
-- the identical join shape already used by browse_listings/get_listing_detail
-- (0036). profiles columns confirmed: id, display_name (not null),
-- avatar_storage_path (nullable), deleted_at (nullable) (0004, unchanged).
-- conversation_user_states columns confirmed: conversation_id, user_id,
-- last_read_at, archived_at, muted, marked_unread_at, updated_at (0030,
-- unchanged) -- read/unread semantics reused exactly as documented in
-- 0030's own header (unread iff marked_unread_at is not null, or
-- last_read_at is null, or conversations.last_message_at > last_read_at).
--
-- Security: all three functions are SECURITY DEFINER, SET search_path = '',
-- every table reference fully schema-qualified, every ambiguous-with-an-
-- output-column read alias-qualified. Every function derives the caller
-- exclusively from auth.uid() -- no client-supplied user/shop/participant
-- id is ever trusted as an identity claim (p_conversation_id is an opaque
-- lookup key, not a trust claim: each function re-derives participation
-- from the row it names and rejects/hides accordingly). A conversation the
-- caller does not participate in, or a nonexistent conversation id, both
-- resolve to zero rows from get_conversation_context and
-- get_conversation_messages -- the frontend maps both identically to
-- Next's notFound(), exactly mirroring get_my_order_detail's established
-- privacy pattern ("another conversation must be inaccessible, in a way
-- indistinguishable from nonexistent"). REVOKE ALL FROM public/anon, GRANT
-- EXECUTE TO authenticated only, on all three -- messaging is a sign-in-only
-- surface, matching orders/cart/favorites/seller-orders.

-- ============================================================
-- get_my_conversations
-- ============================================================
create or replace function public.get_my_conversations(
  p_limit integer default 20,
  p_before_last_message_at timestamptz default null,
  p_before_id uuid default null,
  p_archived boolean default false
)
returns table (
  conversation_id uuid,
  conversation_type public.conversation_type_enum,
  viewer_role text,
  shop_id uuid,
  shop_slug text,
  shop_name text,
  shop_logo_storage_path text,
  listing_id uuid,
  listing_public_code text,
  listing_title text,
  listing_cover_image_storage_path text,
  other_party_display_name text,
  other_party_avatar_storage_path text,
  last_message_at timestamptz,
  last_message_preview text,
  last_message_is_mine boolean,
  is_unread boolean,
  is_archived boolean,
  is_muted boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_id uuid;
  v_deleted_at timestamptz;
begin
  v_caller_id := auth.uid();
  if v_caller_id is null then
    raise exception 'Authentication required.' using detail = 'NOT_AUTHENTICATED';
  end if;

  select p.deleted_at into v_deleted_at
    from public.profiles p
    where p.id = v_caller_id;

  if not found or v_deleted_at is not null then
    return;
  end if;

  if p_limit is null or p_limit < 1 or p_limit > 50 then
    raise exception 'Limit must be between 1 and 50.' using detail = 'LIMIT_INVALID';
  end if;

  if (p_before_last_message_at is null) <> (p_before_id is null) then
    raise exception 'Cursor values must be supplied together.' using detail = 'CURSOR_INVALID';
  end if;

  return query
    with combined as (
      -- viewer is the conversation's initiator ("buyer" role) -- other
      -- party is the shop itself.
      select
        c.id as conv_id,
        c.conversation_type as conv_type,
        'initiator'::text as v_role,
        s.id as shop_id,
        s.slug as shop_slug,
        s.name as shop_name,
        s.logo_storage_path as shop_logo,
        l.id as listing_id,
        l.public_code as listing_public_code,
        l.title as listing_title,
        img.storage_path as listing_cover_image,
        null::text as other_name,
        null::text as other_avatar,
        c.last_message_at as conv_last_message_at,
        cus.archived_at as cus_archived_at,
        cus.muted as cus_muted,
        cus.last_read_at as cus_last_read_at,
        cus.marked_unread_at as cus_marked_unread_at
      from public.conversations c
      join public.shops s on s.id = c.shop_id
      left join public.listings l on l.id = c.listing_id
      left join public.listing_images img on img.id = l.cover_image_id
      left join public.conversation_user_states cus
        on cus.conversation_id = c.id and cus.user_id = v_caller_id
      where c.initiator_id = v_caller_id

      union all

      -- viewer owns the shop ("seller" role) -- other party is the buyer
      -- who initiated the thread.
      select
        c.id,
        c.conversation_type,
        'seller'::text,
        s.id,
        s.slug,
        s.name,
        s.logo_storage_path,
        l.id,
        l.public_code,
        l.title,
        img.storage_path,
        p.display_name,
        p.avatar_storage_path,
        c.last_message_at,
        cus.archived_at,
        cus.muted,
        cus.last_read_at,
        cus.marked_unread_at
      from public.conversations c
      join public.shops s on s.id = c.shop_id
      join public.profiles p on p.id = c.initiator_id
      left join public.listings l on l.id = c.listing_id
      left join public.listing_images img on img.id = l.cover_image_id
      left join public.conversation_user_states cus
        on cus.conversation_id = c.id and cus.user_id = v_caller_id
      where s.owner_id = v_caller_id
    )
    select
      combined.conv_id as conversation_id,
      combined.conv_type as conversation_type,
      combined.v_role as viewer_role,
      combined.shop_id,
      combined.shop_slug,
      combined.shop_name,
      combined.shop_logo as shop_logo_storage_path,
      combined.listing_id,
      combined.listing_public_code,
      combined.listing_title,
      combined.listing_cover_image as listing_cover_image_storage_path,
      combined.other_name as other_party_display_name,
      combined.other_avatar as other_party_avatar_storage_path,
      combined.conv_last_message_at as last_message_at,
      lm.body as last_message_preview,
      (lm.sender_id = v_caller_id) as last_message_is_mine,
      coalesce(
        combined.cus_marked_unread_at is not null
          or combined.cus_last_read_at is null
          or combined.conv_last_message_at > combined.cus_last_read_at,
        true
      ) as is_unread,
      coalesce(combined.cus_archived_at is not null, false) as is_archived,
      coalesce(combined.cus_muted, false) as is_muted
    from combined
    left join lateral (
      select m.body, m.sender_id
      from public.messages m
      where m.conversation_id = combined.conv_id
      order by m.created_at desc, m.id desc
      limit 1
    ) lm on true
    where
      (case when p_archived then combined.cus_archived_at is not null else combined.cus_archived_at is null end)
      and (
        p_before_last_message_at is null
        or (combined.conv_last_message_at, combined.conv_id) < (p_before_last_message_at, p_before_id)
      )
    order by combined.conv_last_message_at desc, combined.conv_id desc
    limit p_limit;
end;
$$;

revoke all on function public.get_my_conversations(integer, timestamptz, uuid, boolean) from public;
revoke all on function public.get_my_conversations(integer, timestamptz, uuid, boolean) from anon;
grant execute on function public.get_my_conversations(integer, timestamptz, uuid, boolean) to authenticated;

-- ============================================================
-- get_conversation_context
-- ============================================================
-- Single-row display-metadata resolution for one conversation, plus a
-- best-effort can_send hint mirroring send_message's own eligibility
-- checks exactly (restrictions + bidirectional blocks) -- this is a UI
-- convenience only; send_message remains the sole authoritative
-- enforcement point regardless of what this function returns.
create or replace function public.get_conversation_context(
  p_conversation_id uuid
)
returns table (
  conversation_id uuid,
  conversation_type public.conversation_type_enum,
  viewer_role text,
  shop_id uuid,
  shop_slug text,
  shop_name text,
  shop_logo_storage_path text,
  listing_id uuid,
  listing_public_code text,
  listing_title text,
  listing_status public.listing_status_enum,
  listing_cover_image_storage_path text,
  other_party_display_name text,
  other_party_avatar_storage_path text,
  is_archived boolean,
  is_muted boolean,
  can_send boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_id uuid;
  v_initiator_id uuid;
  v_shop_id uuid;
  v_listing_id uuid;
  v_conversation_type public.conversation_type_enum;
  v_shop_owner_id uuid;
  v_viewer_role text;
  v_blocked boolean;
  v_initiator_restricted boolean;
  v_owner_restricted boolean;
begin
  v_caller_id := auth.uid();
  if v_caller_id is null then
    raise exception 'Authentication required.' using detail = 'NOT_AUTHENTICATED';
  end if;

  select c.initiator_id, c.shop_id, c.listing_id, c.conversation_type
    into v_initiator_id, v_shop_id, v_listing_id, v_conversation_type
    from public.conversations c
    where c.id = p_conversation_id;

  if not found then
    return;
  end if;

  select s.owner_id into v_shop_owner_id
    from public.shops s
    where s.id = v_shop_id;

  if v_caller_id = v_initiator_id then
    v_viewer_role := 'initiator';
  elsif v_caller_id = v_shop_owner_id then
    v_viewer_role := 'seller';
  else
    return;
  end if;

  select exists (
    select 1
    from public.user_blocks ub
    where (ub.blocker_id = v_initiator_id and ub.blocked_id = v_shop_owner_id)
       or (ub.blocker_id = v_shop_owner_id and ub.blocked_id = v_initiator_id)
  ) into v_blocked;

  select exists (
    select 1
    from public.user_restrictions ur
    where ur.user_id = v_initiator_id
      and ur.lifted_at is null
      and ur.restriction_type in ('buyer_restricted', 'account_suspended')
  ) into v_initiator_restricted;

  select exists (
    select 1
    from public.user_restrictions ur
    where ur.user_id = v_shop_owner_id
      and ur.lifted_at is null
      and ur.restriction_type in ('seller_suspended', 'account_suspended')
  ) into v_owner_restricted;

  return query
    select
      c.id as conversation_id,
      c.conversation_type,
      v_viewer_role as viewer_role,
      s.id as shop_id,
      s.slug as shop_slug,
      s.name as shop_name,
      s.logo_storage_path as shop_logo_storage_path,
      l.id as listing_id,
      l.public_code as listing_public_code,
      l.title as listing_title,
      l.status as listing_status,
      img.storage_path as listing_cover_image_storage_path,
      case when v_viewer_role = 'seller' then p.display_name else null end as other_party_display_name,
      case when v_viewer_role = 'seller' then p.avatar_storage_path else null end as other_party_avatar_storage_path,
      coalesce(cus.archived_at is not null, false) as is_archived,
      coalesce(cus.muted, false) as is_muted,
      (not v_blocked and not v_initiator_restricted and not v_owner_restricted) as can_send
    from public.conversations c
    join public.shops s on s.id = c.shop_id
    join public.profiles p on p.id = c.initiator_id
    left join public.listings l on l.id = c.listing_id
    left join public.listing_images img on img.id = l.cover_image_id
    left join public.conversation_user_states cus
      on cus.conversation_id = c.id and cus.user_id = v_caller_id
    where c.id = p_conversation_id;
end;
$$;

revoke all on function public.get_conversation_context(uuid) from public;
revoke all on function public.get_conversation_context(uuid) from anon;
grant execute on function public.get_conversation_context(uuid) to authenticated;

-- ============================================================
-- get_conversation_messages
-- ============================================================
-- Cursor-paginated message history, newest-first (matching every other
-- list in this schema) -- the frontend reverses this page for chronological
-- display and prepends earlier pages on "Load earlier". Never exposes
-- sender_id as a raw id -- only is_mine, since that is the only fact any
-- UI in this module needs (which side of the conversation to render a
-- bubble on). A conversation the caller does not participate in, or a
-- nonexistent id, resolves to zero rows on the FIRST (uncursored) call,
-- identical to get_conversation_context's own not-found behavior; a zero-
-- row result on a CURSORED call simply means no earlier messages remain,
-- exactly like every other cursor list in this schema.
create or replace function public.get_conversation_messages(
  p_conversation_id uuid,
  p_limit integer default 30,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null
)
returns table (
  message_id uuid,
  is_mine boolean,
  body text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_id uuid;
  v_initiator_id uuid;
  v_shop_id uuid;
  v_shop_owner_id uuid;
begin
  v_caller_id := auth.uid();
  if v_caller_id is null then
    raise exception 'Authentication required.' using detail = 'NOT_AUTHENTICATED';
  end if;

  select c.initiator_id, c.shop_id
    into v_initiator_id, v_shop_id
    from public.conversations c
    where c.id = p_conversation_id;

  if not found then
    return;
  end if;

  select s.owner_id into v_shop_owner_id
    from public.shops s
    where s.id = v_shop_id;

  if v_caller_id <> v_initiator_id and v_caller_id <> v_shop_owner_id then
    return;
  end if;

  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'Limit must be between 1 and 100.' using detail = 'LIMIT_INVALID';
  end if;

  if (p_before_created_at is null) <> (p_before_id is null) then
    raise exception 'Cursor values must be supplied together.' using detail = 'CURSOR_INVALID';
  end if;

  return query
    select
      m.id as message_id,
      (m.sender_id = v_caller_id) as is_mine,
      m.body,
      m.created_at
    from public.messages m
    where m.conversation_id = p_conversation_id
      and (
        p_before_created_at is null
        or (m.created_at, m.id) < (p_before_created_at, p_before_id)
      )
    order by m.created_at desc, m.id desc
    limit p_limit;
end;
$$;

revoke all on function public.get_conversation_messages(uuid, integer, timestamptz, uuid) from public;
revoke all on function public.get_conversation_messages(uuid, integer, timestamptz, uuid) from anon;
grant execute on function public.get_conversation_messages(uuid, integer, timestamptz, uuid) to authenticated;
