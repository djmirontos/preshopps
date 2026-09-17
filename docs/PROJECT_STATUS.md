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

- **Latest verified live migration:** `0094_published_listing_editing.sql` — Phase A foundation. Applied to live production Supabase (project `preshopps`, ref `ylhfbqcyxjmxrbpkxtgu`), SHA-256 `898e26c7d44b6495a5de20fc1959762078bf8051d4ad276d790bd00161eee2c6`. Deployment was preceded by a full hosted rehearsal (isolated Supabase project, real Auth/RLS/Storage/RPC exercise) that passed, and the production apply itself passed its immediate post-deploy schema, security/grant, and data-integrity checks (existing listings/orders unchanged, pre-existing order items still carry `NULL` snapshot columns, inventory/reservation math consistent, no unintended grant widening).
- **`0086`:** intentionally and permanently skipped — no migration with this number exists or should ever be created. This is enforced by an existing automated test; do not backfill it under any circumstances.
- **Next unused migration number:** `0095`.

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

---

## Current next major module

**Moderation completion.**

Post-publish Listing Editing (Phase B) is complete — see "Completed major modules" above. Per the current backlog ordering below, Moderation completion is next. The product and technical rules remain in `docs/PRD.md` and `docs/ARCHITECTURE.md`.

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
