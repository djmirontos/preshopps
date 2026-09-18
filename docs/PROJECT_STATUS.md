# Preshopps Project Status

## What this file is

This is a living implementation/handoff snapshot, not a canonical product or architecture source.

It exists so a new coding agent (or a returning one) can learn the current state of the repository without depending on prior chat history.

It is **not** a replacement for:

- `docs/PRD.md` — product behavior
- `docs/ARCHITECTURE.md` — technical architecture
- `docs/ARCHITECTURE_ESSENTIALS.md` — compact architecture checklist

Those three documents describe what Preshopps *should* do and how it is *designed*. This file describes what has *actually been built so far*, what is *broken/limited on purpose*, and what is *next*.

This file is expected to change often. Update it after any significant module or migration lands. If this file and the canonical docs disagree about a product rule, the canonical docs win — this file only tracks implementation progress against them.

---

## Repository milestones

Last completed product implementation milestone:

- Post-publish Listing Editing (Phase B) closeout
- Implementation commit: `8480516`

Previous product implementation milestone:

- Messaging MVP closeout
- Implementation commit: `3d08cb2`

Repository transition documentation milestone:

- Codex handoff documentation commit: `283244e`

Current branch:

- `main`

These hashes identify historical milestones, not the repository's current HEAD.

---

## Database state

- **Latest verified live migration:** `0098_fix_submit_report_output_collision.sql`. Applied to live production Supabase (project `preshopps`, ref `ylhfbqcyxjmxrbpkxtgu`) as part of the Moderation Completion Step A1 backend deployment (`0095` → `0096` → `0097` → `0098`, each its own sequential migration/transaction). See "Moderation Completion — Step A1 (backend)" under Completed major modules for the full deployment record.
  - `0095_restriction_visibility_notifications.sql` — added the two new `notification_type_enum` values (`moderation_restriction_applied`, `moderation_restriction_lifted`) as its own, separately-committed migration, required ahead of `0096` by Postgres's enum-value-cannot-be-referenced-in-the-same-transaction-it-was-added-in rule.
  - `0096_restriction_visibility_notifications.sql` — added `notifications.restriction_id` (nullable FK to `user_restrictions(id)`, `on delete cascade`), the new self-read RPC `get_my_active_restrictions()`, and in-app restriction-applied/restriction-lifted notification creation inside `apply_user_restriction` / `lift_user_restriction` (alongside their pre-existing email/audit/trusted-seller logic, otherwise reproduced verbatim).
  - `0097_fix_apply_user_restriction_output_collision.sql` — fixed a pre-existing PL/pgSQL output-column collision in `apply_user_restriction`: its `RETURNS TABLE`'s `created_at` OUT parameter collided with a bare, unqualified `returning id, created_at` on the function's own fresh-insert branch, raising Postgres `42702` on every first-time (non-idempotent) restriction application. Fixed via table-aliased, column-qualified `RETURNING ur.id, ur.created_at`, matching the schema's own established fix convention from `0079_fix_plpgsql_output_column_collisions.sql`.
  - `0098_fix_submit_report_output_collision.sql` — fixed the identical collision class in `submit_report` (bare `returning id, created_at` colliding with its own `created_at` OUT parameter). Unlike `apply_user_restriction`, `submit_report` has no idempotent early-return branch, so this bug blocked **every** real report submission in production prior to this fix. Fixed the same way, via `RETURNING r.id, r.created_at`.
- **`0086`:** intentionally and permanently skipped — no migration with this number exists or should ever be created. This is enforced by an existing automated test; do not backfill it under any circumstances.
- **Next unused migration number:** `0099`.

Keep this section current — it is the reason a new agent doesn't need to run `ls supabase/migrations` and guess.

---

## Completed major modules

The following are implemented and merged as of the product implementation milestone above:

- Marketplace/listings core (browse, search, filter, listing detail)
- Cart (guest + signed-in, multi-seller split)
- Orders core (order request lifecycle through completion)
- Reviews
- Moderation/disputes foundation
- Account/profile management
- Account security / change password
- Forgot-password / recovery-code flow
- Notifications (in-app Bell + Messages badge)
- Buyer ↔ seller messaging
- Seller "Message Buyer" from a customer order
- Messaging Realtime reliability (unique channel topics, subscription status logging, back-to-back message handling, own-message race handling)
- Messaging reconnect reconciliation (catch-up fetch on reconnect and on the very first subscribe, chronological merge, queued/coalesced retries)
- Unread Messages badge hydration revalidation (client-side authoritative refresh after mount, correcting a possible SSR cold-load failure)

**Messaging MVP — COMPLETE.**

- Post-publish Listing Editing (Phase B): the seller edit route (`app/sell/[listingId]/edit`) now branches on live listing status instead of remaining draft-only.
  - **Draft** — unchanged: existing `ListingForm` / `ListingImagesPicker` / `PublishListingButton` editor, `update_listing` / `replace_listing_images` / `publish_listing` flow, all verbatim.
  - **Available** and **Paused** — a real, revision-aware `PublishedListingEditor` (`components/seller/PublishedListingEditor.tsx`) wired to 0094's `get_published_listing_edit_state` / `update_published_listing`:
    - Seller-editable non-image fields (title, description, brand, known flaws, price, original price, negotiable, location, fulfillment methods, meetup note, vehicle/rental details) save through a diffed patch against the 0094 allowlist only.
    - `category_id` / `listing_type` / `condition` are immutable — rendered as a read-only summary, never sent in any patch.
    - Available quantity is editable with a minimum of 1 while Available and 0 while Paused, gated by the backend's own `quantity_editable` flag; raw `stock_quantity` / `reserved_quantity` are never exposed or sent.
    - No Publish button on either status — publishing remains Draft-only.
    - Revision-based optimistic concurrency: `revision` is handled as a string end-to-end (never a JS number); a `STALE_LISTING_REVISION` response shows a persistent conflict state, disables Save, and is never auto-retried; "Reload latest" explicitly discards both unsaved text and unsaved gallery state and replaces them from a fresh read.
    - Published gallery editing: upload, remove, reorder, set-cover, and (for Brand New) actual/reference toggling, all held as local state and sent as one complete gallery array atomically with the text patch in a single `update_published_listing` call. Removing a photo never calls Storage delete/update — the `listing_images` row disappears but the underlying Storage object is retained, preserving historical/order image references. 1–8 images, exactly one cover, and the existing Pre-loved/Brand-New actual-photo rules are all enforced client-side ahead of the backend's own authoritative checks.
  - **Reserved / Sold / Archived** — read-only: no editable form, no Publish button; the same route renders a dedicated read-only state.
  - Server/browser Supabase-client boundary: the route's initial load uses the cookie-aware server client; "Reload latest" and Save use the browser client from within `PublishedListingEditor` itself; both share identical response/error mapping (`lib/seller/published-listing-edit-state.ts`).
  - `next/image`'s allowed Storage hostname is derived from `NEXT_PUBLIC_SUPABASE_URL` at build time — no hardcoded project ref, no wildcard host.
  - Verified via a dedicated rehearsal Supabase project (`preshopps-rehearsal-0094`, ref `rldccjrajfqfwskejyat`) and owner hands-on QA — **both passed**. The rehearsal project was deleted by the owner after successful completion and no longer exists; do not reference it as a live target.
  - Full automated suite passed at closeout: 269 files / 4187 tests. Lint, typecheck, and production build all passed.
  - No P1/P2 issues remain — see "Known accepted Phase B limitations" below for the one accepted, deferred P3.

**Phase B Published Listing Editing — COMPLETE.**

- Moderation Completion — Step A1 (backend): restriction visibility/notifications plus two pre-existing PL/pgSQL bug fixes, deployed to live production as migrations `0095` → `0096` → `0097` → `0098`, each applied and verified as its own sequential migration/transaction.
  - `0095`/`0096` (new capability): affected users can now see their own active moderation restrictions via `get_my_active_restrictions()`, and both restriction-applied and restriction-lifted events now create an in-app notification (via the new `notifications.restriction_id` column) alongside the pre-existing transactional email and audit-trail behavior. No RLS policy was added or changed; access to `user_restrictions` remains solely through existing SECURITY DEFINER RPCs.
  - `0097` (bug fix): `apply_user_restriction` previously raised Postgres error `42702` on every first-time (non-idempotent) restriction application, due to a PL/pgSQL output-column collision between its `RETURNS TABLE`'s `created_at` OUT parameter and a bare, unqualified `returning id, created_at`. Fixed via table-aliased, column-qualified `RETURNING`, matching the fix convention already established by `0079_fix_plpgsql_output_column_collisions.sql`.
  - `0098` (bug fix): the identical collision class was found and fixed in `submit_report`. Unlike `apply_user_restriction`, `submit_report` has no idempotent early-return branch, so this bug blocked **100% of real report submissions** in production before this fix — there was no working path at all prior to `0098`.
  - **Rehearsal validation (hosted, disposable Supabase project, real Auth/RLS exercise via `SET ROLE authenticated` + JWT-claims GUC — not a mocked test):** all four migrations applied and verified on `preshopps-rehearsal-0096` (ref `kntjxgujeekmshmdxkrh`) before any production apply. Passed: restriction apply → duplicate apply (idempotent) → lift → duplicate lift (idempotent); self-read privacy (a user sees only their own restrictions, never another's or the moderator's identity); anon/non-admin denial on the admin-only apply/lift RPCs; trusted-seller recalculation triggered correctly on suspension-class restrictions; all four `submit_report` target types (listing, shop, review, conversation) with their existing self-report/non-participant guards; duplicate-reporting behavior preserved as-is (multiple reports against the same target from different reporters remain allowed by design, per `0067`'s own documented rationale — not a bug); admin report visibility unaffected.
  - **Production deployment:** `0095` → `0096` → `0097` → `0098` applied sequentially to live production Supabase (project `preshopps`, ref `ylhfbqcyxjmxrbpkxtgu`), each gated on its own post-apply verification before the next was applied. Post-deployment schema, grants, and RLS state were confirmed to match rehearsal's post-`0098` state exactly. No synthetic production users, restrictions, moderation actions, or reports were created at any point — pre- and post-deployment data-integrity checks both showed `user_restrictions` 0 active/0 lifted, `moderation_actions` 0, `reports` 0.
  - **Rehearsal project status:** `preshopps-rehearsal-0096` (ref `kntjxgujeekmshmdxkrh`) has **not** been deleted yet. Do not assume it is gone; confirm before treating the ref as reusable or unused.
  - **Open operational investigation (pre-existing, not introduced by this work):** production `email_outbox` currently has 26 rows with `sent_at IS NULL` (pending) despite the existing `process-email-outbox` Supabase Cron → Edge Function pipeline appearing correctly configured (cron jobs, `pg_net` call, and vault secret wiring were all confirmed unchanged by `0095`–`0098`). This was observed, not investigated or repaired, during this deployment. **Do not treat moderation-restriction email delivery (or any transactional email delivery) as verified until this is separately investigated.** This gap predates `0095`–`0098` and is not a regression from this work.

**Moderation Completion Step A1 (backend) — COMPLETE.**

---

## Current next major module

**Moderation completion — Step A2 (frontend).**

Moderation Completion Step A1 (backend) is complete and live in production — see "Completed major modules" above. Step A2 (the frontend surface for restriction visibility and any remaining moderation UI work) has not been started. Per the current backlog ordering below, Moderation completion remains the current top-priority module until A2 is done. The product and technical rules remain in `docs/PRD.md` and `docs/ARCHITECTURE.md`.

---

## Known accepted Messaging limitations

- Reconnect reconciliation fetches only the current newest page (30 messages). A single disconnect longer than that may leave a gap in the currently mounted thread until the user reopens/refreshes the conversation or manually pages back with "Load earlier." No message is ever lost server-side, and no ordering is ever corrupted — the gap is a temporarily incomplete client view, not a data-integrity issue.
- No message edit, delete, unsend, read receipts, or typing indicators — locked MVP messaging scope.
- No messaging email summary is currently implemented, even though the product specification (PRD) describes an "important unread messaging summary" email as intended MVP behavior. This is a real, known gap between spec and implementation, not a silently-dropped requirement.
- The Messaging P1 closeout items (channel-reuse race, subscription status visibility, unread-badge-clearing-on-refresh-failure, back-to-back message handling, reconnect reconciliation, chronological merge ordering, queued/coalesced reconnect retries, initial-subscribe reconciliation gap, unread-badge cold-load revalidation) are all complete.

---

## Known accepted Phase B limitations

- A newly-uploaded published-listing photo that is never saved (the seller abandons the editor before pressing Save changes) can become an orphaned Storage object. This is the direct consequence of a deliberate choice, not an oversight: published gallery removal never issues a Storage delete/update at all (so historical/order image references are never broken by an edit), and that same "no cleanup" rule applies uniformly, including to an unsaved upload. Deferred to later media/storage hardening, not fixed in this phase.
- Listing Storage UPDATE/DELETE removal (Phase A) intentionally leaves temporary unreferenced objects more broadly, including failed best-effort Draft cleanup — this predates and is unrelated to the Phase B limitation above. Draft gallery edits remain fully usable. Trusted, general orphan cleanup across both Draft and published galleries is deferred to the same later media/storage hardening work.

---

## Current backlog ordering

High-level order, not a committed schedule:

1. Moderation completion
2. Marketplace transactional email production verification
3. Duplicate-listing enforcement audit
4. Remaining P2 discovery/UI work
5. Technical SEO work
6. Full pre-launch hardening / launch audit

The following are deferred media/performance work, not currently scheduled or in progress:

- Custom Preshopps category illustration system
- Category media optimization
- Listing image resize/compression audit
- WebP-first optimized listing uploads/delivery
- Responsive image variants/thumbnails
- Investigate AVIF delivery where it materially improves performance

---

## Deferred / accepted product limitations

- Messaging email summary is specified product behavior (PRD) but not yet implemented in code — see "Known accepted Messaging limitations" above. This is a build gap, not a product decision to drop it.
- Self-service Change Email is not part of the current UI/workflow. The PRD does not describe a self-service change-email flow one way or the other — this is an absence in the current implementation, not a documented product exclusion; do not invent PRD wording that does not exist.
- Vehicle/rental structured fields may remain optional in the current implementation, while the vehicle/rental checkout and automated rental booking/deposit flows remain excluded from MVP per the PRD's own explicit exclusions list.

---

## Transition state

- Claude Code was the previous implementation agent for this repository.
- Repository documentation is being made agent-neutral so implementation work can continue with a different coding agent.
- The next implementation agent is expected to inspect the canonical docs (`docs/PRD.md`, `docs/ARCHITECTURE.md`, `docs/ARCHITECTURE_ESSENTIALS.md`), `AGENTS.md`, and this file before starting work.
- No agent should depend on prior chat history for architecture or product truth — the repository itself, plus these documents, must be sufficient.
