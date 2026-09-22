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

- **Latest verified live migration:** `0100_allow_incomplete_fair_condition_draft.sql`. Applied to the Preshopps pre-launch Supabase project (project `preshopps`, ref `ylhfbqcyxjmxrbpkxtgu`) as migration version `20260921131835`. See "LAUNCH UX S1.1 — COMPLETE" under Completed major modules for the full deployment record.
  - `0095_restriction_visibility_notifications.sql` — added the two new `notification_type_enum` values (`moderation_restriction_applied`, `moderation_restriction_lifted`) as its own, separately-committed migration, required ahead of `0096` by Postgres's enum-value-cannot-be-referenced-in-the-same-transaction-it-was-added-in rule.
  - `0096_restriction_visibility_notifications.sql` — added `notifications.restriction_id` (nullable FK to `user_restrictions(id)`, `on delete cascade`), the new self-read RPC `get_my_active_restrictions()`, and in-app restriction-applied/restriction-lifted notification creation inside `apply_user_restriction` / `lift_user_restriction` (alongside their pre-existing email/audit/trusted-seller logic, otherwise reproduced verbatim).
  - `0097_fix_apply_user_restriction_output_collision.sql` — fixed a pre-existing PL/pgSQL output-column collision in `apply_user_restriction`: its `RETURNS TABLE`'s `created_at` OUT parameter collided with a bare, unqualified `returning id, created_at` on the function's own fresh-insert branch, raising Postgres `42702` on every first-time (non-idempotent) restriction application. Fixed via table-aliased, column-qualified `RETURNING ur.id, ur.created_at`, matching the schema's own established fix convention from `0079_fix_plpgsql_output_column_collisions.sql`.
  - `0098_fix_submit_report_output_collision.sql` — fixed the identical collision class in `submit_report` (bare `returning id, created_at` colliding with its own `created_at` OUT parameter). Unlike `apply_user_restriction`, `submit_report` has no idempotent early-return branch, so this bug blocked **every** real report submission in production prior to this fix. Fixed the same way, via `RETURNING r.id, r.created_at`.
  - `0099_schedule_pending_order_expiry.sql` — schedules the existing, already-correct `expire_pending_orders()` RPC (`0024`, notification added in `0040`) via a new `pg_cron` job (`expire-pending-orders-every-15-min`, `*/15 * * * *`, direct SQL call — no HTTP, no Edge Function, no secret). No function redefinition, no schema change. See "Pending Order Auto-Expiration — COMPLETE" below.
  - `0100_allow_incomplete_fair_condition_draft.sql` — corrected a genuine seller-flow contradiction found during the LAUNCH UX S1 seller-listing-journey audit: `create_listing`/`update_listing` rejected a Fair-condition Draft immediately for blank Known Flaws, even though a Draft requires only a title and full publish-readiness (including Known Flaws for Fair) is canonically enforced only at publish time. Replaced the status-blind `listings_fair_requires_known_flaws_check` CHECK constraint with a status-aware equivalent (`status = 'draft' OR condition <> 'fair' OR (known_flaws IS NOT NULL AND btrim(known_flaws) <> '')`) and removed the now-redundant premature guard from both RPCs. Publish-time enforcement (`validate_published_listing`, and everything that calls it) was not touched. See "LAUNCH UX S1.1 — COMPLETE" below.
- **`0086`:** intentionally and permanently skipped — no migration with this number exists or should ever be created. This is enforced by an existing automated test; do not backfill it under any circumstances.
- **Next unused migration number:** `0101`.

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
  - **Rehearsal project status:** `preshopps-rehearsal-0096` (ref `kntjxgujeekmshmdxkrh`) has since been manually deleted by the owner and verified absent. Do not reference it as a live target.
  - **Operational investigation opened here — since resolved:** production `email_outbox` was found with 26 rows stuck `sent_at IS NULL` (pending) during this deployment. This predated `0095`–`0098` and was not a regression from this work. See "Transactional Email Recovery — COMPLETE" below for the root cause and resolution — moderation-restriction email delivery is now production-verified.

**Moderation Completion Step A1 (backend) — COMPLETE.**

- Transactional Email Recovery: the pre-existing `email_outbox` backlog (26 rows stuck pending, flagged above) was root-caused and fully resolved.
  - **Root cause:** `pg_cron` → `net.http_post` requests were reaching the `process-email-outbox` Edge Function correctly, but the function returned HTTP 401 on every invocation because its `CRON_SECRET` secret and Supabase Vault's `email_processor_cron_secret` were not aligned. Separately, the Edge Function's provider secrets (`RESEND_API_KEY`, `EMAIL_FROM_ADDRESS`, `APP_BASE_URL`) were also initially unconfigured.
  - **Backlog classification:** of the 26 stuck rows, 22 were proven stale (their underlying order had already moved past the point the email was about — e.g. a `new_order_request` for an order already resolved days earlier) and were cancelled (`email_outbox.status='cancelled'`, `last_error` set to a sanitized operational reason, no PII); the remaining 4 (`order_accepted` for orders still genuinely in progress) were preserved.
  - **Recovery:** provider secrets configured, `CRON_SECRET` reconciled with the Vault secret, cron recovered from HTTP 401 to HTTP 200 on its own next natural tick — no manual invocation. All 4 preserved emails sent exactly once. Final state: `sent=4`, `cancelled=22`, `pending=0`, `processing=0`, `failed=0`.
  - **No currently known email backlog remains from this incident.** Transactional email delivery is production-verified end-to-end (real send, not a rehearsal/simulated one).
  - Secret values are never recorded in this file or anywhere else in the repository.

**Transactional Email Recovery — COMPLETE.**

- Pending Order Auto-Expiration: `public.expire_pending_orders()` (added `0024`, notification added `0040`) already existed, was already correct (eligibility, locking, idempotency, active-reservation anomaly handling, `order_expired` notification, zero inventory/email side effects — all independently re-audited and confirmed unchanged), but had **never been invoked by anything** — no scheduler, cron job, or application code called it. Migration `0099_schedule_pending_order_expiry.sql` closes exactly that gap with a single new `pg_cron` job (`expire-pending-orders-every-15-min`, `*/15 * * * *`, direct SQL call to `expire_pending_orders(200)` — no HTTP, no Edge Function, no secret, mirroring the existing hourly reminder job's own pattern). No function redefinition, no schema change.
  - **Rehearsal validation:** the exact committed `0099` file was applied to `preshopps-rehearsal-0096` (ref `kntjxgujeekmshmdxkrh`) and exercised across four real, unforced natural `pg_cron` ticks (never manually invoked) against four synthetic fixtures: an overdue normal pending order (expired exactly once, correct history/notification, no duplicate across repeated ticks), an overdue order with a deliberately-induced active-reservation anomaly (correctly left pending, repeat-visible as `anomaly=true` on every subsequent tick — the function's own intended behavior), an old accepted order (untouched), and a pending order under 72h old (untouched).
  - **Production deployment:** applied as commit `2e83fe9` (`feat: schedule pending order auto-expiration`). The first natural tick (`2026-09-19 09:45:00 UTC`, no manual trigger) correctly expired the 3 real production orders that had been stuck `pending` past 72h since before the email-recovery work above (their staleness is what originally surfaced this scheduler gap) — exactly 3 `pending→expired` history rows, exactly 3 `order_expired` notifications, zero duplicates, zero email created (no `order_expired` email event exists in this schema — canon requires email only for the *reminder*, never for actual expiry), zero inventory/reservation/order-item mutation. 12 consecutive natural production ticks verified with no SQL error by final check. `pending >72h` is now 0.
  - Rehearsal project `preshopps-rehearsal-0096` (ref `kntjxgujeekmshmdxkrh`) has since been manually deleted by the owner and verified absent. Do not reference it as a live target.

**Pending Order Auto-Expiration — COMPLETE.**

- Moderation Completion — Step A2.1 (self-facing restriction visibility): the frontend surface for A1's own `get_my_active_restrictions()` RPC, previously called from nowhere in the app.
  - **Implemented:** a typed server-side `getMyActiveRestrictions()` wrapper (`lib/moderation/get-my-active-restrictions.ts`) calling only `get_my_active_restrictions()` — guest → `[]` with no RPC round trip, RPC error fails open to `[]` (display-only degrade, never a security boundary); an **Account status** section on `/account` (`components/account/AccountStatusSection.tsx`, `id="account-status"`) rendering nothing when unrestricted and one independent card per active restriction otherwise, with plain-language titles for `seller_suspended` ("Selling suspended"), `buyer_restricted` ("Buying restricted"), and `account_suspended` ("Account suspended"), each showing its `reason` and applied date — multiple simultaneous restrictions each get their own card, never merged; a persistent, **non-dismissible** global banner (`components/moderation/AccountSuspendedBanner.tsx`) shown on every authenticated page for `account_suspended` only (never for `seller_suspended`/`buyer_restricted` alone), linking to `/account#account-status`; frontend `NotificationType`/copy support added for `moderation_restriction_applied` ("Account restriction applied" → `/account#account-status`) and `moderation_restriction_lifted` ("Account restriction lifted" → plain `/account`, deliberately not the `#account-status` anchor, since a lift can leave zero active restrictions and that element would then not exist).
  - **Security/privacy:** the self-facing UI uses only `get_my_active_restrictions()` — never `get_admin_user_restrictions`, never `moderation_actions`, never a direct `user_restrictions` read, and never exposes moderator identity (`issued_by`/`lifted_by`) — proven by a dedicated architecture/privacy test, not merely asserted.
  - **Refresh behavior:** restriction state is fetched fresh on every server render/navigation/reload. No polling, no new Realtime subscription for `user_restrictions` was added — a known, deliberate, documented limitation (mid-session lift/apply without a navigation won't update the banner/card live; the existing notification still arrives live via the untouched Realtime pipeline).
  - **Hands-on QA passed** for `seller_suspended`, `buyer_restricted`, `account_suspended`, and multiple simultaneous restrictions, using a temporary, development-only, server-side fixture override (gated on a non-production `NODE_ENV` check, never reachable in a production or test build) that was completely removed before commit — no trace of it remains in the committed code, confirmed by a repo-wide search immediately before committing.
  - **Automated validation at completion:** full suite 277 files / 4361 tests passed; lint, typecheck, and production build all passed; `git diff --check` clean.
  - **No migration required.** Latest live migration remains `0099_schedule_pending_order_expiry.sql`; next unused migration remains `0100`.
  - Implementation commit: `86647ce` (`feat: show account restriction status`).

**Moderation Completion Step A2.1 — COMPLETE.**

- Seller listing management UX: a small, separately-scoped correction to `SellerListingsListClient.tsx`'s existing Edit action.
  - Draft / Available / Paused listings now expose **Edit** from My Listings (previously Draft-only, even though `/sell/{listingId}/edit` already fully supported Available/Paused via Phase B's own `PublishedListingEditor`).
  - Reserved / Sold / Archived remain non-editable, unchanged.
  - **Archive remains the only removal/hide behavior — no Delete Listing feature was added or is planned.**
  - Implementation commit: `cece503` (`fix: expose edit action for published listings`).

- Moderation Completion — Step A2.2 (restriction-aware blocked-action UX): replaced every generic, type-blind `INTERACTION_BLOCKED` dead-end across every action whose live RPC checks the caller's own `user_restrictions` with role-scoped, self-facing guidance (the exact confirmed restriction, e.g. "Your selling access is currently suspended.") plus a "View account status" link into A2.1's own Account status section. **Implemented, committed, and pushed** — this is frontend/presentation work only; nothing here was deployed as a database migration.
  - **Covered flows:** buyer review creation and editing, seller review replies, buyer listing/shop conversation start, seller order-conversation start, existing-thread messaging (buyer and seller roles), cart quantity changes (Add to Cart, increase/decrease), cart checkout, Buy Now, listing draft creation/editing/image replacement, listing publish, listing status management (pause/resume/sold/archive), and published-listing edit load/save.
  - **Security/privacy:** every presentation call reads only the caller's own restrictions — `interpretInteractionBlocked` (browser) or `interpretInteractionBlockedServer` (the one genuinely server-rendered path, published-listing edit load) — both delegating to the same pure, environment-independent selector. No listing/seller-side code (`LISTING_NOT_CARTABLE`, `LISTING_NOT_FAVORITABLE`, etc.) is ever interpreted as the caller's own restriction; no other participant's restriction is ever queried or shown.
  - **Final verification identified one previously-missed path:** `update_review` had a live `account_suspended` check that was never wired to the interpreter. Commit `6213067` corrected it as a bounded follow-up before closeout.
  - **Deliberately out of scope / deferred, not defects:** `merge_guest_cart`'s silent best-effort background merge keeps its existing, documented "never fails caller" contract unchanged (the equivalent interactive cart surfaces are now restriction-aware, so a restricted buyer still gets the explanation the next time they act directly); `create_shop`/`update_shop`/`accept_seller_policies` check no restrictions at all — a backend enforcement-policy question, not a presentation gap; `update_my_profile`'s narrow public-identity-field lock uses its own distinct, already-descriptive `PUBLIC_PROFILE_LOCKED` code, structurally outside this pattern by design. None of these represent an A2.2 defect.
  - **No migration or RPC change was required or made.** Latest live migration remains `0099`; migration `0100` remains unused.
  - **Automated validation** passed throughout the bounded implementation slices; the final correction run completed 287 files / 4794 tests, with lint, typecheck, build, and `git diff --check` passing.
  - Implementation commits (14): `acee03f` through `6213067`.

**Moderation Completion Step A2.2 — COMPLETE.**

- LAUNCH UX S1.1 (seller-flow contradiction fix): the LAUNCH UX S1 seller-listing-journey launch-readiness audit found one genuine, launch-blocking contradiction — selecting Condition = Fair required nonblank Known Flaws text immediately, even while saving an otherwise-incomplete Draft. This directly conflicted with the canonical rule that a Draft requires only a title, and that full publish-readiness (including Known Flaws for Fair) is enforced only at the Draft → Available transition, not during Draft creation or editing.
  - **Root cause:** `create_listing` and `update_listing` each carried a status-blind "Fair requires Known Flaws" guard that fired unconditionally, duplicating a check that already existed correctly — and status-appropriately — inside the shared `validate_published_listing` validator used by every real publish/republish path.
  - **Fix:** migration `0100_allow_incomplete_fair_condition_draft.sql` replaced the table's `listings_fair_requires_known_flaws_check` CHECK constraint with a status-aware equivalent that exempts Draft rows, and removed the now-redundant premature guard from `create_listing` and `update_listing`. `validate_published_listing` (and therefore `publish_listing`, `update_listing_status`'s paused → available resume transition, and `update_published_listing`'s per-save re-validation) was not touched — publishing a Fair listing without Known Flaws still fails with `KNOWN_FLAWS_REQUIRED`, and an already-published Fair listing still cannot have its Known Flaws cleared. No RLS policy, Storage policy, table, enum, index, or unrelated RPC behavior changed.
  - **Implementation-time automated validation:** full suite 288 files / 4818 tests passed; lint, typecheck, production build, and `git diff --check` all passed.
  - **Pre-deployment review:** confirmed the live database was still at migration `0099`, that the expected pre-`0100` constraint and RPC definitions were present exactly as designed against, and — since the new constraint predicate is a strict relaxation of the old one, exempting only Draft rows — that no existing-row data cleanup was required before validating the new constraint.
  - **Deployment:** migration `0100` applied successfully to the Preshopps pre-launch Supabase project (project `preshopps`, ref `ylhfbqcyxjmxrbpkxtgu`) as migration version `20260921131835`. Implementation commit `55e5fdc` (`fix(listings): allow incomplete fair drafts`).
  - **Post-deployment verification:** direct PostgreSQL catalog inspection confirmed the new constraint's exact validated definition, the updated `create_listing`/`update_listing` bodies, unchanged publish-time enforcement in `validate_published_listing`/`publish_listing`/`update_listing_status`/`update_published_listing`, and unchanged `SECURITY DEFINER`/`search_path`/authenticated-only execution grants on both redefined functions. Supabase security and performance advisors were re-run post-deployment and showed no new finding attributable to `0100` — every finding matched the pre-deployment baseline exactly.
  - **Hosted synthetic SQL smoke harness:** two attempts at an additional, optional rollback-only SQL smoke test (exercising Draft/publish behavior directly via synthetic fixtures) did not complete, due to test-scaffolding issues unrelated to the migration itself: the first attempt's synthetic signup fixture omitted the `policies_accepted` flag the live `handle_new_user()` trigger requires; after correcting that, the second attempt's temp results-table lost write access after the script switched simulated role to `authenticated` mid-transaction. Both attempts rolled back completely — zero fixture residue, database aggregate counts unchanged before and after each attempt. Migration `0100` was deployed successfully and verified through post-deployment catalog checks plus owner end-to-end QA on the Netlify-hosted application. The optional hosted synthetic SQL smoke harness remained incomplete because of fixture-scaffolding issues; both attempts rolled back with zero residue and did not indicate a migration or product defect.
  - **Owner hands-on QA** on the Netlify-hosted Preshopps site at commit `55e5fdc` passed the complete end-to-end workflow: save an incomplete Fair Draft; reopen and update that incomplete Fair Draft; publish rejected without Known Flaws; publish succeeds after adding Known Flaws; clearing Known Flaws from a published Fair listing is rejected; non-Fair listing behavior confirmed unaffected.

**LAUNCH UX S1.1 — COMPLETE.**

- LAUNCH UX S1.2 (action-feedback and notification UX): a comprehensive, read-only mutation-surface audit across the full seller/buyer application (listing, cart, orders, messaging, reviews, account/shop, moderation/support/disputes, authentication) classified every action's existing feedback among transient toast, inline validation/error, confirmation dialog, persistent guidance/banner, or navigation/visible state change, and produced a UX policy recommendation.
  - **Policy:** explicitly avoids a blanket "toast everything" approach and avoids duplicate/conflicting feedback (e.g. a toast repeating text already shown inline, or a toast firing alongside a destination page that already visibly changed). Frontend notifications remain presentation-only; backend/RPC results remain the authoritative source of truth. A2.2's existing restriction-aware guidance (see "Moderation Completion Step A2.2 — COMPLETE" above) remains inline/persistent by design — it describes an ongoing blocking account state with an actionable link, not a completed action, and would lose that link/actionability if converted to an auto-dismissing toast.
  - **Foundation implementation** (commit `d6218da`, `feat: add shop update success notification`): added `sonner@2.0.8` as a production dependency; one root-level `<Toaster>` mounted in `app/layout.tsx` as a sibling to `{children}` (survives client-side navigation/`router.refresh()`, since the layout itself never unmounts on a route change); position top-center; routine success duration 4000ms; no visible close button. Shared wrapper `lib/notifications/toast.ts` exposes exactly `notifySuccess(message)`. Existing inline validation/errors were preserved unchanged. No migration, RPC, RLS, Storage, schema, or data change was required — this is a pure frontend/presentation addition.
  - **First integration:** the seller's existing-shop Update action (`components/seller/ShopForm.tsx`, edit mode) calls `notifySuccess("Shop updated")` immediately after `update_shop` confirms success — never on validation failure, mutation failure, or shop creation (creation retains its own existing navigation-based confirmation, unchanged). Best-effort old-logo Storage cleanup (pre-existing behavior) remains non-fatal and never turns an already-successful update into a visible error.
  - **Green semantic styling correction** (commit `0d1ca28`, `fix: use green success toast styling`): owner live QA on the Netlify-hosted app found the success toast rendering gray rather than green. Corrected by enabling Sonner's `richColors` prop globally on the root `<Toaster>` — no custom color CSS or hardcoded green styling was introduced; toast copy, duration, position, and dismiss behavior were unchanged.
  - **Automated validation:**
    - Foundation (`d6218da`): focused tests 31/31 passed; full suite 289 files / 4829 tests passed; lint, typecheck, and production build (all 39 routes) passed; `git diff --check` clean.
    - Green-styling correction (`0d1ca28`): focused tests 31/31 passed; lint, typecheck, and production build (all 39 routes) passed; `git diff --check` clean.
    - An independent read-only pre-commit review concluded `READY TO COMMIT` before each of the two commits above.
    - The repository was clean and synchronized with `origin/main` after each push.
  - **Owner live QA** on the Netlify-hosted application, performed after deployment of commit `0d1ca28`, passed: a successful Shop Update produces a green "Shop updated" toast; the toast is top-center and readable; it appears exactly once; it auto-dismisses after approximately four seconds; saved shop changes persist after a refresh; existing validation behavior is unaffected. This confirms the notification foundation and its first integration — it does not mean every mutation surface now has notifications.
  - **Status:** the shared notification foundation and the Shop Update integration are complete and production-verified. The broader action-feedback rollout across other seller/buyer actions is still in progress — **LAUNCH UX S1.2 as a whole is not yet complete.**
  - **Next bounded slice — seller listing action feedback (not yet started):** Publish, Pause, Resume, Mark Sold, and Archive success feedback. Publish is an intentional, ordinary state transition (the listing remains editable and can still be Paused/Archived afterward) and should not receive a new confirmation dialog. Mark Sold and Archive already use the shared `ConfirmDialog`; their existing confirmation styling should be reviewed for destructive presentation (the `destructive` prop). Any new toast must fire only after confirmed success, existing inline errors must remain, and any visible state change already shown (e.g. a status badge update) should be weighed to avoid redundant feedback. The implementation must be subdivided further if source review shows these five actions do not share a safe common path.

---

## Current next major module

**Action-feedback and notification UX — seller listing action feedback.**

Moderation Completion Steps A1, A2.1, and A2.2 are all complete, committed, and pushed. **A2.3** (a formal suspension/restriction appeal flow, building on the existing `support_tickets` architecture) is explicitly **deferred until after launch** — this is an implementation-sequencing decision, not a removal of the canonical appeal requirement described for later moderation work. Initial launch is owner-administered, and moderation restrictions are not expected to be actively used during it, so no interim appeal feature is required before launch. Existing support-ticket access remains available to any restricted user today (per A1/A2.1), but this must not be described as a completed formal appeal system — that remains A2.3's own future scope.

The end-to-end seller/buyer UI/UX launch-readiness audit's first bounded slice — the seller listing journey (LAUNCH UX S1), including its one confirmed launch-blocking correction (LAUNCH UX S1.1, migration `0100`) — is complete; see "LAUNCH UX S1.1 — COMPLETE" above. The **action-feedback and notification UX audit** (LAUNCH UX S1.2) is also complete, and its shared notification foundation plus first integration (Shop Update) are implemented and production-verified — see "LAUNCH UX S1.2" above for the full record, including commits `d6218da` and `0d1ca28` and owner Netlify QA. The audit's UX policy distinguishes:

- toasts for completed, non-blocking actions;
- inline messages for validation and field-specific errors;
- confirmation dialogs for destructive/irreversible actions;
- persistent banners or inline guidance for states requiring continued attention;
- navigation/result pages where an additional toast would be redundant.

**The broader action-feedback rollout beyond Shop Update has not yet begun.** The next bounded slice is **seller listing action feedback**: success feedback for Publish, Pause, Resume, Mark Sold, and Archive. Publish is an intentional, ordinary state transition and should not receive a new confirmation dialog. Mark Sold and Archive already use the shared `ConfirmDialog`; their existing confirmation styling should be reviewed for destructive presentation. Any new toast must fire only after confirmed success, existing inline errors must remain, and redundant feedback (e.g. a toast repeating a status change already visible on the row) must be avoided. This slice must be subdivided further if source review shows the five actions do not share a safe common path. **LAUNCH UX S1.2 as a whole remains not yet complete** until this and any further action-feedback slices land.

See "Current backlog ordering" below for the full sequence. The product and technical rules remain in `docs/PRD.md` and `docs/ARCHITECTURE.md`.

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

1. End-to-end seller/buyer UI and UX launch-readiness audit
2. Launch-blocking UX corrections
3. Media upload/delivery and Storage hardening
4. Duplicate-listing enforcement audit
5. Launch-critical notifications/email gaps
6. Technical SEO
7. Full pre-launch hardening and launch audit
8. A2.3 formal appeals after launch

Marketplace transactional email production verification (formerly item 2 here) is complete — see "Transactional Email Recovery — COMPLETE" above.

Item 1's first bounded slice (the seller listing journey audit, LAUNCH UX S1, including its one confirmed launch-blocking correction, LAUNCH UX S1.1 / migration `0100`) is complete — see "LAUNCH UX S1.1 — COMPLETE" above. Item 1's action-feedback and notification UX audit (LAUNCH UX S1.2) is also complete, with its shared notification foundation and first integration (Shop Update) implemented and production-verified — see "LAUNCH UX S1.2" above. Item 1's next bounded slice is seller listing action feedback (Publish/Pause/Resume/Mark Sold/Archive) — see "Current next major module" above; the broader action-feedback rollout is still in progress.

The following are folded into item 3 above once that work begins, not currently scheduled or in progress:

- Custom Preshopps category illustration system
- Category media optimization
- Listing image resize/compression audit
- WebP-first optimized listing uploads/delivery
- Responsive image variants/thumbnails
- Investigate AVIF delivery where it materially improves performance
- Orphaned Storage cleanup, Draft and published-listing galleries (see "Known accepted Phase B limitations" above)

Messaging email summary (see "Known accepted Messaging limitations" above) is folded into item 5 above once that work begins.

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
