-- Disputes MVP, schema layer (PRD 34, ARCHITECTURE.md S20): structural
-- foundation only -- four new tables, two new notification_type_enum
-- values, one new private storage bucket, one new SECURITY DEFINER helper
-- function for storage RLS. No dispute RPC is created here (0074/0075).
--
-- Pre-inspection findings (read-only, immediately before writing this file)
-- -----------------------------------------------------------------------
-- Migration history ends at 0072_user_blocking_rpcs (confirmed via
-- list_migrations, no drift). public.dispute_status_enum already exists,
-- created ahead of time in 0002_enums.sql with exactly the three
-- canonical values ('opened', 'under_review', 'resolved') -- reused
-- as-is, not recreated. public.order_status_enum already includes
-- 'disputed' (0002) and public.orders already has a disputed_at column
-- (0012) -- both anticipated this module and are reused, not altered.
-- public.order_status_history (0013) already exists and already captures
-- from_status/to_status/changed_by/note/created_at for ANY order status
-- transition -- reused as-is for the order-level disputed/cancelled/
-- completed transitions this module writes (0074/0075); no redundant
-- order-level history table is invented here. ARCHITECTURE.md S10/S20
-- explicitly names four disputes tables (disputes, dispute_images,
-- dispute_status_history, dispute_admin_notes) and a storage path
-- (`dispute-images/{dispute_id}/{image_id}.webp`) -- this migration
-- follows that named shape rather than improvising a different one,
-- adapting only the storage path's anchor segment for the same reason
-- 0048 anchored review-images on order_id instead of review_id (no
-- dispute_id exists yet at upload time -- see below). No disputes/
-- dispute_images/dispute_status_history/dispute_admin_notes table exists
-- anywhere yet -- clean namespace.
--
-- disputes: one row per dispute, tied to exactly one order
-- -----------------------------------------------------------------------
-- opened_by is the submitting participant (buyer or shop owner -- checked
-- by the create_dispute RPC, 0074), never a raw client-supplied user id.
-- reason/explanation are free text (PRD 34.2 lists "Reason" and "Short
-- explanation" with no canonical fixed reason list anywhere, unlike
-- report_reason_enum which PRD 31 explicitly enumerates -- an enum here
-- would be inventing categories canon never gave). status defaults to
-- 'opened' and only ever moves forward (opened -> under_review ->
-- resolved, never backward -- enforced by the update_dispute_status RPC,
-- 0075, not by a DB constraint, matching this schema's general
-- convention of putting *sequencing* rules in RPCs and only structural
-- invariants in CHECK constraints). resolved_by/resolved_at are populated
-- together, exactly once, mirroring reports' own resolved_by/resolved_at
-- pairing (0066) -- disputes_resolution_state_check is the same shape as
-- reports_resolution_state_check.
--
-- Duplicate-active-dispute prevention: a partial unique index
-- (disputes_order_id_active_unique) directly enforces "at most one
-- non-resolved dispute per order" at the database level -- this is the
-- primary, explicit mechanism this task's own instruction asks for, not
-- left to the indirect side effect of the order already being 'disputed'
-- (which would stop protecting once a dispute is resolved but the order
-- was deliberately left in 'disputed', per this task's own "do not invent
-- restoration" instruction -- see 0074's own header for why order status
-- is not automatically restored on resolution).
--
-- dispute_images: up to 3 per dispute, enforced by create_dispute (0074)
-- -----------------------------------------------------------------------
-- No DB-level count constraint, matching this schema's existing
-- convention for listing images (1-8, enforced in publish_listing, not a
-- trigger) and review images (up to 2, enforced in create_review) --
-- count enforcement belongs in the RPC that has the full picture of a
-- single dispute-creation call, not a trigger that would need to handle
-- races awkwardly for no real benefit (dispute images are only ever
-- written once, at creation, by create_dispute).
--
-- dispute_status_history / dispute_admin_notes: append-only, admin-
-- identity-preserving, mirroring moderation_actions' (0066) own append-
-- only, no-updated_at convention exactly.
--
-- No RLS policy on any of the four tables (consistent with reports/
-- moderation_actions/support_tickets, 0066/0069): rls_auto_enable enables
-- RLS with zero policies (deny-all) on every new table automatically; all
-- access to these four tables is exclusively through the SECURITY
-- DEFINER RPCs added in 0074/0075.
--
-- notification_type_enum: two new values only
-- -----------------------------------------------------------------------
-- PRD 35.1 names exactly one dispute-facing notification category,
-- "Dispute activity" -- not a granular per-status-transition list the way
-- order status changes are individually named. Two values are added:
-- dispute_opened (notifies the *other* order participant when a dispute
-- is opened against their order) and dispute_resolved (notifies both
-- non-admin participants when admin resolves the case) -- the two
-- genuinely notification-worthy events a real user needs to know about.
-- The internal opened -> under_review admin-queue transition is
-- deliberately not a separate notification type: it is an internal admin
-- workflow marker, not a new fact requiring buyer/seller attention, and
-- PRD 35.1 does not name it as its own event the way e.g. "Order marked
-- Ready" is separately named. No new notifications table column is
-- needed for deep-linking (PRD 35.2 requires disputes to be deep-
-- linkable): every dispute belongs to exactly one order, so the
-- existing, already-present notifications.order_id column is reused to
-- link straight to that order's detail page (which now shows the dispute
-- section, per this task's own USER UI instruction) -- notifications
-- never need a dedicated dispute_id column for this to work.
--
-- Storage: a new PRIVATE bucket, unlike listing/review/shop images
-- -----------------------------------------------------------------------
-- listing-images/review-images/shop-images (0048) are all `public = true`
-- because that content is public marketplace material. Dispute evidence
-- is the opposite by explicit instruction ("no leaking private dispute
-- evidence publicly") -- dispute-images is created with `public = false`.
-- Path convention follows 0048's own established reasoning exactly:
-- ARCHITECTURE.md illustrates `dispute-images/{dispute_id}/{image_id}...`,
-- but (like review-images before it) no dispute_id exists yet at upload
-- time -- create_dispute (0074) takes already-uploaded storage paths as
-- input, the same shape create_review already uses for review_id. The
-- path is instead `dispute-images/{uploaderUserId}/{orderId}/{file}`:
-- anchored on the uploading user's own auth.uid() first (0048's own
-- uniform convention across all three existing buckets, needing no new
-- SQL function for insert/update/delete), then the order id (known at
-- upload time, and exactly what create_dispute needs to validate against
-- before persisting a dispute_images row).
--
-- Because this bucket is private, SELECT cannot use a simple public
-- policy the way the other three buckets do, and a plain RLS subquery
-- against `orders` cannot see order rows at all (orders has RLS enabled
-- with zero policies -- confirmed live -- exactly the blocker 0048's own
-- header already anticipated for this exact situation: "would need...
-- a new SECURITY DEFINER helper function"). can_view_dispute_evidence(uuid)
-- is that minimal helper: given an order id, it returns true for an
-- admin (any public.user_roles row) or either of that order's two real
-- participants (buyer or shop owner), false otherwise -- resolved with
-- SECURITY DEFINER so it can see into orders/shops despite their own
-- RLS, and used only as a boolean building block inside the storage
-- policy below (never exposed as a general-purpose data-returning RPC).
-- The storage SELECT policy itself allows the uploader's own files
-- unconditionally (cheap, no function call) or this helper's result for
-- anyone else -- so both order participants and admin can view evidence
-- at any dispute status, consistent with PRD 34.6's "resolved disputes
-- remain attached to order history for buyer, seller, admin" (read as
-- applying to the dispute's full record, evidence included, not just its
-- resolved outcome text).

alter type public.notification_type_enum add value 'dispute_opened';
alter type public.notification_type_enum add value 'dispute_resolved';

-- ============================================================
-- disputes
-- ============================================================
create table public.disputes (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  opened_by uuid not null references public.profiles(id) on delete restrict,
  reason text not null,
  explanation text not null,
  status public.dispute_status_enum not null default 'opened',
  resolved_by uuid references public.profiles(id) on delete restrict,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  constraint disputes_reason_not_blank_check check (length(btrim(reason)) > 0),
  constraint disputes_reason_length_check check (char_length(reason) <= 200),
  constraint disputes_explanation_not_blank_check check (length(btrim(explanation)) > 0),
  constraint disputes_explanation_length_check check (char_length(explanation) <= 2000),
  constraint disputes_resolution_state_check check (
    (status = 'resolved' and resolved_by is not null and resolved_at is not null)
    or (status <> 'resolved' and resolved_by is null and resolved_at is null)
  )
);

create index disputes_order_id_idx on public.disputes(order_id);

-- Primary, explicit "one active dispute per order" enforcement -- see
-- header. A resolved dispute does not block a later, separate dispute on
-- the same order (e.g. a new problem arising after the first was closed).
create unique index disputes_order_id_active_unique
  on public.disputes(order_id)
  where status <> 'resolved';

-- ============================================================
-- dispute_images
-- ============================================================
create table public.dispute_images (
  id uuid primary key default gen_random_uuid(),
  dispute_id uuid not null references public.disputes(id) on delete restrict,
  storage_path text not null,
  created_at timestamptz not null default now(),
  constraint dispute_images_storage_path_not_blank_check check (length(btrim(storage_path)) > 0)
);

create index dispute_images_dispute_id_idx on public.dispute_images(dispute_id);

-- ============================================================
-- dispute_status_history
-- ============================================================
create table public.dispute_status_history (
  id uuid primary key default gen_random_uuid(),
  dispute_id uuid not null references public.disputes(id) on delete restrict,
  from_status public.dispute_status_enum,
  to_status public.dispute_status_enum not null,
  changed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint dispute_status_history_from_ne_to_check check (from_status is null or from_status <> to_status)
);

create index dispute_status_history_dispute_created_idx
  on public.dispute_status_history(dispute_id, created_at);

-- ============================================================
-- dispute_admin_notes
-- ============================================================
create table public.dispute_admin_notes (
  id uuid primary key default gen_random_uuid(),
  dispute_id uuid not null references public.disputes(id) on delete restrict,
  admin_id uuid not null references public.profiles(id) on delete restrict,
  note text not null,
  created_at timestamptz not null default now(),
  constraint dispute_admin_notes_note_not_blank_check check (length(btrim(note)) > 0),
  constraint dispute_admin_notes_note_length_check check (char_length(note) <= 2000)
);

create index dispute_admin_notes_dispute_created_idx
  on public.dispute_admin_notes(dispute_id, created_at);

-- ============================================================
-- can_view_dispute_evidence: storage-policy helper only
-- ============================================================
create or replace function public.can_view_dispute_evidence(
  p_order_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_buyer_id uuid;
  v_shop_owner_id uuid;
begin
  v_caller := auth.uid();
  if v_caller is null then
    return false;
  end if;

  if exists (select 1 from public.user_roles ur where ur.user_id = v_caller) then
    return true;
  end if;

  select o.buyer_id, s.owner_id into v_buyer_id, v_shop_owner_id
    from public.orders o
    join public.shops s on s.id = o.shop_id
    where o.id = p_order_id;

  return v_caller = v_buyer_id or v_caller = v_shop_owner_id;
end;
$$;

revoke all on function public.can_view_dispute_evidence(uuid) from public;
revoke all on function public.can_view_dispute_evidence(uuid) from anon;
grant execute on function public.can_view_dispute_evidence(uuid) to authenticated;

-- ============================================================
-- storage: dispute-images (private)
-- ============================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('dispute-images', 'dispute-images', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy dispute_images_insert_own
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'dispute-images'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy dispute_images_update_own
on storage.objects for update
to authenticated
using (
  bucket_id = 'dispute-images'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'dispute-images'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy dispute_images_delete_own
on storage.objects for delete
to authenticated
using (
  bucket_id = 'dispute-images'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- Private bucket: the uploader always sees their own files (cheap path
-- check, same as the other three buckets); anyone else must pass the
-- participant-or-admin helper above. No anon access at all.
create policy dispute_images_select_participants_or_admin
on storage.objects for select
to authenticated
using (
  bucket_id = 'dispute-images'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.can_view_dispute_evidence(((storage.foldername(name))[2])::uuid)
  )
);
