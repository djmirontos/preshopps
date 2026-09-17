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

---

## Current next major module

**Post-publish Listing Editing.**

The current listing edit route (`app/sell/[listingId]/edit`) remains draft-only.

Phase A — the database foundation (migration 0094: atomic published save/read
RPCs, revisions, historical order snapshots, immutable listing media policies,
and coherent order snapshot locking) — is **complete and live in production**.
Phase B frontend work (wiring the edit route to the new published-edit RPCs)
**has not started.**

Listing Storage UPDATE/DELETE removal intentionally leaves temporary unreferenced
objects, including failed best-effort draft cleanup. Draft gallery edits remain
usable. Trusted orphan cleanup is deferred to later media/storage hardening.

The product and technical rules are in `docs/PRD.md` and `docs/ARCHITECTURE.md`; the Phase B RPC contract is documented in `tests/database/README.md`.

---

## Known accepted Messaging limitations

- Reconnect reconciliation fetches only the current newest page (30 messages). A single disconnect longer than that may leave a gap in the currently mounted thread until the user reopens/refreshes the conversation or manually pages back with "Load earlier." No message is ever lost server-side, and no ordering is ever corrupted — the gap is a temporarily incomplete client view, not a data-integrity issue.
- No message edit, delete, unsend, read receipts, or typing indicators — locked MVP messaging scope.
- No messaging email summary is currently implemented, even though the product specification (PRD) describes an "important unread messaging summary" email as intended MVP behavior. This is a real, known gap between spec and implementation, not a silently-dropped requirement.
- The Messaging P1 closeout items (channel-reuse race, subscription status visibility, unread-badge-clearing-on-refresh-failure, back-to-back message handling, reconnect reconciliation, chronological merge ordering, queued/coalesced reconnect retries, initial-subscribe reconciliation gap, unread-badge cold-load revalidation) are all complete.

---

## Current backlog ordering

High-level order, not a committed schedule:

1. Post-publish Listing Editing
2. Moderation completion
3. Marketplace transactional email production verification
4. Duplicate-listing enforcement audit
5. Remaining P2 discovery/UI work
6. Technical SEO work
7. Full pre-launch hardening / launch audit

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
