-- Adds exactly two small, read-only scalar RPCs so the header's two
-- unread badges (Messages, Bell) can be exact rather than the frontend's
-- current bounded first-20-rows approximation:
--
--   - public.get_my_unread_conversation_count()
--   - public.get_my_general_notification_unread_count()
--
-- Both are pure counting reads of data the caller already has full,
-- unrestricted access to via existing canonical RPCs (get_my_conversations,
-- get_my_notifications) and existing RLS (conversation_user_states_select_own,
-- notifications_select_own) -- this migration adds no new capability, only
-- a cheaper way to get a count instead of fetching and counting a page of
-- rows. No table, column, enum, index, trigger, RLS policy, grant on any
-- existing object, or publication membership is touched.
--
-- A. get_my_unread_conversation_count()
-- -----------------------------------------------------------------------
-- Returns exactly: the number of non-archived conversations currently
-- unread for auth.uid(), using the identical "am I a participant" union
-- (initiator_id = caller, or shop_id owned by caller) and the identical
-- is_unread/is_archived semantics get_my_conversations (0046) already
-- uses per row -- copied verbatim from its own combined-CTE/coalesce
-- expressions, just aggregated into count(*) instead of returned as rows,
-- and with no LIMIT/cursor (a genuine total, not bounded to a page). The
-- Messages badge is a count of UNREAD CONVERSATIONS, never unread
-- individual messages -- a conversation with five new unread messages
-- still counts once here, exactly like get_my_conversations' own
-- per-conversation is_unread flag already does.
--
-- B. get_my_general_notification_unread_count()
-- -----------------------------------------------------------------------
-- Returns exactly: count(*) from public.notifications where
-- recipient_id = auth.uid(), read_at is null, and type <> 'new_message'.
-- Identical shape to the existing get_my_notification_unread_count (0040)
-- with exactly one added predicate -- new_message is deliberately excluded
-- so a new message never inflates the Bell (that badge is for general
-- marketplace notifications only; new_message drives the Messages badge
-- via (A) instead). get_my_notification_unread_count itself is untouched
-- and remains available; it is simply not the right query for either
-- badge going forward.
--
-- Security, matching every existing canonical read RPC in this schema
-- exactly: SECURITY DEFINER, SET search_path = '', auth.uid() required
-- (NOT_AUTHENTICATED otherwise), the caller's own profiles.deleted_at
-- checked (0 returned for a deleted/anonymized account, never an error --
-- same convention as get_my_notification_unread_count), revoked from
-- public/anon, granted to authenticated only. No parameter accepts a
-- caller-supplied id of any kind -- both functions derive the caller
-- exclusively from auth.uid().

create or replace function public.get_my_unread_conversation_count()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_id uuid;
  v_deleted_at timestamptz;
  v_count integer;
begin
  v_caller_id := auth.uid();
  if v_caller_id is null then
    raise exception 'Authentication required.' using detail = 'NOT_AUTHENTICATED';
  end if;

  select p.deleted_at into v_deleted_at
    from public.profiles p
    where p.id = v_caller_id;

  if not found or v_deleted_at is not null then
    return 0;
  end if;

  with combined as (
    -- viewer is the conversation's initiator ("buyer" role).
    select
      c.id as conv_id,
      c.last_message_at as conv_last_message_at,
      cus.archived_at as cus_archived_at,
      cus.last_read_at as cus_last_read_at,
      cus.marked_unread_at as cus_marked_unread_at
    from public.conversations c
    left join public.conversation_user_states cus
      on cus.conversation_id = c.id and cus.user_id = v_caller_id
    where c.initiator_id = v_caller_id

    union all

    -- viewer owns the shop ("seller" role).
    select
      c.id,
      c.last_message_at,
      cus.archived_at,
      cus.last_read_at,
      cus.marked_unread_at
    from public.conversations c
    join public.shops s on s.id = c.shop_id
    left join public.conversation_user_states cus
      on cus.conversation_id = c.id and cus.user_id = v_caller_id
    where s.owner_id = v_caller_id
  )
  select count(*) into v_count
    from combined
    where combined.cus_archived_at is null
      and coalesce(
        combined.cus_marked_unread_at is not null
          or combined.cus_last_read_at is null
          or combined.conv_last_message_at > combined.cus_last_read_at,
        true
      );

  return v_count;
end;
$$;

revoke all on function public.get_my_unread_conversation_count() from public;
revoke all on function public.get_my_unread_conversation_count() from anon;
grant execute on function public.get_my_unread_conversation_count() to authenticated;

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
      and n.type <> 'new_message';

  return v_count;
end;
$$;

revoke all on function public.get_my_general_notification_unread_count() from public;
revoke all on function public.get_my_general_notification_unread_count() from anon;
grant execute on function public.get_my_general_notification_unread_count() to authenticated;
