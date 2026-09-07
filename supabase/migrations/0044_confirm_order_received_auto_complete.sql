-- Closes the one real lifecycle gap in the order-completion architecture:
-- orders could reach received_confirmed but nothing ever advanced them to
-- completed, because complete_order (0029) is service-role-only by design
-- and no trusted server process invoking it was ever built. This migration
-- modifies ONLY public.confirm_order_received (CREATE OR REPLACE, same
-- signature, same grants) so that a fresh receipt confirmation immediately
-- attempts completion as part of the same buyer-triggered transaction. No
-- new table/enum/index/trigger/policy/RPC, no grant changes, no other
-- function touched (complete_order itself is not modified at all).
--
-- Canonical-doc recheck before writing
-- -----------------------------------------------------------------------
-- PRD 22 / 22.3: "... -> Handed Over/Shipped -> Buyer Confirms Received ->
-- Completed". "Order becomes Completed only after buyer confirms receipt.
-- No automatic completion in MVP." ARCHITECTURE_ESSENTIALS.md's own order
-- lifecycle section: "Buyer confirms receipt / Only then -> completed" --
-- listed as the very next step with no intervening delay, admin action, or
-- background-job timing described anywhere in any canonical doc. PRD 26.1:
-- "Only buyers with a Completed order may leave a review" -- review
-- eligibility depends on orders reaching 'completed' in practice, which
-- never happened for any live order before this fix. Nothing here departs
-- from canon: "No automatic completion" already meant (per 0027's own
-- locked-decision comment, reaffirmed by this migration, not relitigated)
-- that the system may never complete an order on its own initiative absent
-- buyer action -- it does not mean completion must wait for a second,
-- undocumented click or an unspecified background delay. No canonical doc
-- describes any such delay/background timing, so none is invented here.
--
-- The missing piece was explicitly already documented, not silently
-- assumed: 0029_complete_order.sql's own header (lines 298-303, read
-- immediately before writing this migration) states verbatim: "Trusted-
-- server orchestration (not implemented here, documented only): after
-- confirm_order_received returns -- whether was_already_received_confirmed
-- is true or false -- a trusted server may invoke complete_order(order_id).
-- Because this function is itself exact-target-state idempotent, invoking
-- it redundantly ... is always safe." This migration implements exactly
-- that orchestration, as a database-native in-transaction call rather than
-- a new external worker/cron/queue -- per this task's explicit preference
-- for a transactional solution over new infrastructure, and because no
-- trusted external process exists anywhere in this codebase to invoke it
-- from outside the database.
--
-- Why a direct call, and why it is still safe (re-verified against the
-- live grants immediately before writing this migration)
-- -----------------------------------------------------------------------
-- public.confirm_order_received and public.complete_order are both
-- SECURITY DEFINER and both owned by the same role (confirmed live: both
-- owned by `postgres`). A SECURITY DEFINER function executes with its
-- owner's privileges, so confirm_order_received calling
-- public.complete_order(p_order_id) internally runs as that shared owner
-- and succeeds regardless of complete_order's own REVOKE ALL FROM
-- authenticated -- exactly the "trusted server" trust boundary the 0029
-- design already relies on, just invoked from inside the database instead
-- of from an external process holding the service-role key. complete_
-- order's grants are NOT changed by this migration (still revoked from
-- public/anon/authenticated, still granted only to service_role) -- it
-- remains impossible for any client (seller included) to invoke
-- complete_order directly. The only path that can ever complete an order
-- is: the order's own buyer calling confirm_order_received.
--
-- Failure isolation (the exact property the two-step architecture was
-- locked to protect, preserved here without external infrastructure): the
-- internal call is wrapped in a nested `begin ... exception when others
-- ... end` block. PL/pgSQL establishes an implicit savepoint at the start
-- of a block with an EXCEPTION clause; if complete_order raises for any
-- reason (ORDER_NOT_FOUND, ORDER_NOT_COMPLETABLE, RESERVATION_STATE_INVALID,
-- or anything unforeseen), execution rolls back to that savepoint --
-- undoing only whatever complete_order attempted -- while the received_
-- confirmed UPDATE and its order_status_history row, already executed
-- earlier in the SAME outer transaction before this block, are completely
-- unaffected and still commit normally when this function returns. The
-- buyer's receipt confirmation is therefore never lost on a completion
-- failure, exactly as 0029's own header requires ("the buyer's receipt
-- confirmation ... is never lost and the buyer never needs to confirm
-- again"). A caught failure is surfaced via RAISE WARNING (visible in
-- database logs for operational follow-up) rather than propagated, since
-- propagating it would fail the buyer's own successful confirmation action
-- for a completion-side problem that is entirely the seller/inventory
-- side's responsibility to have kept consistent.
--
-- No self-deadlock: confirm_order_received already holds the orders row's
-- FOR UPDATE lock (acquired earlier in this same function, same
-- transaction) before calling complete_order, which re-selects that exact
-- row FOR UPDATE. PostgreSQL allows a transaction to re-lock a row it
-- already holds within the same transaction with no blocking and no
-- deadlock. complete_order's subsequent locks (order_items, active
-- inventory_reservations, listings, all in the same deterministic order
-- already used throughout this schema per 0029's own "Existing lock-order
-- audit") are freshly acquired, unrelated rows -- nothing about this
-- migration changes lock ordering anywhere in the schema.
--
-- Scope of the change: ONLY the fresh-transition branch (handed_over_or_
-- shipped -> received_confirmed) now attempts completion immediately
-- afterward. The idempotent branch (order already received_confirmed) is
-- left completely untouched -- still zero mutation, zero additional
-- locking, byte-for-byte identical to 0027 -- since it has no real caller
-- today (no frontend exists yet for either RPC) and changing its
-- documented "zero mutation" contract is not required to close the actual
-- gap (a fresh receipt confirmation never advancing to completed). Adding
-- speculative retry-on-idempotent-call behavior with no current caller
-- would be exactly the kind of speculative engineering AGENTS.md instructs
-- against; the smallest fix that closes the real gap is preferred.
--
-- Return contract: unchanged signature (order_id, order_status, was_
-- already_received_confirmed, received_confirmed_at). On the fresh-
-- transition path, order_status is now re-read from the orders row after
-- the completion attempt, so a caller correctly observes 'completed' when
-- completion succeeded synchronously, or 'received_confirmed' unchanged if
-- it did not -- the return value is never stale relative to the row's true
-- final state. received_confirmed_at is unaffected either way (complete_
-- order never writes it). was_already_received_confirmed remains exactly
-- what it always meant (was the received_confirmed transition itself
-- already done), unrelated to completion's outcome.
--
-- Notifications: unchanged. This migration does not add, remove, or alter
-- any notification logic. complete_order itself (untouched) still creates
-- no notification row -- exactly as already documented in 0029 ("A future
-- application event ... belongs to application code reacting after
-- commit"). No existing notification insert (order_handed_over_or_shipped,
-- etc.) is touched by this migration. This is a currently-known, pre-
-- existing gap unrelated to the one this migration closes, and is not
-- invented or expanded here.
--
-- Review eligibility: unchanged code path. public.reviews (confirmed live
-- to already exist) and its eligibility RPC already check orders.status =
-- 'completed' directly (0034); this migration does not touch that RPC or
-- the reviews table at all. Because real orders can now actually reach
-- 'completed', that pre-existing eligibility check becomes reachable in
-- practice for the first time -- no new review logic is added.
--
-- No payment logic, no frontend change: this migration touches exactly one
-- SQL function body. No application/frontend file is modified.
--
-- Pre-inspection findings (read-only, immediately before writing this
-- file)
-- -----------------------------------------------------------------------
-- Migration history ends at 0043_seller_orders_read_rpcs (confirmed live,
-- no drift); this is the next migration. order_status_enum confirmed live
-- to still hold exactly its eleven documented values. public.reviews
-- confirmed live to already exist (out of scope to modify here). Live
-- grants confirmed: complete_order -> {postgres, service_role} only, no
-- authenticated grant; confirm_order_received -> {authenticated, postgres,
-- service_role}, unchanged by this migration. Live function ownership
-- confirmed: both confirm_order_received and complete_order are owned by
-- `postgres`.

create or replace function public.confirm_order_received(
  p_order_id uuid
)
returns table (
  order_id uuid,
  order_status public.order_status_enum,
  was_already_received_confirmed boolean,
  received_confirmed_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_order_status public.order_status_enum;
  v_order_buyer_id uuid;
  v_existing_received_confirmed_at timestamptz;
  v_new_received_confirmed_at timestamptz;
  v_final_status public.order_status_enum;
begin
  -- ===================== authentication =====================
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'Authentication required.' using detail = 'NOT_AUTHENTICATED';
  end if;

  -- ===================== lock order row (universal serialization point) =====================
  select o.status, o.buyer_id, o.received_confirmed_at
    into v_order_status, v_order_buyer_id, v_existing_received_confirmed_at
    from public.orders o
    where o.id = p_order_id
    for update;

  if not found then
    raise exception 'Order not found.' using detail = 'ORDER_NOT_FOUND';
  end if;

  -- ===================== authorization: caller must be the order's buyer =====================
  if v_order_buyer_id is distinct from v_caller then
    raise exception 'You do not have permission to act on this order.' using detail = 'NOT_ORDER_BUYER';
  end if;

  -- ===================== idempotency: already-received-confirmed is success, zero mutation =====================
  -- Unchanged from 0027: no completion retry attempted here (no current
  -- caller relies on it -- see header). Byte-identical to the prior
  -- version of this branch.
  if v_order_status = 'received_confirmed' then
    return query
      select p_order_id, v_order_status, true, v_existing_received_confirmed_at;
    return;
  end if;

  -- ===================== only handed_over_or_shipped orders may progress to received_confirmed =====================
  if v_order_status <> 'handed_over_or_shipped' then
    raise exception 'Order is not in a state that can be marked received.' using detail = 'ORDER_NOT_RECEIVABLE';
  end if;

  -- ===================== parent progression: status + lifecycle timestamp together, nothing else touched =====================
  v_new_received_confirmed_at := now();

  update public.orders as o
    set status = 'received_confirmed',
        received_confirmed_at = v_new_received_confirmed_at
    where o.id = p_order_id;

  -- ===================== exactly one parent history row =====================
  insert into public.order_status_history (order_id, from_status, to_status, changed_by, note)
    values (p_order_id, 'handed_over_or_shipped', 'received_confirmed', v_caller, null);

  -- ===================== immediate completion attempt (the fix) =====================
  -- Implements 0029's own documented-but-unbuilt orchestration: a trusted
  -- process invokes complete_order immediately after a fresh receipt
  -- confirmation. Run as the shared `postgres` owner via SECURITY DEFINER,
  -- so complete_order's own REVOKE FROM authenticated is untouched and
  -- irrelevant here -- no client can reach complete_order directly. Wrapped
  -- in an exception-handling block (an implicit savepoint) so that if
  -- completion fails for any reason, only its own work rolls back -- the
  -- received_confirmed update and history row above, already executed in
  -- this same outer transaction, are unaffected and still commit.
  begin
    perform public.complete_order(p_order_id);
  exception
    when others then
      raise warning 'complete_order failed immediately after confirm_order_received for order %: %', p_order_id, sqlerrm;
  end;

  -- ===================== return the row's true final status =====================
  -- 'completed' if the attempt above succeeded, 'received_confirmed'
  -- unchanged if it did not -- never stale relative to the actual row.
  select o.status into v_final_status from public.orders o where o.id = p_order_id;

  return query
    select p_order_id, v_final_status, false, v_new_received_confirmed_at;
end;
$$;

revoke all on function public.confirm_order_received(uuid) from public;
revoke all on function public.confirm_order_received(uuid) from anon;
grant execute on function public.confirm_order_received(uuid) to authenticated;
