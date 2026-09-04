-- Messaging module, part two: whitespace-check correction, RLS policies,
-- and the two trusted RPCs (start_conversation, send_message). Touches
-- ONLY: the messages_body_not_blank_check constraint (dropped and
-- re-added under the same name with a broader rule), RLS policies on the
-- four messaging tables (user_blocks, conversations, messages,
-- conversation_user_states), exactly one narrowly-scoped supporting
-- SELECT policy on public.shops (shops_select_owner -- an approved direct
-- dependency of messaging participant authorization, not public shop
-- browsing), and the two named functions plus their grants. No new
-- tables, no enum changes, no new indexes, no notification/review/dispute
-- infrastructure, no application code.
--
-- Canonical recheck before writing
-- -----------------------------------------------------------------------
-- PRD 4.1/25/30 (registered users only; two conversation types; immutable
-- text messages; plain-text URLs permitted; per-user unread/archive/mute
-- state; peer blocking prevents new interactions but preserves existing
-- history) and PRD 33.1 (a suspended seller cannot receive new order
-- requests -- extended here, consistently, to new conversations/messages)
-- -- all already read in full this session and re-derived in the 0030
-- design report and migration header, which this migration builds on
-- directly rather than re-deriving from scratch.
--
-- Pre-inspection findings (read-only, immediately before writing this
-- file)
-- -----------------------------------------------------------------------
-- Migration history ends at 0030_messaging_schema; this is the next
-- migration. All four messaging tables (user_blocks, conversations,
-- messages, conversation_user_states) exist exactly as created; no
-- conversation_participants table exists; public.start_conversation and
-- public.send_message do not yet exist. All four messaging tables have
-- relrowsecurity = true and relforcerowsecurity = false (confirmed live),
-- with zero rows in pg_policies for any of them -- default-deny is the
-- live starting state this migration adds policies to.
-- messages_body_not_blank_check is exactly CHECK (length(btrim(body)) >
-- 0) (the known 0030 weakness); messages_body_max_length_check is exactly
-- CHECK (char_length(body) <= 4000), untouched by this migration.
-- conversations' two partial unique indexes and two inbox indexes are
-- exactly as created in 0030. conversation_type_enum is exactly
-- {listing_inquiry, general_shop}. restriction_type_enum is exactly
-- {seller_suspended, buyer_restricted, account_suspended};
-- user_restrictions carries user_id/restriction_type/reason/issued_by/
-- lifted_at/lifted_by/created_at, with lifted_at nullable -- "currently
-- active" means lifted_at IS NULL, reused as-is. shops.owner_id/status
-- and listings.shop_id/status are exactly as used in the 0030 design
-- report. profiles.deleted_at exists (nullable timestamptz). No
-- notifications table and no reviews/disputes table exist anywhere in
-- this schema.
--
-- Confirmed live (table-level grants): both `anon` and `authenticated`
-- already hold the full standard Supabase-template table-level grant set
-- (SELECT/INSERT/UPDATE/DELETE/etc.) on every table in this schema,
-- including shops, listings, and all four messaging tables -- this is the
-- coarse privilege layer; RLS (enabled, zero policies until this
-- migration) is the sole active gate today. This migration relies on that
-- existing table-level grant and adds no new GRANT statements for any
-- table -- only the two RPCs receive explicit privilege statements.
--
-- RESOLVED seller-side RLS dependency (previously a live-verified
-- limitation in an earlier draft of this migration, now fixed here): the
-- conversations/messages SELECT policies below express "caller is the
-- initiator OR caller owns the shop" by querying shops.owner_id. shops
-- itself has RLS enabled with zero policies of its own (confirmed live),
-- and Postgres RLS applies to ANY read of a table, including one reached
-- via a subquery inside another table's policy, for the SAME calling
-- role -- so without shops granting `authenticated` at least a path to
-- read owner_id, that subquery would return zero rows and the seller
-- branch of both policies would be permanently inert. This migration
-- resolves that directly, in scope, with exactly one narrowly-tailored
-- policy: shops_select_owner (SELECT, `to authenticated`, `using
-- (auth.uid() = owner_id)`). This is deliberately NOT public shop
-- browsing -- it permits an authenticated user to see only their OWN shop
-- row via this policy, nothing else, and adds no INSERT/UPDATE/DELETE
-- access and no anon access. It is approved as part of 0031 specifically
-- because it is a direct, load-bearing dependency of messaging
-- participant authorization, not a general-purpose shops policy -- a
-- future public-shop-browsing migration remains free to add its own
-- (necessarily broader) SELECT policy on shops for PRD 6.4's public shop
-- pages, entirely independent of this one. With shops_select_owner in
-- place, both the initiator and seller branches of
-- conversations_select_participants and messages_select_participants are
-- fully live today -- see "Verified policy composition" below for the
-- concrete reasoning per caller class. This does not change how the two
-- RPCs below behave at all -- both are SECURITY DEFINER and always
-- resolved seller identity by querying shops directly as their own
-- owning role, entirely bypassing the caller's RLS, exactly like every
-- other trusted RPC in this schema; shops_select_owner exists purely for
-- the client-side direct-SELECT read path these RPCs never used.
--
-- Verified policy composition (reasoned through explicitly, per the
-- review that requested this fix):
--   - Conversation initiator: auth.uid() = conversations.initiator_id
--     succeeds directly, no subquery involved -- unaffected by any of
--     this, unchanged since the first draft.
--   - Shop owner: the policy's subquery `select owner_id from shops
--     where id = conversations.shop_id` now succeeds for the owner
--     specifically because shops_select_owner's `using (auth.uid() =
--     owner_id)` makes exactly that one row (their own) visible to them
--     under RLS -- the seller participant branch now resolves to true.
--   - An unrelated authenticated user (no relationship to this
--     conversation): neither the initiator_id equality nor the shop
--     subquery can succeed -- shops_select_owner only ever exposes rows
--     where owner_id = auth.uid(), so a stranger's subquery against
--     shops.owner_id for someone else's shop returns zero rows regardless
--     -- both SELECT policies correctly yield zero rows.
--   - A user who owns a DIFFERENT shop: shops_select_owner still only
--     exposes THEIR OWN shop row (owner_id = auth.uid()) -- it does not
--     expose any other shop's row just because the caller happens to own
--     some shop. Querying shops for a conversation's shop_id that is not
--     theirs still returns zero rows for them, so they cannot use
--     ownership of an unrelated shop to read this conversation.
--   - anon: no policy anywhere in this migration is granted `to anon` (or
--     left ungated) -- shops_select_owner, like every other policy here,
--     is scoped `to authenticated` only, so anon has zero private
--     messaging access and zero access to any shop row through this
--     policy specifically.
-- No privacy widening occurs beyond exactly "an authenticated user may
-- SELECT their own shop row" -- no other user's shop data becomes visible
-- through this policy under any circumstance. No recursive-policy
-- dependency exists (shops_select_owner references no other table; the
-- messaging policies reference shops, a one-directional, acyclic
-- dependency). No SECURITY DEFINER helper function is needed or was
-- added -- the fix is a single ordinary RLS policy.
--
-- Whitespace-check correction
-- -----------------------------------------------------------------------
-- messages_body_not_blank_check is dropped and re-added under the exact
-- same name with CHECK (body ~ '[^[:space:]]') -- POSIX character-class
-- regex matching any single character that is NOT whitespace, so the
-- constraint is satisfied only if at least one non-whitespace character
-- exists anywhere in body. This correctly rejects '', space-only,
-- tab-only, newline-only, and any mixture of whitespace-only content --
-- the exact gap empirically proven live during 0030's verification
-- (Postgres's single-argument btrim() strips only ASCII space, not
-- tab/newline). messages_body_max_length_check, the body column's type,
-- and all URL handling are untouched.
--
-- RLS policies
-- -----------------------------------------------------------------------
-- user_blocks: SELECT allows either party to see a block row they are
-- involved in (blocker or blocked) -- both directions are needed for
-- enforcement/UX (a user must be able to see who they blocked AND who
-- has blocked them). INSERT requires auth.uid() = blocker_id (a user can
-- only create a block row naming themselves as blocker -- WITH CHECK also
-- restates blocker_id <> blocked_id defensively, even though the table's
-- own CHECK constraint already enforces it structurally). DELETE requires
-- auth.uid() = blocker_id -- only the blocker may remove their own block;
-- the blocked party cannot unblock themselves. No UPDATE policy (a block
-- row is create/delete only, never modified in place -- there is nothing
-- to update on this table). No policy applies to anon at all (every
-- policy below is scoped `to authenticated`), so anon has zero access
-- under RLS default-deny.
--
-- shops (supporting policy, not a messaging table): shops_select_owner is
-- the single narrowly-scoped SELECT policy described above -- `using
-- (auth.uid() = owner_id)`, `to authenticated` only. No INSERT/UPDATE/
-- DELETE policy, no anon grant, no broader "public shop browsing"
-- predicate of any kind. It exists solely so the two messaging SELECT
-- policies below can resolve shop ownership for the calling role; it is
-- not, and must not be read as, this project's eventual public-shop-page
-- policy.
--
-- conversations: SELECT only, no INSERT/UPDATE/DELETE policy of any kind
-- -- conversation creation and last_message_at mutation belong
-- exclusively to the two SECURITY DEFINER RPCs below, which bypass RLS
-- entirely as their owning role. The SELECT predicate is caller =
-- initiator_id OR caller = the shop's owner_id -- both branches are now
-- fully live (see "Verified policy composition" above). No
-- self-referential subquery exists in this policy (it only queries
-- shops, a different table), so there is no recursive-policy risk here.
--
-- messages: SELECT only, gated by EXISTS against the parent conversation
-- using the identical initiator-or-shop-owner predicate. No INSERT/
-- UPDATE/DELETE policy -- messages remain immutable for every
-- authenticated user; the only path to a new message row is
-- send_message (or start_conversation's own first-message insert), both
-- SECURITY DEFINER.
--
-- conversation_user_states: SELECT and UPDATE both scoped to auth.uid() =
-- user_id -- a user may only see and modify their own per-conversation
-- state row (mark read, mark unread, archive/unarchive, mute/unmute all
-- become plain client-side UPDATEs against this one row under this single
-- policy -- no toggle RPCs are created, per locked scope). No INSERT
-- policy: state rows are created eagerly, in pairs, exclusively by
-- start_conversation -- normal application flow never needs a client
-- INSERT here, and a missing state row on an existing conversation is
-- treated as corruption (CONVERSATION_STATE_INVALID inside send_message),
-- not silently self-healed by an RLS-permitted client insert. No DELETE
-- policy -- state rows are permanent for the conversation's lifetime.
--
-- start_conversation
-- -----------------------------------------------------------------------
-- Signature note: the original draft's `(p_shop_id uuid, p_listing_id
-- uuid DEFAULT NULL, p_body text)` was not valid Postgres -- once a
-- parameter carries a DEFAULT, every parameter after it must also carry
-- one, which forced p_body to also take `DEFAULT NULL` purely to satisfy
-- that requirement, even though p_body is always genuinely required.
-- This is corrected here by reordering to `(p_shop_id uuid, p_body text,
-- p_listing_id uuid DEFAULT NULL)` -- p_body now sits before the one
-- parameter that legitimately has a default, so p_body itself carries no
-- default and is a true required argument again: a call that omits it
-- entirely is rejected by PostgREST/Postgres at the argument-resolution
-- level before this function body ever runs (a distinct failure mode from
-- MESSAGE_EMPTY, which handles the case where p_body is explicitly
-- supplied as NULL or as whitespace-only content). p_listing_id keeps its
-- own default and keeps its own meaning unchanged: omitted ->
-- general_shop conversation; supplied -> listing_inquiry conversation.
-- Supabase RPC calls remain named-parameter (PostgREST posts a JSON
-- object, not a positional argument list), so this reordering changes
-- nothing about how any real caller invokes this function -- only the
-- declared parameter order, and the required-vs-optional distinction
-- Postgres now enforces correctly for p_body.
--
-- Security: SECURITY DEFINER, SET search_path = '', every relation fully
-- schema-qualified -- this is a human-facing RPC (unlike complete_order),
-- so it follows the auth.uid()-authorized shape shared by
-- accept_order_items/mark_order_ready/mark_order_handed_over_or_shipped/
-- confirm_order_received/complete_order's sibling human RPCs, not
-- expire_pending_orders/complete_order's system-only shape. No client-
-- supplied initiator or sender id anywhere -- auth.uid() is the sole
-- identity source, read once and reused via v_caller.
--
-- Ambiguity-bug defense (0021 lesson, applied with extra rigor here
-- because this function's own output column conversation_id is also an
-- extremely common WHERE-filter column name across every table this
-- function touches): every table reference in this function carries an
-- explicit alias, and every bare read of a column whose name could
-- collide with an output column (conversation_id, message_id,
-- message_created_at, conversation_created) is alias-qualified --
-- including UPDATE statements' WHERE clauses, which this function
-- deliberately aliases even though the established house pattern
-- sometimes leaves an UPDATE target unaliased when no collision risk
-- exists (e.g. complete_order's listings loop) -- here a collision risk
-- does exist (conversation_id), so the alias is mandatory, not merely
-- stylistic. UPDATE...SET target-list column names and INSERT column
-- lists remain bare throughout, per the proven-safe grammar rule
-- (0022, reused in every migration since): neither position is ever
-- ambiguous regardless of alias presence.
--
-- Authentication and caller eligibility: auth.uid() required
-- (NOT_AUTHENTICATED). The caller's own profiles.deleted_at is checked
-- immediately after -- a non-NULL value means an anonymized/deleted
-- account, which is not eligible to originate new interactions
-- (INTERACTION_BLOCKED, not a dedicated code -- an anonymized account
-- attempting to message is the same class of "this interaction cannot
-- proceed" outcome as any other block, keeping the error surface
-- minimal).
--
-- Shop lookup and self-message: shops is looked up by p_shop_id
-- (SHOP_NOT_FOUND if absent). If the caller owns that shop,
-- CANNOT_MESSAGE_OWN_SHOP -- checked immediately, before any further
-- lookup, since it is the cheapest and most fundamental rejection. Shop
-- status (active/away) is never inspected as an eligibility gate -- both
-- are messageable per the locked design; only user_restrictions and
-- user_blocks can block the interaction (checked later).
--
-- Listing identity vs. listing eligibility (the important distinction
-- this function enforces correctly): when p_listing_id is supplied, the
-- listing is looked up and its existence plus shop-ownership match
-- (listing.shop_id = p_shop_id) is validated unconditionally
-- (LISTING_NOT_FOUND if either fails) -- this is input-identity
-- validation, required to resolve conversation_type deterministically
-- and to compute the correct find-or-create lookup key, and it always
-- runs regardless of whether a matching conversation already exists.
-- Listing MESSAGEABILITY (status must be available or reserved,
-- LISTING_NOT_MESSAGEABLE otherwise) is a completely different,
-- eligibility-only check that is deliberately deferred until AFTER the
-- existing-conversation lookup, and is only ever evaluated on the
-- fresh-creation path -- exactly matching the locked instruction that an
-- existing conversation must remain usable even after its listing later
-- becomes paused/sold/archived, since that revalidation must never run
-- against a thread that is merely being reused.
--
-- Admin restrictions: user_restrictions rows with lifted_at IS NULL are
-- "currently active." The initiator (always v_caller in this function)
-- is checked against {buyer_restricted, account_suspended}; the shop
-- owner is checked against {seller_suspended, account_suspended} -- both
-- checks are role-based (initiator vs. seller), matching PRD 33.1's
-- existing "suspended seller cannot receive new order requests" principle
-- extended to new conversations. No restriction row is ever mutated.
--
-- Peer blocking: public.user_blocks is checked in both directions
-- (blocker=caller/blocked=owner OR blocker=owner/blocked=caller) in one
-- EXISTS -- either direction blocks the interaction (INTERACTION_BLOCKED)
-- with zero mutation to user_blocks itself.
--
-- Message normalization: v_body := regexp_replace(p_body,
-- '^[[:space:]]+|[[:space:]]+$', '', 'g') strips only leading/trailing
-- whitespace runs (any POSIX space-class character, not just ASCII
-- space) while leaving internal whitespace -- including internal
-- tabs/newlines that are part of real message content, and any URL --
-- completely untouched. This is the exact expression recommended in the
-- task brief; no safer or cleaner equivalent was found, so it is used
-- verbatim. MESSAGE_EMPTY is raised if the normalized body is NULL or
-- contains no non-whitespace character at all (the same
-- '[^[:space:]]' predicate as the corrected table CHECK, so the RPC-level
-- rejection and the DB-level backstop agree exactly). MESSAGE_TOO_LONG is
-- raised above 4000 characters, matching messages_body_max_length_check.
--
-- Race-safe find-or-create: v_now is captured once, after all
-- eligibility/restriction/blocking checks and body validation have
-- already passed (so a failed validation never needs to touch the clock
-- or acquire any conversation-level lock). The existing-conversation
-- lookup uses the same logical key as 0030's own partial unique indexes
-- (initiator_id+listing_id for listing_inquiry, initiator_id+shop_id with
-- listing_id IS NULL for general_shop), locked FOR UPDATE when found. If
-- absent, this function attempts the INSERT (plus, only on this path, the
-- listing-messageability check and the two state-row inserts) inside a
-- nested BEGIN/EXCEPTION block; a unique_violation there means a
-- concurrent call won the race, so this function simply re-selects the
-- now-existing row (FOR UPDATE) and proceeds as a reuse (
-- conversation_created := false) -- no advisory locks are used, since the
-- unique indexes themselves are sufficient and this pattern mirrors how
-- every other race in this schema is already handled by proving
-- correctness against a live unique constraint rather than inventing new
-- locking primitives.
--
-- New-conversation creation: exactly two conversation_user_states rows
-- are inserted atomically alongside the conversation row -- one for the
-- initiator (last_read_at = v_now, since the sender has necessarily read
-- their own first message; archived_at/marked_unread_at NULL, muted
-- false) and one for the shop owner (every column left at its column
-- default/NULL -- unread, unarchived, unmuted, no forced-unread override
-- -- since the recipient has not yet seen anything). Exactly matches the
-- locked design: never lazy, never a participants table, always exactly
-- two rows for the conversation's entire lifetime.
--
-- Existing-conversation reuse: no state rows are (re)created. Every
-- eligibility check EXCEPT listing messageability re-runs unconditionally
-- on this path too (self-message is structurally impossible for an
-- existing thread since initiator_id <> shop owner was already enforced
-- at its creation, but restrictions and blocking are genuinely re-checked
-- fresh, since either party's status can change between messages).
-- conversation_created is returned as false.
--
-- Message insert and state updates (both paths converge here): message
-- inserted with sender_id = v_caller, body = the normalized v_body,
-- created_at = v_now. conversations.last_message_at is set to the same
-- v_now (so the two values match exactly for a fresh send, satisfying
-- the "created_at and last_message_at should match" requirement).
-- Sender's own state: last_read_at advances to v_now and
-- marked_unread_at clears to NULL (the sender has, by definition, read
-- up through the message they just sent). Recipient's state:
-- archived_at clears to NULL only (an archived thread that just received
-- new information must not stay hidden) -- last_read_at, marked_unread_at,
-- and muted are never touched for the recipient, exactly as locked.
--
-- Return shape: conversation_id, message_id, message_created_at,
-- conversation_created -- a plain typed table, no jsonb, matching this
-- schema's established return-contract convention.
--
-- send_message
-- -----------------------------------------------------------------------
-- Signature: (p_conversation_id uuid, p_body text) -- both required, no
-- defaults needed since neither precedes a defaulted parameter.
--
-- Security/ambiguity: identical SECURITY DEFINER/search_path hardening
-- and the same rigorous full-aliasing discipline as start_conversation,
-- for the identical reason -- this function's own output also declares
-- conversation_id and message_id, both extremely common column names.
--
-- Locking and participation: public.orders row FOR UPDATE... no --
-- public.conversations row locked FOR UPDATE first (the universal
-- serialization point for this table, mirroring every order-lifecycle
-- RPC's own orders-row-first convention), CONVERSATION_NOT_FOUND if
-- absent. The shop's owner_id is looked up once. The caller must equal
-- either the conversation's initiator_id or the shop's owner_id --
-- NOT_CONVERSATION_PARTICIPANT otherwise -- and this equality check is
-- performed directly in PL/pgSQL against values already read under lock,
-- never delegated to RLS (this function runs as SECURITY DEFINER and
-- therefore bypasses the caller's own RLS entirely, so RLS provides zero
-- protection here by construction -- the participation check inside the
-- function body is the only enforcement, exactly as instructed). Whichever
-- role the caller is NOT determines the recipient (caller=initiator ->
-- recipient=seller; caller=seller -> recipient=initiator). Self-message
-- is not re-checked explicitly -- it is structurally impossible for any
-- conversation that reached this table, since start_conversation already
-- guarantees initiator_id <> the shop's owner_id at creation time and
-- shop ownership has no live transfer path (see 0030's own header).
--
-- Restrictions and blocking: both re-checked on every single send, fresh
-- -- the initiator (role-based, not caller-based, so this works correctly
-- regardless of which party is calling) against {buyer_restricted,
-- account_suspended}, the shop owner against {seller_suspended,
-- account_suspended}, and public.user_blocks in both directions between
-- initiator and shop owner -- INTERACTION_BLOCKED on any hit, zero
-- mutation to either restriction or block rows. Listing status is
-- deliberately never re-checked here (only start_conversation's
-- fresh-creation path ever inspects listing messageability, per the
-- locked "existing conversation remains usable" rule) and shop
-- active/away status is inspected only insofar as the shop row must
-- still exist to resolve owner_id -- never as its own eligibility gate.
--
-- Body normalization: identical expression and identical MESSAGE_EMPTY/
-- MESSAGE_TOO_LONG validation to start_conversation, applied before any
-- mutation.
--
-- State-row invariant: before inserting anything, this function confirms
-- both the caller's and the recipient's conversation_user_states rows
-- exist for this conversation. Per the locked design, every legitimately
-- created conversation has exactly two such rows for its entire
-- lifetime (created atomically by start_conversation, never deleted, no
-- DELETE policy exists) -- if either is missing, that is corruption, not
-- a recoverable condition, and this function deliberately fails closed
-- with CONVERSATION_STATE_INVALID (zero mutation) rather than silently
-- recreating the missing row, exactly per the locked "Option A" choice.
--
-- Mutation and return: one shared v_now; message inserted (sender_id =
-- v_caller, never client-supplied); conversations.last_message_at set to
-- the same v_now; sender state last_read_at advances to v_now and
-- marked_unread_at clears; recipient state archived_at clears only.
-- Returns message_id, conversation_id, message_created_at -- no jsonb.
--
-- Error codes (both functions combined): exactly NOT_AUTHENTICATED,
-- SHOP_NOT_FOUND, LISTING_NOT_FOUND, LISTING_NOT_MESSAGEABLE,
-- CANNOT_MESSAGE_OWN_SHOP, INTERACTION_BLOCKED, CONVERSATION_NOT_FOUND,
-- NOT_CONVERSATION_PARTICIPANT, MESSAGE_EMPTY, MESSAGE_TOO_LONG, and
-- CONVERSATION_STATE_INVALID (used only by send_message's corruption
-- guard, exactly per the task's own conditional instruction to add it
-- "only if implementation intentionally fails on missing expected state
-- rows" -- it does, so it is included). No DUPLICATE_CONVERSATION,
-- MESSAGE_NOT_FOUND, or BLOCK_NOT_FOUND codes exist -- none of those
-- conditions is a distinct outcome this design produces.
--
-- Privileges: both functions REVOKE ALL FROM PUBLIC, REVOKE ALL FROM
-- anon, GRANT EXECUTE TO authenticated only -- these are human-facing
-- actions (unlike expire_pending_orders/complete_order's service-role-only
-- shape), so authenticated is the correct and sufficient grantee; no
-- service_role grant is added for either.
--
-- Rate limiting, notifications, realtime: none of the three is built
-- here, per locked scope. Application/server-level rate limiting remains
-- future MVP hardening (no Redis, no rate-limit table, no trigger
-- counting messages). A fresh message insert (returned
-- conversation_created/message_id) is the future application-level event
-- boundary for in-app/email notification dispatch and for prompting a
-- Realtime-driven inbox refresh -- neither is implemented or scaffolded
-- by this migration.

-- ============================================================
-- 1. Whitespace-check correction
-- ============================================================

alter table public.messages
  drop constraint messages_body_not_blank_check;

alter table public.messages
  add constraint messages_body_not_blank_check
    check (body ~ '[^[:space:]]');

-- ============================================================
-- 2. RLS policies
-- ============================================================

create policy user_blocks_select_involved
  on public.user_blocks
  for select
  to authenticated
  using (auth.uid() = blocker_id or auth.uid() = blocked_id);

create policy user_blocks_insert_own
  on public.user_blocks
  for insert
  to authenticated
  with check (auth.uid() = blocker_id and blocker_id <> blocked_id);

create policy user_blocks_delete_own
  on public.user_blocks
  for delete
  to authenticated
  using (auth.uid() = blocker_id);

create policy shops_select_owner
  on public.shops
  for select
  to authenticated
  using (auth.uid() = owner_id);

create policy conversations_select_participants
  on public.conversations
  for select
  to authenticated
  using (
    auth.uid() = conversations.initiator_id
    or auth.uid() = (
      select s.owner_id
      from public.shops s
      where s.id = conversations.shop_id
    )
  );

create policy messages_select_participants
  on public.messages
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.conversations c
      where c.id = messages.conversation_id
        and (
          c.initiator_id = auth.uid()
          or c.shop_id in (
            select s.id
            from public.shops s
            where s.owner_id = auth.uid()
          )
        )
    )
  );

create policy conversation_user_states_select_own
  on public.conversation_user_states
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy conversation_user_states_update_own
  on public.conversation_user_states
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ============================================================
-- 3. start_conversation
-- ============================================================

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

-- ============================================================
-- 4. send_message
-- ============================================================

create or replace function public.send_message(
  p_conversation_id uuid,
  p_body text
)
returns table (
  message_id uuid,
  conversation_id uuid,
  message_created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_caller_deleted_at timestamptz;
  v_initiator_id uuid;
  v_shop_id uuid;
  v_shop_owner_id uuid;
  v_recipient_id uuid;
  v_body text;
  v_now timestamptz;
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

  -- ===================== lock conversation row (universal serialization point) =====================
  select c.initiator_id, c.shop_id
    into v_initiator_id, v_shop_id
    from public.conversations c
    where c.id = p_conversation_id
    for update;

  if not found then
    raise exception 'Conversation not found.' using detail = 'CONVERSATION_NOT_FOUND';
  end if;

  select s.owner_id into v_shop_owner_id
    from public.shops s
    where s.id = v_shop_id;

  -- ===================== participation (enforced here explicitly; SECURITY DEFINER bypasses RLS) =====================
  if v_caller = v_initiator_id then
    v_recipient_id := v_shop_owner_id;
  elsif v_caller = v_shop_owner_id then
    v_recipient_id := v_initiator_id;
  else
    raise exception 'You are not a participant in this conversation.' using detail = 'NOT_CONVERSATION_PARTICIPANT';
  end if;

  -- ===================== admin restrictions, re-checked fresh, role-based not caller-based =====================
  if exists (
    select 1
    from public.user_restrictions ur
    where ur.user_id = v_initiator_id
      and ur.lifted_at is null
      and ur.restriction_type in ('buyer_restricted', 'account_suspended')
  ) then
    raise exception 'This conversation is not able to receive new messages right now.' using detail = 'INTERACTION_BLOCKED';
  end if;

  if exists (
    select 1
    from public.user_restrictions ur
    where ur.user_id = v_shop_owner_id
      and ur.lifted_at is null
      and ur.restriction_type in ('seller_suspended', 'account_suspended')
  ) then
    raise exception 'This conversation is not able to receive new messages right now.' using detail = 'INTERACTION_BLOCKED';
  end if;

  -- ===================== peer blocking, re-checked fresh (both directions) =====================
  if exists (
    select 1
    from public.user_blocks ub
    where (ub.blocker_id = v_initiator_id and ub.blocked_id = v_shop_owner_id)
       or (ub.blocker_id = v_shop_owner_id and ub.blocked_id = v_initiator_id)
  ) then
    raise exception 'You cannot send a message in this conversation.' using detail = 'INTERACTION_BLOCKED';
  end if;

  -- ===================== message normalization =====================
  v_body := regexp_replace(p_body, '^[[:space:]]+|[[:space:]]+$', '', 'g');

  if v_body is null or v_body !~ '[^[:space:]]' then
    raise exception 'Message cannot be empty.' using detail = 'MESSAGE_EMPTY';
  end if;

  if char_length(v_body) > 4000 then
    raise exception 'Message is too long.' using detail = 'MESSAGE_TOO_LONG';
  end if;

  -- ===================== state-row invariant: both rows must already exist (corruption otherwise) =====================
  if not exists (
    select 1 from public.conversation_user_states cus
    where cus.conversation_id = p_conversation_id and cus.user_id = v_caller
  ) or not exists (
    select 1 from public.conversation_user_states cus
    where cus.conversation_id = p_conversation_id and cus.user_id = v_recipient_id
  ) then
    raise exception 'Conversation state is missing or corrupted.' using detail = 'CONVERSATION_STATE_INVALID';
  end if;

  -- ===================== transaction-stable time, captured after all validation =====================
  v_now := now();

  insert into public.messages as m (conversation_id, sender_id, body, created_at)
    values (p_conversation_id, v_caller, v_body, v_now)
    returning m.id into v_message_id;

  update public.conversations as c
    set last_message_at = v_now
    where c.id = p_conversation_id;

  update public.conversation_user_states as cus
    set last_read_at = v_now,
        marked_unread_at = null
    where cus.conversation_id = p_conversation_id and cus.user_id = v_caller;

  update public.conversation_user_states as cus
    set archived_at = null
    where cus.conversation_id = p_conversation_id and cus.user_id = v_recipient_id;

  return query
    select v_message_id, p_conversation_id, v_now;
end;
$$;

revoke all on function public.send_message(uuid, text) from public;
revoke all on function public.send_message(uuid, text) from anon;
grant execute on function public.send_message(uuid, text) to authenticated;
