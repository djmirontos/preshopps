-- Corrects a genuine invariant gap in public.start_conversation, discovered
-- and confirmed live during 0031's verification: when reusing an EXISTING
-- conversation, the function did not verify that both expected
-- conversation_user_states rows still exist before inserting another
-- message. public.send_message already fails closed on the identical
-- corruption with CONVERSATION_STATE_INVALID -- this migration brings
-- start_conversation's reuse path up to the same standard, using
-- send_message's own guard as the reference pattern. Touches ONLY
-- public.start_conversation(uuid, text, uuid) -- CREATE OR REPLACE under
-- its unchanged signature, plus its unchanged privilege statements
-- restated for explicitness. No other object of any kind is created,
-- dropped, or altered: send_message, every RLS policy, every table,
-- constraint, index, trigger, and enum are all left exactly as 0031 left
-- them.
--
-- Pre-inspection findings (read-only, immediately before writing this
-- file)
-- -----------------------------------------------------------------------
-- Migration history ends at 0031_messaging_rls_and_rpcs; this is the next
-- migration. public.start_conversation(uuid, text, uuid) and
-- public.send_message(uuid, text) both exist exactly as applied in 0031
-- (full live definitions re-read via pg_get_functiondef). Confirmed the
-- known gap precisely: start_conversation's "fresh creation path only"
-- block (guarded by `if v_conversation_id is null then ... end if;`)
-- creates the conversation row and both conversation_user_states rows
-- atomically, but everything after that block -- the message insert,
-- conversations.last_message_at update, and both state-row updates --
-- runs unconditionally, with no check that an EXISTING conversation's two
-- state rows are still present. Confirmed send_message's existing guard
-- (the reference pattern reused here verbatim, just re-targeted at
-- start_conversation's own resolved identities):
--   if not exists (select 1 from conversation_user_states cus where
--     cus.conversation_id = ... and cus.user_id = <party A>)
--   or not exists (select 1 from conversation_user_states cus where
--     cus.conversation_id = ... and cus.user_id = <party B>)
--   then raise exception ... using detail = 'CONVERSATION_STATE_INVALID';
-- Confirmed conversation_user_states' schema is unchanged
-- (conversation_id, user_id, last_read_at, archived_at, muted,
-- marked_unread_at, updated_at) and that exactly two rows are expected
-- per conversation for its entire lifetime (one per initiator, one per
-- shop owner, both inserted atomically by start_conversation's own
-- fresh-creation path, matching 0030/0031's locked design). Confirmed
-- live that conversation_user_states carries only two policies --
-- conversation_user_states_select_own (SELECT) and
-- conversation_user_states_update_own (UPDATE), both scoped to auth.uid()
-- = user_id -- and no INSERT or DELETE policy exists at all. This
-- confirms normal authenticated users cannot create the underlying
-- corruption directly: they can neither delete a state row (no DELETE
-- policy) nor insert one out-of-band (no INSERT policy); the corruption
-- this migration guards against requires privileged/direct database
-- access, exactly as it did when reproduced for 0031's verification. This
-- is therefore a genuine invariant-consistency fix, not a response to a
-- reachable authorization or privacy exposure.
--
-- The fix
-- -----------------------------------------------------------------------
-- A single new guard is inserted immediately after the existing
-- "if v_conversation_id is null then ... end if;" block closes (the block
-- that already handles fresh creation, including the create-race
-- unique_violation recovery) and immediately before the pre-existing
-- "insert the message" step -- the one location in the function where
-- v_conversation_id and v_conversation_created are both finalized
-- regardless of which of the three paths was taken (found immediately,
-- freshly created, or race-loss re-select), and before any further
-- mutation occurs.
--
-- The new guard is conditioned on `if not v_conversation_created then`,
-- deliberately skipping the check on the fresh-creation path per the
-- locked instruction not to add unnecessary/redundant work there: a
-- freshly created conversation's two state rows were just inserted two
-- statements earlier in the same transaction by this same function call,
-- so re-verifying their existence immediately afterward would trivially
-- always pass and adds nothing -- fresh creation already establishes the
-- invariant atomically, exactly as noted in the task brief. The guard
-- therefore runs on exactly the two paths that are semantically "an
-- EXISTING conversation": (1) the conversation was found immediately by
-- the initial FOR UPDATE lookup (v_conversation_id was already non-NULL,
-- v_conversation_created stays at its initialized default of false), and
-- (2) this call lost the create race, caught unique_violation, and
-- re-selected the winning row (v_conversation_created is explicitly set
-- to false in that exception handler before the re-select) -- per the
-- locked instruction, the race-loss branch is semantically an existing-
-- conversation path and must not bypass the guard, and this placement
-- guarantees it cannot, since the check sits after both branches
-- reconverge and reads the same v_conversation_created flag either branch
-- would have set.
--
-- The two required identities checked are exactly the ones send_message
-- itself already trusts for this same conversation shape: v_caller (who,
-- on this code path, is always resolved as the conversation's
-- initiator -- self-message was already rejected earlier in this same
-- function, so caller and shop owner are always distinct) and
-- v_shop_owner_id (the shop's current owner, already looked up earlier in
-- this call). No new lookup is introduced -- both identities were already
-- resolved and held in existing local variables before this guard was
-- ever reached. No seller_id column is added to conversations and no
-- ownership semantics are redesigned -- this reuses 0030/0031's existing,
-- unchanged "seller is derived from the shop's current owner" model
-- exactly as-is.
--
-- Failure is CONVERSATION_STATE_INVALID -- send_message's own established
-- code, reused verbatim rather than inventing MISSING_STATE/
-- STATE_NOT_FOUND/CONVERSATION_CORRUPT or any other new code -- with zero
-- mutation: the guard is a pure read (two EXISTS subqueries) placed before
-- the message insert, the conversations.last_message_at update, and both
-- conversation_user_states updates, so a failure here leaves the message
-- table, the conversation row, and every state row completely untouched,
-- exactly like send_message's own identical guard already does. The
-- calling trusted server may repair the missing row and retry safely, the
-- same durable-retry property already established for every other
-- invariant guard in this schema.
--
-- Every other line of start_conversation is reproduced verbatim from the
-- live 0031 definition -- authentication, deleted-profile check, shop
-- lookup, self-message rejection, listing identity validation, listing
-- messageability (fresh-creation-only), admin restriction checks (both
-- roles), peer blocking (both directions), message normalization,
-- MESSAGE_EMPTY/MESSAGE_TOO_LONG, the transaction-stable v_now capture,
-- the race-safe existing-conversation lookup, the fresh-creation block
-- (conversation insert, both state-row inserts, unique_violation
-- recovery), the message insert, the conversations.last_message_at
-- update, and both post-send state updates (sender last_read_at/
-- marked_unread_at, recipient archived_at only) -- none of this is
-- refactored, reordered, or altered beyond inserting the one new guard
-- block described above. SECURITY DEFINER, SET search_path = '', the
-- RETURNS TABLE shape (conversation_id, message_id, message_created_at,
-- conversation_created), and every existing alias/qualification already
-- present in the 0031 body are preserved exactly.
--
-- Ambiguity-bug re-audit (0021/0022 precedent): the new guard's two EXISTS
-- subqueries both alias conversation_user_states as cus and qualify every
-- column read (cus.conversation_id, cus.user_id) against it -- consistent
-- with every other query in this function and with send_message's
-- identical guard. v_conversation_id and v_shop_owner_id are read as
-- plain PL/pgSQL variables, never as bare table columns, so their reuse
-- here (including v_conversation_id, which is also this function's own
-- output column name) carries no ambiguity risk, exactly as already
-- established throughout the rest of this function and reconfirmed here
-- line by line.
--
-- Privileges: REVOKE ALL FROM PUBLIC, REVOKE ALL FROM anon, GRANT EXECUTE
-- TO authenticated are restated below for explicitness, matching this
-- project's convention of always pairing a function definition with its
-- privilege statements in the same migration -- CREATE OR REPLACE
-- FUNCTION does not reset previously granted privileges in Postgres, so
-- these statements are not strictly required for the live privilege state
-- to remain correct, but restating them removes any doubt and costs
-- nothing. No service_role grant is added -- if service_role already
-- holds implicit/default execute privilege live (as it does for every
-- other function in this schema via Supabase's project-wide default
-- privileges), that is left entirely alone and not redesigned here.

create or replace function public.start_conversation(
  p_shop_id uuid,
  p_body text,
  p_listing_id uuid default null
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
  v_shop_owner_id uuid;
  v_listing_shop_id uuid;
  v_listing_status public.listing_status_enum;
  v_conversation_type public.conversation_type_enum;
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
    raise exception 'Your account cannot start new conversations.' using detail = 'INTERACTION_BLOCKED';
  end if;

  -- ===================== shop lookup + self-message =====================
  select s.owner_id
    into v_shop_owner_id
    from public.shops s
    where s.id = p_shop_id;

  if not found then
    raise exception 'Shop not found.' using detail = 'SHOP_NOT_FOUND';
  end if;

  if v_shop_owner_id = v_caller then
    raise exception 'You cannot message your own shop.' using detail = 'CANNOT_MESSAGE_OWN_SHOP';
  end if;

  -- ===================== listing identity (always validated) + conversation type =====================
  if p_listing_id is not null then
    select l.shop_id, l.status
      into v_listing_shop_id, v_listing_status
      from public.listings l
      where l.id = p_listing_id;

    if not found or v_listing_shop_id <> p_shop_id then
      raise exception 'Listing not found.' using detail = 'LISTING_NOT_FOUND';
    end if;

    v_conversation_type := 'listing_inquiry';
  else
    v_conversation_type := 'general_shop';
  end if;

  -- ===================== admin restrictions (role-based, active only) =====================
  if exists (
    select 1
    from public.user_restrictions ur
    where ur.user_id = v_caller
      and ur.lifted_at is null
      and ur.restriction_type in ('buyer_restricted', 'account_suspended')
  ) then
    raise exception 'You are not able to start new conversations right now.' using detail = 'INTERACTION_BLOCKED';
  end if;

  if exists (
    select 1
    from public.user_restrictions ur
    where ur.user_id = v_shop_owner_id
      and ur.lifted_at is null
      and ur.restriction_type in ('seller_suspended', 'account_suspended')
  ) then
    raise exception 'This seller cannot be messaged right now.' using detail = 'INTERACTION_BLOCKED';
  end if;

  -- ===================== peer blocking (both directions) =====================
  if exists (
    select 1
    from public.user_blocks ub
    where (ub.blocker_id = v_caller and ub.blocked_id = v_shop_owner_id)
       or (ub.blocker_id = v_shop_owner_id and ub.blocked_id = v_caller)
  ) then
    raise exception 'You cannot message this seller.' using detail = 'INTERACTION_BLOCKED';
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

  -- ===================== race-safe find existing logical conversation =====================
  if v_conversation_type = 'listing_inquiry' then
    select c.id into v_conversation_id
      from public.conversations c
      where c.initiator_id = v_caller and c.listing_id = p_listing_id
      for update;
  else
    select c.id into v_conversation_id
      from public.conversations c
      where c.initiator_id = v_caller and c.shop_id = p_shop_id and c.listing_id is null
      for update;
  end if;

  -- ===================== fresh creation path only =====================
  if v_conversation_id is null then
    if v_conversation_type = 'listing_inquiry' and v_listing_status not in ('available', 'reserved') then
      raise exception 'This listing cannot be messaged about right now.' using detail = 'LISTING_NOT_MESSAGEABLE';
    end if;

    begin
      insert into public.conversations as c (conversation_type, initiator_id, shop_id, listing_id, last_message_at)
        values (v_conversation_type, v_caller, p_shop_id, p_listing_id, v_now)
        returning c.id into v_conversation_id;

      v_conversation_created := true;

      insert into public.conversation_user_states (conversation_id, user_id, last_read_at)
        values (v_conversation_id, v_caller, v_now);

      insert into public.conversation_user_states (conversation_id, user_id)
        values (v_conversation_id, v_shop_owner_id);
    exception
      when unique_violation then
        -- lost the create race to a concurrent call; reuse the row it created
        v_conversation_created := false;

        if v_conversation_type = 'listing_inquiry' then
          select c.id into v_conversation_id
            from public.conversations c
            where c.initiator_id = v_caller and c.listing_id = p_listing_id
            for update;
        else
          select c.id into v_conversation_id
            from public.conversations c
            where c.initiator_id = v_caller and c.shop_id = p_shop_id and c.listing_id is null
            for update;
        end if;
    end;
  end if;

  -- ===================== state-row invariant for EXISTING conversations only (fresh creation already =====================
  -- ===================== established the invariant atomically two statements above, so it is not =====================
  -- ===================== redundantly re-checked here) -- covers both the found-immediately path and =====================
  -- ===================== the create-race-loss re-select path, since both leave v_conversation_created = false =====================
  if not v_conversation_created then
    if not exists (
      select 1 from public.conversation_user_states cus
      where cus.conversation_id = v_conversation_id and cus.user_id = v_caller
    ) or not exists (
      select 1 from public.conversation_user_states cus
      where cus.conversation_id = v_conversation_id and cus.user_id = v_shop_owner_id
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

  return query
    select v_conversation_id, v_message_id, v_now, v_conversation_created;
end;
$$;

revoke all on function public.start_conversation(uuid, text, uuid) from public;
revoke all on function public.start_conversation(uuid, text, uuid) from anon;
grant execute on function public.start_conversation(uuid, text, uuid) to authenticated;
