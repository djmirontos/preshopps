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

## Current baseline

- **HEAD:** `3d08cb2`
- **Branch:** `main`
- **Working tree at this handoff:** clean

---

## Database state

- **Latest migration:** `0093_seller_order_messaging.sql`
- **`0086`:** intentionally and permanently skipped — no migration with this number exists or should ever be created. This is enforced by an existing automated test; do not backfill it under any circumstances.
- **Next migration number:** `0094`

Keep this section current — it is the reason a new agent doesn't need to run `ls supabase/migrations` and guess.

---

## Completed major modules

The following are implemented and merged as of the current baseline:

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

The current listing edit route (`app/sell/[listingId]/edit`) is explicitly draft-only by design — a listing that is no longer in `draft` status cannot currently be edited through it. Editing a listing after it has been published (while respecting order-snapshot integrity, per the PRD) has not yet been implemented.

This file does not design that feature. See `docs/PRD.md`/`docs/ARCHITECTURE.md` for the existing product rules that already anticipate it (e.g. post-publish photo reordering/cover-change/removal, editing after an order request exists while preserving accepted-order snapshots).

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
