-- Support tickets: PRD 43.1 "Preshopps includes a Contact / Support page...
-- Support submissions route to admin and may optionally trigger email
-- notification." ARCHITECTURE.md ("### Support -- support_tickets") and
-- ARCHITECTURE_ESSENTIALS.md both already anticipate a `support_tickets`
-- table by name, with no exact schema prescribed ("Exact schema belongs in
-- the database schema work, not this file"). This migration is the
-- smallest additive schema+RPC needed to make the /support page a real,
-- working submission path: one enum, one table, one SECURITY DEFINER
-- insert RPC. No admin read/resolve RPC is added here -- an admin support
-- queue is a separate, not-yet-requested feature; this task only requires
-- the logged-in submission path itself to exist and work end-to-end.
--
-- Pre-inspection: migration history ends at 0068_category_taxonomy_
-- reconciliation (confirmed live via list_migrations, no drift). No
-- support_tickets table/enum exists anywhere -- clean namespace.
--
-- Login requirement (43.1 "Support form requires login", 43.2 "Guests
-- cannot submit the support form") is enforced the same way every other
-- authenticated RPC in this codebase enforces it: auth.uid() is null ->
-- raise exception, not a client-side-only check.
--
-- Categories reproduce PRD 43.1 verbatim ("General inquiry, Account
-- issue, Order/dispute issue, Report a problem"), nothing invented or
-- added.
--
-- Restriction gating deliberately NOT applied. Unlike seller/buyer-
-- mutating RPCs (create_listing, submit_cart_order, etc.), a suspended or
-- restricted account must still be able to reach support -- PRD 33.2
-- explicitly keeps "dispute/support information" and "Submit an appeal"
-- reachable through a suspended seller's restricted sign-in. Only a fully
-- deleted account (profiles.deleted_at is not null) is blocked, matching
-- submit_report's (0067) own convention.
--
-- No email is sent from this RPC. PRD 43.1's "may optionally trigger
-- email notification" is optional by its own wording, and email sending
-- is explicitly out of scope for this task.
--
-- No RLS policy is added here either (consistent with reports/
-- moderation_actions in 0066): this project's existing rls_auto_enable
-- event trigger enables RLS with zero policies by default (deny-all), and
-- every access path here is the SECURITY DEFINER insert RPC below -- there
-- is no "view my past tickets" UI in this task's scope, so no SELECT
-- policy is added speculatively.

create type public.support_ticket_category_enum as enum (
  'general_inquiry',
  'account_issue',
  'order_dispute_issue',
  'report_a_problem'
);

create table public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete restrict,
  category public.support_ticket_category_enum not null,
  message text not null,
  created_at timestamptz not null default now(),
  constraint support_tickets_message_length_check check (char_length(btrim(message)) between 1 and 2000)
);

create index support_tickets_user_id_idx on public.support_tickets(user_id);

-- ============================================================
-- submit_support_ticket
-- ============================================================
create or replace function public.submit_support_ticket(
  p_category public.support_ticket_category_enum,
  p_message text
)
returns table (
  ticket_id uuid,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_caller_deleted_at timestamptz;
  v_message text;
  v_ticket_id uuid;
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
    raise exception 'Your account cannot submit support requests.' using detail = 'INTERACTION_BLOCKED';
  end if;

  -- ===================== message validation =====================
  v_message := btrim(p_message);
  if v_message is null or char_length(v_message) = 0 then
    raise exception 'Please describe your issue.' using detail = 'MESSAGE_REQUIRED';
  end if;
  if char_length(v_message) > 2000 then
    raise exception 'Please shorten your message.' using detail = 'MESSAGE_TOO_LONG';
  end if;

  -- ===================== insert the ticket =====================
  insert into public.support_tickets (user_id, category, message)
    values (v_caller, p_category, v_message)
    returning id, created_at into v_ticket_id, v_created_at;

  return query
    select v_ticket_id, v_created_at;
end;
$$;

revoke all on function public.submit_support_ticket(public.support_ticket_category_enum, text) from public;
revoke all on function public.submit_support_ticket(public.support_ticket_category_enum, text) from anon;
grant execute on function public.submit_support_ticket(public.support_ticket_category_enum, text) to authenticated;
