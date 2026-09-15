-- Seller Direct Messaging from Customer Orders, backend foundation only.
-- Adds exactly two new SECURITY DEFINER RPCs:
--   - public.get_conversation_for_shop_order  (pure lookup, zero writes)
--   - public.start_conversation_from_order    (seller's first message to
--     the buyer of one of their own orders, atomically creating/reusing
--     the GENERAL buyer<->shop conversation)
-- No table, column, enum, index, trigger, RLS policy, or publication
-- change of any kind. start_conversation, send_message, get_my_conversations,
-- get_conversation_context, get_conversation_messages, both unread-count
-- RPCs, and every existing RLS policy on the four messaging tables remain
-- byte-for-byte untouched -- this migration is purely additive.
--
-- Why two RPCs, not one (per the accepted follow-up audit)
-- -----------------------------------------------------------------------
-- The read-only audits (this session, immediately preceding this
-- migration) established that "conversation creation = first real
-- message" must remain an absolute invariant: tracing get_my_conversations
-- (0046) and get_my_unread_conversation_count (0088) against a
-- hypothetical empty conversation proved that both already compute
-- is_unread as `... or cus.last_read_at is null or ...` -- a freshly
-- inserted recipient state row (last_read_at defaulting to NULL) would
-- satisfy that immediately, so an empty conversation would show up in the
-- buyer's inbox as UNREAD, with a blank last_message_preview (the LEFT
-- JOIN LATERAL against messages returns no row), sorted at the very top
-- (last_message_at = now()) -- a visible, false-positive "ghost" unread
-- thread with zero content, purely from a seller clicking a button. A
-- single combined "lookup-or-create-with-nullable-body" RPC would either
-- need that exact unsafe empty-creation branch, or an ambiguous
-- nullable-p_body signature inviting a real caller mistake. Two small,
-- single-purpose functions -- a pure read that never writes anything, and
-- a write that always pairs conversation creation with a real message,
-- exactly like start_conversation already does -- avoids the empty-
-- conversation state entirely by construction, and matches this schema's
-- own established precedent of adding a narrow new function rather than
-- overloading an existing wide one (get_conversation_block_state, 0072,
-- was added for the identical reason rather than widening
-- get_conversation_context).
--
-- Pre-inspection findings (read-only, immediately before writing this
-- migration; live database re-confirmed via pg_get_functiondef/
-- information_schema, not assumed from local files)
-- -----------------------------------------------------------------------
-- Migration history ends at 0092_account_profile_management (confirmed
-- live via list_migrations); this is the next migration. 0086 remains
-- intentionally absent, as instructed -- migration numbers are a local
-- filename convention only and this gap does not affect the live
-- migrations table. start_conversation and send_message re-fetched live
-- via pg_get_functiondef are byte-for-byte identical to their known
-- 0031/0032 shape (including the state-row-invariant guard added by
-- 0032) -- neither has drifted, and neither is touched here.
-- get_my_shop_order_detail (0043) re-fetched live confirms the exact
-- seller-authorization shape this migration's lookup RPC copies:
-- `select s.id into v_shop_id from shops s where s.owner_id = v_caller;
-- if not found then return; end if;` then filtering orders by
-- `o.shop_id = v_shop_id` -- never returning shop_id to the caller.
-- public.orders confirmed live: id/public_code/buyer_id/shop_id/status/...,
-- with orders_public_code_key a genuine table-wide UNIQUE constraint (not
-- scoped per shop) and orders_buyer_id_fkey/orders_shop_id_fkey both
-- ON DELETE RESTRICT -- so p_order_public_code alone unambiguously
-- resolves to at most one order, exactly like get_my_shop_order_detail's
-- own p_public_code parameter already assumes. public.conversations'
-- live indexes confirmed unchanged from 0030: conversations_pkey,
-- conversations_initiator_listing_key (initiator_id, listing_id) WHERE
-- listing_id IS NOT NULL, conversations_initiator_shop_general_key
-- (initiator_id, shop_id) WHERE listing_id IS NULL, plus the two inbox
-- indexes -- conversations_initiator_shop_general_key is reused as-is
-- (no new index) as the sole source of truth for "the one canonical
-- GENERAL buyer<->shop thread." notifications_recipient_type_dedupe_key
-- confirmed live as the exact constraint name send_message/
-- start_conversation already use for their own idempotent notification
-- INSERT -- reused verbatim, not re-derived. 'ORDER_NOT_FOUND' confirmed
-- as this schema's own long-established detail code for "order not found
-- or not the caller's" across a dozen existing seller/buyer order RPCs
-- (0016 through 0040) -- reused verbatim rather than inventing a new code.
--
-- get_conversation_for_shop_order
-- -----------------------------------------------------------------------
-- Pure read, zero writes of any kind -- no INSERT/UPDATE/DELETE statement
-- appears anywhere in this function's body. Authorization is identical in
-- shape to get_my_shop_order_detail (0043): caller's own shop is derived
-- from shops.owner_id = auth.uid() (never accepted as a parameter), and
-- "no shop yet" resolves to a soft zero-row return, matching that
-- function's own convention exactly (no error is raised for that case,
-- consistent with every other seller-order read RPC in this schema).
-- Unlike get_my_shop_order_detail, an order that does not belong to the
-- caller's shop (or does not exist at all) ALSO resolves to a soft
-- zero-row return here rather than an exception -- deliberately chosen so
-- that "no shop", "cross-shop order", "nonexistent order", and "order
-- belongs to my shop but no GENERAL conversation exists yet" are all four
-- indistinguishable outcomes from the caller's perspective (a plain empty
-- result), never a distinguishing error that would let a caller
-- fingerprint which case they hit. buyer_id is read into a local variable
-- purely to build the WHERE clause of the final SELECT -- it is never
-- included in this function's RETURNS TABLE and never appears in the
-- query result in any form, matching this task's own explicit
-- requirement and the same "resolve internally, never expose" pattern
-- send_message/get_conversation_context already use for shop_owner_id/
-- initiator_id. The final SELECT filters strictly to `listing_id is
-- null` -- the GENERAL conversation only, per the locked "always reuse
-- the general conversation, never create one per order" decision; a
-- listing_inquiry conversation between the same two parties (if one
-- exists from an unrelated listing inquiry) is never returned by this
-- function. Deliberately NOT gated by order status, buyer restriction,
-- seller restriction, or buyer deleted_at, per this task's own explicit
-- instruction -- this function only discovers whether a conversation
-- already exists; it grants no read access to that conversation's
-- messages or metadata beyond the bare id, and actual read authorization
-- for whatever the frontend does next remains fully enforced by the
-- existing, unmodified get_conversation_context/get_conversation_messages
-- RPCs and the existing, unmodified conversations_select_participants/
-- messages_select_participants RLS policies -- both of which independently
-- re-derive participation from the conversation row itself and would
-- correctly refuse an unrelated caller regardless of what this function
-- returns.
--
-- start_conversation_from_order
-- -----------------------------------------------------------------------
-- Represents exactly one action: the SELLER sends a real first/next
-- message to the BUYER of one of the seller's own orders, into the
-- GENERAL buyer<->shop conversation (find-or-create). This is the only
-- function in this migration that ever writes anything, and every
-- successful branch through it always pairs any new conversation row with
-- a real message row in the same function invocation -- there is no
-- return path that leaves a newly created conversation without a
-- message, matching start_conversation's own invariant exactly.
--
-- Authorization: identical shape to get_conversation_for_shop_order for
-- deriving the caller's shop and the target order, except an
-- unauthorized/nonexistent order raises the established ORDER_NOT_FOUND
-- exception (this is a write action, so it follows the mutating-RPC
-- convention of raising rather than silently returning, exactly like
-- accept_order_items/mark_order_ready/cancel_accepted_order and every
-- other seller order-lifecycle RPC already do for the identical
-- condition) -- "no shop" and "cross-shop/nonexistent order" both resolve
-- to the exact same ORDER_NOT_FOUND exception, so they remain
-- indistinguishable to the caller even though this path raises rather
-- than returns. No buyer_id, shop_id, conversation_id, or seller_id
-- parameter exists on this function at all -- the buyer is derived
-- exclusively from the authorized order row, never accepted as client
-- input.
--
-- Caller (seller) eligibility: identical
-- profiles.deleted_at-immediately-after-authentication guard
-- start_conversation/send_message already use, verbatim.
--
-- Restrictions and blocking, re-checked fresh, exactly mirroring send_message's
-- own role-based (not caller-based) checks: the buyer (the conversation's
-- initiator role) against {buyer_restricted, account_suspended}; the
-- caller/seller (the shop-owner role) against {seller_suspended,
-- account_suspended}; public.user_blocks in both directions between buyer
-- and caller. All three checks run unconditionally on every call,
-- regardless of whether the conversation already exists or is about to be
-- created -- this function is never given weaker (or stronger) messaging
-- privileges than ordinary send_message/start_conversation already
-- enforce.
--
-- Message normalization: the identical
-- regexp_replace(p_body, '^[[:space:]]+|[[:space:]]+$', '', 'g') expression,
-- MESSAGE_EMPTY/MESSAGE_TOO_LONG (4000 chars) validation -- copied
-- verbatim from start_conversation/send_message, no new message-length
-- policy invented.
--
-- Locked deleted-recipient-on-CREATE rule (the one deliberately new check
-- in this migration, with no prior precedent to fall back on -- see the
-- accepted follow-up audit's own gap analysis: neither start_conversation
-- nor send_message has ever needed to check a RECIPIENT's deleted_at,
-- because until now the recipient of a fresh creation was always a shop
-- owner, never a buyer who could plausibly already be anonymized by the
-- time a seller gets around to messaging them): checked only on the
-- fresh-creation branch (v_conversation_id is null, before the INSERT),
-- immediately after the existing-conversation lookup and immediately
-- before the restrictions/blocking checks below would otherwise be
-- reached for a create -- since the buyer's own row here is what would
-- become the conversation's initiator_id, this reuses profiles.deleted_at,
-- the same anonymization marker every other check in this schema already
-- trusts. Raises the same INTERACTION_BLOCKED detail code every other
-- messaging rejection in this schema already uses -- deliberately not a
-- distinct detail code, so a caller can never learn from the error alone
-- that "deleted buyer" specifically was the reason, only that the
-- interaction cannot proceed, matching the message text's own existing
-- collapsed-reason convention (e.g. start_conversation's identical
-- INTERACTION_BLOCKED covering caller-deleted, restrictions, and blocking
-- alike). An EXISTING GENERAL conversation is never subject to this new
-- check at all -- reusing an existing thread with a now-anonymized buyer
-- still only goes through the identical restriction/blocking checks every
-- other send already uses, exactly per the locked instruction that this
-- rule must never destroy historical accessibility.
--
-- Race-safe find-or-create: identical mechanism to start_conversation --
-- the existing-conversation lookup is `FOR UPDATE`; on absence, the
-- INSERT (conversation + both conversation_user_states rows) runs inside
-- a nested BEGIN/EXCEPTION block, and a unique_violation there (a
-- concurrent start_conversation call from the buyer, or a concurrent call
-- to this same function, racing to create the identical logical
-- conversation) is caught and simply re-selects the now-existing row FOR
-- UPDATE, proceeding as a reuse. conversations_initiator_shop_general_key
-- (0030, unchanged) remains the sole uniqueness guarantee; no second
-- index or constraint is added. Exactly matches this task's own
-- instruction that this existing index and pattern must remain the source
-- of truth. State-row roles are inverted relative to start_conversation
-- purely because the CALLER here is the seller/shop-owner role rather than
-- the initiator role: on fresh creation, the buyer's (initiator_id's) own
-- state row is left at column defaults (unread, since they have not yet
-- seen anything), and the caller/seller's state row gets
-- last_read_at = v_now (the sender has, by definition, read up through
-- the message they just sent) -- the identical logic start_conversation
-- already applies, just with the two roles swapped to match who is
-- actually calling.
--
-- Message insert, conversation/state updates, and notification: copied
-- verbatim from start_conversation's/send_message's own converged
-- mutation block -- message inserted with sender_id = v_caller (the
-- seller, never client-supplied beyond auth.uid()), conversations.
-- last_message_at advanced to the same v_now, caller's own state
-- last_read_at advances and marked_unread_at clears, the buyer's state
-- archived_at clears only (an archived thread that just received new
-- information must not stay hidden). The new_message notification insert
-- is byte-for-byte the same guarded pattern already live in both
-- start_conversation and send_message: suppressed if the buyer has muted
-- this conversation, suppressed if the buyer's own profiles.deleted_at is
-- set (so an anonymized buyer with a still-existing older conversation
-- never receives a new in-app notification even though the message
-- itself is still recorded), deduplicated on
-- notifications_recipient_type_dedupe_key using the new message's own id
-- as the dedupe key. No new notification type, no new outbox/email path,
-- no new Realtime publication membership -- this reuses the exact
-- existing new_message pipeline (0040/0083/0087) unconditionally.
--
-- Error codes (both functions combined): NOT_AUTHENTICATED,
-- INTERACTION_BLOCKED (caller-deleted, buyer-deleted-on-create,
-- restrictions, blocking -- all collapsed under this one existing code,
-- consistent with start_conversation/send_message's own convention),
-- ORDER_NOT_FOUND (start_conversation_from_order only -- reused verbatim
-- from a dozen existing order RPCs), MESSAGE_EMPTY, MESSAGE_TOO_LONG,
-- CONVERSATION_STATE_INVALID (the identical corruption guard
-- start_conversation/send_message already carry). No new detail code is
-- introduced anywhere in this migration.
--
-- Privileges: both functions REVOKE ALL FROM PUBLIC, REVOKE ALL FROM
-- anon, GRANT EXECUTE TO authenticated only -- identical grant shape to
-- every other human-facing messaging RPC in this schema.

-- ============================================================
-- get_conversation_for_shop_order
-- ============================================================
create or replace function public.get_conversation_for_shop_order(
  p_order_public_code text
)
returns table (
  conversation_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_shop_id uuid;
  v_order_shop_id uuid;
  v_buyer_id uuid;
begin
  -- ===================== authentication =====================
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'Authentication required.' using detail = 'NOT_AUTHENTICATED';
  end if;

  -- ===================== caller's own shop, never a parameter =====================
  select s.id into v_shop_id
    from public.shops s
    where s.owner_id = v_caller;

  if not found then
    return;
  end if;

  -- ===================== order lookup + shop-ownership match (indistinguishable from nonexistent) =====================
  select o.shop_id, o.buyer_id
    into v_order_shop_id, v_buyer_id
    from public.orders o
    where o.public_code = p_order_public_code;

  if not found or v_order_shop_id <> v_shop_id then
    return;
  end if;

  -- ===================== GENERAL conversation only -- never listing-specific =====================
  return query
    select c.id
      from public.conversations c
      where c.initiator_id = v_buyer_id
        and c.shop_id = v_shop_id
        and c.listing_id is null;
end;
$$;

revoke all on function public.get_conversation_for_shop_order(text) from public;
revoke all on function public.get_conversation_for_shop_order(text) from anon;
grant execute on function public.get_conversation_for_shop_order(text) to authenticated;

comment on function public.get_conversation_for_shop_order(text) is
  'Seller-side pure lookup: returns the existing GENERAL conversation id for the buyer of one of the caller''s own shop orders, or zero rows if none exists yet. Never creates anything; never returns buyer_id or shop_id.';

-- ============================================================
-- start_conversation_from_order
-- ============================================================
create or replace function public.start_conversation_from_order(
  p_order_public_code text,
  p_body text
)
returns table (
  conversation_id uuid,
  message_id uuid,
  message_created_at timestamptz,
  conversation_created boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_caller_deleted_at timestamptz;
  v_shop_id uuid;
  v_order_shop_id uuid;
  v_buyer_id uuid;
  v_buyer_deleted_at timestamptz;
  v_body text;
  v_now timestamptz;
  v_conversation_id uuid;
  v_conversation_created boolean := false;
  v_message_id uuid;
begin
  -- ===================== authentication =====================
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'Authentication required.' using detail = 'NOT_AUTHENTICATED';
  end if;

  -- ===================== caller eligibility (anonymized/deleted account) =====================
  select p.deleted_at into v_caller_deleted_at
    from public.profiles p
    where p.id = v_caller;

  if v_caller_deleted_at is not null then
    raise exception 'Your account cannot send messages.' using detail = 'INTERACTION_BLOCKED';
  end if;

  -- ===================== caller's own shop, never a parameter =====================
  select s.id into v_shop_id
    from public.shops s
    where s.owner_id = v_caller;

  if not found then
    raise exception 'Order not found.' using detail = 'ORDER_NOT_FOUND';
  end if;

  -- ===================== order lookup + shop-ownership match (indistinguishable from nonexistent) =====================
  select o.shop_id, o.buyer_id
    into v_order_shop_id, v_buyer_id
    from public.orders o
    where o.public_code = p_order_public_code;

  if not found or v_order_shop_id <> v_shop_id then
    raise exception 'Order not found.' using detail = 'ORDER_NOT_FOUND';
  end if;

  -- ===================== admin restrictions (role-based, active only) =====================
  if exists (
    select 1
    from public.user_restrictions ur
    where ur.user_id = v_buyer_id
      and ur.lifted_at is null
      and ur.restriction_type in ('buyer_restricted', 'account_suspended')
  ) then
    raise exception 'You cannot message this buyer right now.' using detail = 'INTERACTION_BLOCKED';
  end if;

  if exists (
    select 1
    from public.user_restrictions ur
    where ur.user_id = v_caller
      and ur.lifted_at is null
      and ur.restriction_type in ('seller_suspended', 'account_suspended')
  ) then
    raise exception 'You are not able to send messages right now.' using detail = 'INTERACTION_BLOCKED';
  end if;

  -- ===================== peer blocking (both directions) =====================
  if exists (
    select 1
    from public.user_blocks ub
    where (ub.blocker_id = v_caller and ub.blocked_id = v_buyer_id)
       or (ub.blocker_id = v_buyer_id and ub.blocked_id = v_caller)
  ) then
    raise exception 'You cannot message this buyer.' using detail = 'INTERACTION_BLOCKED';
  end if;

  -- ===================== message normalization =====================
  v_body := regexp_replace(p_body, '^[[:space:]]+|[[:space:]]+$', '', 'g');

  if v_body is null or v_body !~ '[^[:space:]]' then
    raise exception 'Message cannot be empty.' using detail = 'MESSAGE_EMPTY';
  end if;

  if char_length(v_body) > 4000 then
    raise exception 'Message is too long.' using detail = 'MESSAGE_TOO_LONG';
  end if;

  -- ===================== transaction-stable time, captured after all validation =====================
  v_now := now();

  -- ===================== race-safe find existing GENERAL conversation =====================
  select c.id into v_conversation_id
    from public.conversations c
    where c.initiator_id = v_buyer_id and c.shop_id = v_shop_id and c.listing_id is null
    for update;

  -- ===================== fresh creation path only =====================
  if v_conversation_id is null then
    -- Locked rule: never create a brand-new conversation toward an
    -- already anonymized/deleted buyer. Never checked against an
    -- existing conversation -- see this migration's own header.
    select p.deleted_at into v_buyer_deleted_at
      from public.profiles p
      where p.id = v_buyer_id;

    if v_buyer_deleted_at is not null then
      raise exception 'You cannot message this buyer right now.' using detail = 'INTERACTION_BLOCKED';
    end if;

    begin
      insert into public.conversations as c (conversation_type, initiator_id, shop_id, listing_id, last_message_at)
        values ('general_shop', v_buyer_id, v_shop_id, null, v_now)
        returning c.id into v_conversation_id;

      v_conversation_created := true;

      insert into public.conversation_user_states (conversation_id, user_id)
        values (v_conversation_id, v_buyer_id);

      insert into public.conversation_user_states (conversation_id, user_id, last_read_at)
        values (v_conversation_id, v_caller, v_now);
    exception
      when unique_violation then
        -- lost the create race to a concurrent call (buyer-initiated
        -- start_conversation, or another concurrent call to this same
        -- function); reuse the row it created
        v_conversation_created := false;

        select c.id into v_conversation_id
          from public.conversations c
          where c.initiator_id = v_buyer_id and c.shop_id = v_shop_id and c.listing_id is null
          for update;
    end;
  end if;

  -- ===================== state-row invariant for EXISTING conversations only (fresh creation already =====================
  -- ===================== established the invariant atomically two statements above) =====================
  if not v_conversation_created then
    if not exists (
      select 1 from public.conversation_user_states cus
      where cus.conversation_id = v_conversation_id and cus.user_id = v_caller
    ) or not exists (
      select 1 from public.conversation_user_states cus
      where cus.conversation_id = v_conversation_id and cus.user_id = v_buyer_id
    ) then
      raise exception 'Conversation state is missing or corrupted.' using detail = 'CONVERSATION_STATE_INVALID';
    end if;
  end if;

  -- ===================== insert the message (always a fresh row, every call) =====================
  insert into public.messages as m (conversation_id, sender_id, body, created_at)
    values (v_conversation_id, v_caller, v_body, v_now)
    returning m.id into v_message_id;

  update public.conversations as c
    set last_message_at = v_now
    where c.id = v_conversation_id;

  update public.conversation_user_states as cus
    set last_read_at = v_now,
        marked_unread_at = null
    where cus.conversation_id = v_conversation_id and cus.user_id = v_caller;

  update public.conversation_user_states as cus
    set archived_at = null
    where cus.conversation_id = v_conversation_id and cus.user_id <> v_caller;

  -- ===================== notification: buyer only, suppressed if muted or deleted =====================
  if not exists (
    select 1 from public.conversation_user_states cus
    where cus.conversation_id = v_conversation_id
      and cus.user_id = v_buyer_id
      and cus.muted
  ) then
    insert into public.notifications (recipient_id, type, actor_id, conversation_id, dedupe_key)
    select v_buyer_id, 'new_message', v_caller, v_conversation_id, v_message_id::text
    where not exists (
      select 1 from public.profiles p where p.id = v_buyer_id and p.deleted_at is not null
    )
    on conflict on constraint notifications_recipient_type_dedupe_key do nothing;
  end if;

  return query
    select v_conversation_id, v_message_id, v_now, v_conversation_created;
end;
$$;

revoke all on function public.start_conversation_from_order(text, text) from public;
revoke all on function public.start_conversation_from_order(text, text) from anon;
grant execute on function public.start_conversation_from_order(text, text) to authenticated;

comment on function public.start_conversation_from_order(text, text) is
  'Seller sends a real first/next message to the buyer of one of the caller''s own shop orders, atomically finding-or-creating the GENERAL buyer<->shop conversation. Never accepts buyer_id/shop_id/conversation_id; buyer is derived internally from the authorized order. Never creates a conversation without a real message.';
