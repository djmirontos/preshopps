-- ============================================================================
-- 0091_notification_dismiss.sql
--
-- P1: Bell notification dismiss / clear-all.
--
-- Adds soft-dismiss support to public.notifications via a new
-- dismissed_at timestamptz column. Dismissing (individually or via
-- "Clear All") never deletes a notification row and never touches any
-- other table -- notifications are, and remain, pure side-effect/event
-- records (confirmed by audit: 16 separate business RPCs each insert
-- their own notification row as a side effect; nothing else in the
-- schema has a foreign key pointing back into notifications.id).
--
-- Product decision (explicit correction to the original audit's
-- suggestion): "Clear All" dismisses EVERY undismissed notification for
-- the caller, INCLUDING type = 'new_message' rows. This is safe and
-- does not collapse the Bell/Messages separation established by 0088,
-- because:
--   - the Messages badge (get_my_unread_conversation_count, 0088) reads
--     conversation_user_states / conversations, never notifications;
--   - dismissing a notification row only ever writes
--     notifications.dismissed_at -- a column with zero relationship to
--     conversation_user_states, conversations, or messages.
-- So Clear All can dismiss new_message notification rows from the Bell
-- list while leaving conversation read/unread state, and the Messages
-- badge, completely untouched.
--
-- The Bell's own unread COUNT (get_my_general_notification_unread_count)
-- keeps its existing type <> 'new_message' exclusion from 0088 --
-- dismissing new_message rows changes what's visible in the general
-- notification list, not how the Bell count is computed.
-- ============================================================================

-- ===================== schema: soft-dismiss column =====================

alter table public.notifications
  add column dismissed_at timestamptz null;

-- ===================== get_my_notifications: exclude dismissed rows =====================
-- Signature, cursor behavior, page size bounds, result shape, ordering,
-- security, and grants are otherwise byte-for-byte unchanged from the
-- live definition inspected before writing this migration -- the only
-- change is the added "and n.dismissed_at is null" predicate.

create or replace function public.get_my_notifications(
  p_limit integer default 20,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null
)
returns table (
  notification_id uuid,
  type notification_type_enum,
  created_at timestamptz,
  read_at timestamptz,
  actor_display_name text,
  actor_avatar_path text,
  order_id uuid,
  order_public_code text,
  conversation_id uuid,
  conversation_listing_title text,
  review_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_deleted_at timestamptz;
begin
  -- ===================== authentication =====================
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'Authentication required.' using detail = 'NOT_AUTHENTICATED';
  end if;

  -- ===================== limit bounds =====================
  if p_limit is null or p_limit < 1 or p_limit > 50 then
    raise exception 'Limit must be between 1 and 50.' using detail = 'LIMIT_INVALID';
  end if;

  -- ===================== cursor: both-or-neither =====================
  if (p_before_created_at is null) <> (p_before_id is null) then
    raise exception 'Cursor must include both created_at and id, or neither.' using detail = 'CURSOR_INVALID';
  end if;

  -- ===================== missing/deleted caller profile: zero rows, not an error =====================
  select p.deleted_at into v_deleted_at
    from public.profiles p
    where p.id = v_caller;

  if not found or v_deleted_at is not null then
    return;
  end if;

  return query
    select
      n.id as notification_id,
      n.type,
      n.created_at,
      n.read_at,
      case when ap.deleted_at is null then ap.display_name else null end as actor_display_name,
      case when ap.deleted_at is null then ap.avatar_storage_path else null end as actor_avatar_path,
      n.order_id,
      o.public_code as order_public_code,
      n.conversation_id,
      case
        when l.status in ('available', 'reserved', 'sold', 'archived')
          and not exists (
            select 1 from public.user_restrictions ur
            where ur.user_id = ls.owner_id
              and ur.lifted_at is null
              and ur.restriction_type in ('seller_suspended', 'account_suspended')
          )
        then l.title
        else null
      end as conversation_listing_title,
      n.review_id
    from public.notifications n
    left join public.profiles ap on ap.id = n.actor_id
    left join public.orders o on o.id = n.order_id
    left join public.conversations c on c.id = n.conversation_id
    left join public.listings l on l.id = c.listing_id
    left join public.shops ls on ls.id = l.shop_id
    where n.recipient_id = v_caller
      and n.dismissed_at is null
      and (
        p_before_created_at is null
        or n.created_at < p_before_created_at
        or (n.created_at = p_before_created_at and n.id < p_before_id)
      )
    order by n.created_at desc, n.id desc
    limit p_limit;
end;
$$;

revoke all on function public.get_my_notifications(integer, timestamptz, uuid) from public;
revoke all on function public.get_my_notifications(integer, timestamptz, uuid) from anon;
grant execute on function public.get_my_notifications(integer, timestamptz, uuid) to authenticated;

-- ===================== get_my_general_notification_unread_count: exclude dismissed rows =====================
-- Signature/security/grants unchanged; adds "and n.dismissed_at is null"
-- alongside the existing 0088 "type <> 'new_message'" exclusion.

create or replace function public.get_my_general_notification_unread_count()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_deleted_at timestamptz;
  v_count integer;
begin
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'Authentication required.' using detail = 'NOT_AUTHENTICATED';
  end if;

  select p.deleted_at into v_deleted_at
    from public.profiles p
    where p.id = v_caller;

  if not found or v_deleted_at is not null then
    return 0;
  end if;

  select count(*) into v_count
    from public.notifications n
    where n.recipient_id = v_caller
      and n.read_at is null
      and n.type <> 'new_message'
      and n.dismissed_at is null;

  return v_count;
end;
$$;

revoke all on function public.get_my_general_notification_unread_count() from public;
revoke all on function public.get_my_general_notification_unread_count() from anon;
grant execute on function public.get_my_general_notification_unread_count() to authenticated;

-- ===================== get_my_notification_unread_count (legacy, all-types count): exclude dismissed rows =====================
-- Retained as-is otherwise per instruction -- not redesigned or removed,
-- just kept consistent so a dismissed row (of any type) never counts as
-- unread through this legacy path either.

create or replace function public.get_my_notification_unread_count()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_deleted_at timestamptz;
  v_count integer;
begin
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'Authentication required.' using detail = 'NOT_AUTHENTICATED';
  end if;

  select p.deleted_at into v_deleted_at
    from public.profiles p
    where p.id = v_caller;

  if not found or v_deleted_at is not null then
    return 0;
  end if;

  select count(*) into v_count
    from public.notifications n
    where n.recipient_id = v_caller
      and n.read_at is null
      and n.dismissed_at is null;

  return v_count;
end;
$$;

revoke all on function public.get_my_notification_unread_count() from public;
revoke all on function public.get_my_notification_unread_count() from anon;
grant execute on function public.get_my_notification_unread_count() to authenticated;

-- ===================== dismiss_notification: dismiss exactly one, any type =====================
-- Mirrors mark_notification_read's own shape and no-information-leak
-- convention exactly: foreign/nonexistent/already-dismissed id is a
-- silent no-op. May dismiss ANY notification type, including
-- new_message -- dismissal only ever writes notifications.dismissed_at,
-- never conversation_user_states/messages/conversations.

create or replace function public.dismiss_notification(p_notification_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
begin
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'Authentication required.' using detail = 'NOT_AUTHENTICATED';
  end if;

  -- ===================== foreign/nonexistent/already-dismissed: silent no-op, no information leak =====================
  update public.notifications
    set dismissed_at = now()
    where id = p_notification_id
      and recipient_id = v_caller
      and dismissed_at is null;
end;
$$;

revoke all on function public.dismiss_notification(uuid) from public;
revoke all on function public.dismiss_notification(uuid) from anon;
grant execute on function public.dismiss_notification(uuid) to authenticated;

-- ===================== dismiss_all_notifications: clear the entire visible list =====================
-- Named without "general" because this clears every undismissed
-- notification for the caller, including new_message rows -- matching
-- the product decision that "Clear All" must actually clear the visible
-- notification list. Mirrors mark_all_notifications_read's shape
-- (returns affected row count via GET DIAGNOSTICS). Touches only
-- public.notifications; never conversations, conversation_user_states,
-- messages, orders, order items, listings, reviews, disputes, or any
-- moderation/business record.

create or replace function public.dismiss_all_notifications()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_deleted_at timestamptz;
  v_count integer;
begin
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'Authentication required.' using detail = 'NOT_AUTHENTICATED';
  end if;

  select p.deleted_at into v_deleted_at
    from public.profiles p
    where p.id = v_caller;

  if not found or v_deleted_at is not null then
    return 0;
  end if;

  update public.notifications
    set dismissed_at = now()
    where recipient_id = v_caller
      and dismissed_at is null;

  get diagnostics v_count = row_count;

  return v_count;
end;
$$;

revoke all on function public.dismiss_all_notifications() from public;
revoke all on function public.dismiss_all_notifications() from anon;
grant execute on function public.dismiss_all_notifications() to authenticated;
