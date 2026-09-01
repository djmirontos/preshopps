# Preshopps AGENTS.md

## Purpose

This file defines how AI coding agents must work inside the Preshopps repository.

It is an execution contract, not a product specification.

Every agent must follow the canonical product and architecture documents before making changes.

---

## Canonical Source of Truth

Read these files before implementing meaningful work:

1. `PRD.md`
2. `ARCHITECTURE.md`
3. `ARCHITECTURE_ESSENTIALS.md`
4. `AGENTS.md`
5. `CLAUDE.md` when present

Priority order:

```text
PRD.md
  > ARCHITECTURE.md
    > ARCHITECTURE_ESSENTIALS.md
      > AGENTS.md
        > CLAUDE.md
          > implementation assumptions
```

If documents conflict:

- Product behavior follows `PRD.md`.
- Technical direction follows `ARCHITECTURE.md`.
- `ARCHITECTURE_ESSENTIALS.md` is a compact implementation checklist only.
- Do not silently resolve material conflicts by inventing new behavior.
- Escalate material scope, security, privacy, cost, or architecture conflicts before implementation.

---

## Product Rule

Preshopps is a simple, mobile-first, multi-seller marketplace for pre-loved and brand-new items.

The MVP must remain intentionally simple.

Do not turn it into:

- Shopee
- Lazada
- Facebook Marketplace clone with every feature
- Social network
- Payment platform
- Logistics platform
- Real-time chat platform
- Microservice architecture

Implement the approved MVP only.

---

## Working Style

Agents must:

- Make the smallest correct change.
- Prefer clarity over cleverness.
- Prefer boring, maintainable architecture.
- Keep business logic outside large UI components.
- Reuse existing abstractions before creating new ones.
- Avoid speculative infrastructure.
- Preserve current behavior unless the task explicitly changes it.
- Keep changes easy to review and revert.
- Never perform unrelated refactors inside a focused task.

Do not rewrite large areas of the codebase simply because another style is preferred.

---

## Before Starting Any Task

Before changing code:

1. Read the relevant canonical docs.
2. Inspect existing implementation.
3. Identify affected routes, features, data models, RLS policies, and tests.
4. Confirm the requested behavior already exists in the PRD.
5. Determine whether a database migration is actually necessary.
6. Check whether the change impacts:
   - auth
   - ownership
   - privacy
   - moderation
   - stock
   - orders
   - messaging
   - SEO
   - uploads
7. Keep implementation scope limited to the task.

Do not ask the user to repeat information already present in repository docs.

---

## Repository Philosophy

Use a modular monolith.

Expected logical separation:

```text
app/
features/
components/
lib/
types/
supabase/
tests/
```

Possible feature areas:

```text
features/
  auth/
  marketplace/
  listings/
  shops/
  cart/
  orders/
  messaging/
  reviews/
  notifications/
  moderation/
  disputes/
  locations/
  admin/
```

Do not create microservices.

Do not add a separate backend framework unless architecture is formally changed.

---

## Frontend Standards

Use:

- Next.js App Router
- TypeScript
- React
- Tailwind CSS
- small reusable UI primitives
- shadcn/ui when useful

Rules:

- Mobile-first.
- Must work on mobile, tablet/iPad, and desktop.
- Light mode only for MVP.
- Avoid desktop-only hover behavior.
- Maintain strong touch targets.
- Preserve Apple-inspired simplicity.
- Product imagery should remain visually prominent.
- Do not add excessive cards, borders, gradients, animations, or badges.
- No cluttered ecommerce visual patterns.
- Avoid large monolithic React components.
- Prefer server components unless client state/interactivity is actually required.
- Use client components deliberately, not by default.

---

## Accessibility

All user-facing work should consider:

- semantic HTML
- keyboard access
- visible focus states
- labels for form fields
- meaningful alt text
- sufficient contrast
- touch target sizing
- readable mobile typography
- error messages associated with relevant fields

Do not sacrifice accessibility for visual minimalism.

---

## TypeScript Rules

- Avoid `any`.
- Prefer explicit types.
- Reuse shared domain types.
- Use discriminated unions for meaningful state machines where useful.
- Keep validation schemas aligned with TypeScript types.
- Do not suppress compiler errors without a documented reason.

A task is not complete while new TypeScript errors remain.

---

## Validation

Use shared validation schemas, preferably Zod or equivalent.

Validate on both client and server when appropriate.

Important validation areas:

- auth forms
- profile fields
- shop creation
- shop slug
- listing creation
- listing conditional fields
- image count/type/size
- cart quantities
- order transitions
- review eligibility
- message length
- dispute input
- report input

Never trust client-side validation alone.

---

## Authentication

MVP auth is:

- email + password
- email verification
- password recovery by email

Do not add:

- SMS OTP
- Google auth
- Facebook auth
- magic-link-only flows

unless the product documents are changed.

Guests must still be able to browse public marketplace content.

---

## Authorization

Authorization is a hard requirement.

Never rely solely on hidden buttons or frontend checks.

Enforce permissions at:

1. application/server layer
2. database/RLS layer

Ownership rules must be explicit.

Examples:

- Sellers may mutate only their own shop/listings.
- Buyers may mutate only their own cart/order-side actions.
- Conversation participants may access only conversations they belong to.
- Reviews require eligible completed orders.
- Admin privileges must be verified server-side.
- Super Admin-only actions must be separately protected.

---

## Supabase Rules

Use Supabase for:

- Auth
- PostgreSQL
- Storage
- RLS
- Realtime where justified

Rules:

- Enable RLS on user-owned tables.
- Write policies deliberately.
- Never expose service role credentials client-side.
- Never use service role to bypass ownership checks casually.
- Service-role operations must stay server-only.
- Migrations must be version-controlled.
- Never edit production schema manually as an undocumented shortcut.
- Do not make destructive migrations automatically.

---

## Database Changes

For every schema change:

1. Explain why it is needed.
2. Create a migration.
3. Preserve existing data where possible.
4. Add required indexes.
5. Add/update RLS.
6. Update generated/shared types if used.
7. Add tests for important constraints.
8. Consider rollback/recovery.

Do not:

- drop tables casually
- rename critical columns without migration planning
- weaken constraints simply to silence errors
- bypass transaction safety around stock/orders

---

## Data Integrity

Core marketplace state must remain authoritative.

Important invariants:

- One shop maximum per account.
- Every listing belongs to one shop.
- Shop slug is unique.
- Stock must never oversell.
- Submitting an order request does not reserve stock.
- Seller acceptance reserves stock.
- Order item snapshots must preserve historical price/title/quantity context.
- Reviews only unlock after completed orders.
- Messages are immutable.
- Admin audit logs are append-only.
- Private moderation metadata must never leak publicly.

If a requested implementation risks violating an invariant, stop and reconsider the approach.

---

## Listing State Machine

Allowed conceptual states:

```text
draft
available
reserved
paused
sold
archived
```

Do not invent new public listing states without product approval.

Visibility must follow architecture rules.

---

## Order State Machine

Conceptual flow:

```text
pending
  -> accepted
  -> ready
  -> handed_over_or_shipped
  -> received_confirmed
  -> completed
```

Additional terminal/exception states:

```text
declined
cancelled
expired
disputed
```

Rules:

- Pending order requests expire after 72 hours.
- Seller gets one reminder around 24 hours before expiry.
- Accepted orders do not auto-expire.
- Buyer cancellation after acceptance is a request, not instant cancellation.
- Seller cancellation requires a reason.
- Partial acceptance requires buyer confirmation.
- Completion requires buyer receipt confirmation.
- Do not allow invalid state jumps.

Order transitions should be centralized and testable.

---

## Stock / Reservation Rules

This area is critical.

- Cart does not reserve inventory.
- Pending order request does not reserve inventory.
- Seller acceptance performs availability check.
- Acceptance and reservation must happen transaction-safely.
- Quantity must never become negative.
- Quantity-one listings become Reserved after acceptance.
- Completing the transaction moves appropriate inventory toward Sold.
- Cancellation should release reserved stock where appropriate.

Do not implement stock reservation using client-side assumptions.

---

## Messaging Rules

MVP messaging is intentionally lightweight.

Allowed:

- text
- listing-linked threads
- general shop threads
- unread state
- archive
- mute
- mark unread
- inbox search

Not allowed in MVP:

- image attachments
- voice
- video
- calls
- typing indicators
- read receipts
- message editing
- deletion
- unsend

Messages must remain immutable for moderation/dispute integrity.

Supabase Realtime may be used for message refresh, but do not build presence infrastructure.

---

## Review Rules

Reviews are seller-focused.

Requirements:

- completed-order buyer only
- one review per completed order
- 1–5 stars
- text
- up to 2 images
- 7-day buyer edit window
- one seller reply
- 7-day seller reply edit window
- buyer cannot directly delete
- seller cannot hide
- admin moderation only

Do not add product review scoring.

---

## Trusted Seller Rules

Initial criteria:

- verified email
- >= 5 completed orders
- >= 3 verified reviews
- average rating >= 4.0
- no active serious moderation issue

Trusted Seller status is dynamic.

Do not hardcode the badge permanently once earned.

Keep eligibility calculation centralized and testable.

---

## Images

Listing photos:

- 1–8
- actual item photo required
- preserve entire image
- preserve aspect ratio
- no forced crop
- automatically resize/compress
- clear output
- per-image upload progress
- reorderable
- selectable cover image

Pre-loved:

- actual-item photos only

Brand New:

- at least one actual-item photo
- catalog/reference photos allowed
- reference images must be labeled

Do not upload video in MVP.

---

## Upload Security

For uploads:

- validate MIME type
- validate extension
- validate file size
- validate image dimensions if needed
- restrict storage path by owner
- generate safe filenames
- never trust browser-provided filename
- handle partial upload failure
- remove abandoned uploads where practical

---

## Location Rules

MVP UI supports Philippines only.

Structure:

```text
Country
Province
City/Municipality
Barangay
```

Country support must exist in data architecture for future expansion.

Do not add GPS/Near Me in MVP.

Never expose exact residential address publicly.

---

## Search

MVP search uses PostgreSQL capabilities.

Do not add Elasticsearch, Typesense, Meilisearch, Algolia, or other dedicated search services unless approved.

Search/filter state should live in URL query parameters.

Default marketplace ordering is Newest first.

Use cursor/progressive loading.

---

## Cart Rules

Guests:

- cart stored locally

Signed-in users:

- cart stored in database

On auth:

- merge guest and account carts carefully
- revalidate availability
- revalidate price
- revalidate quantity
- revalidate seller state

Multi-seller cart must create separate order requests per seller.

Unavailable items remain visible in cart but cannot be submitted.

---

## Inquiry-Only Categories

These do not use cart/order flow:

- Cars
- Motorcycles
- For Rent

They may use:

- Message Seller
- Favorite
- Share
- Negotiable

Do not accidentally expose Add to Cart for these categories.

---

## Notifications

Use in-app notifications for marketplace events.

Use email for important transactional/account events.

Chat:

- immediate in-app notification
- delayed/grouped unread email
- never send one email per individual chat message

Email failure must not roll back successful core database operations.

---

## Moderation

Users may report:

- listings
- shops/sellers
- reviews
- conversations/messages

Admin actions must:

- be permission-checked
- be auditable
- preserve internal notes privately
- notify affected users when appropriate

Suspension behavior must follow architecture.

---

## Admin Audit Log

Important admin actions must create immutable audit entries.

Log at minimum:

- actor
- action
- target
- before/after summary where appropriate
- reason
- timestamp

Never expose audit logs publicly.

---

## Disputes

Disputes support:

- reason
- explanation
- up to 3 images
- status history
- private admin notes

Status:

```text
opened
under_review
resolved
```

Do not implement:

- escrow
- refunds
- payment arbitration

Preshopps does not process payment in MVP.

---

## SEO

Public shops and eligible listings should be SEO-friendly.

Use:

- server-generated metadata
- canonical URLs
- Open Graph
- product image
- clean slugs
- structured data where useful

Sold/archived pages remain accessible as unavailable.

Paused listings are non-public.

Old shop slugs redirect.

---

## Performance

Priorities:

- fast mobile load
- efficient marketplace queries
- avoid N+1 queries
- cursor pagination
- appropriate DB indexes
- responsive images
- lazy loading
- minimal client JavaScript where possible

Do not introduce Redis or external caching prematurely.

---

## Error Handling

Handle explicitly:

- upload failures
- network failures
- stale cart
- removed listing
- suspended seller
- stock conflict
- message failure
- email failure
- unauthorized mutation
- invalid state transition

Do not swallow errors silently.

User-facing errors should be clear but must not leak secrets or internal stack traces.

---

## Logging

Log meaningful server-side failures.

Never log:

- passwords
- auth tokens
- service keys
- private credentials
- sensitive message contents unless specifically required for secure debugging

Prefer structured logs.

---

## Environment Variables

Expected categories:

- public Supabase URL/key
- private Supabase service role
- email provider key
- application URL

Rules:

- `.env*` secrets must not be committed.
- Never print secrets in CLI output.
- Never paste production secrets into code.
- Keep private keys server-side.

---

## Testing Expectations

Every meaningful feature should include appropriate tests.

Prioritize:

### Unit

- helpers
- validators
- state transitions
- trust calculations
- grouping logic
- formatting

### Integration

- auth
- RLS
- shop creation
- listing creation
- storage ownership
- orders
- stock conflicts
- reviews
- moderation

### E2E

Critical flows:

1. Guest browse -> signup -> cart preserved -> order request
2. Seller -> shop -> listing -> inquiry
3. Multi-seller cart -> separate orders
4. Order lifecycle through buyer receipt confirmation
5. Seller suspension hides public content
6. Dispute lifecycle

Do not claim a task is complete when relevant tests fail.

---

## Build Quality Checks

Before reporting completion, run relevant checks such as:

```text
typecheck
lint
tests
build
```

Use project-specific commands once the package scripts exist.

At minimum:

- no new TypeScript errors
- no new lint errors
- relevant tests pass
- production build succeeds when appropriate

If a check cannot be run, say so explicitly.

---

## Dependency Policy

Before adding a dependency:

1. Confirm existing code/platform cannot reasonably do the job.
2. Prefer maintained, mainstream packages.
3. Avoid tiny convenience packages for trivial logic.
4. Consider bundle impact.
5. Avoid dependencies requiring unnecessary infrastructure.
6. Avoid duplicate libraries for the same responsibility.

Do not upgrade major framework versions during unrelated work.

---

## Git Discipline

Agents must:

- keep changes focused
- inspect `git diff`
- inspect `git status`
- avoid committing generated junk
- avoid committing secrets
- avoid unrelated formatting churn

Never:

- force push
- rewrite shared history
- delete branches
- reset hard against user work
- discard uncommitted user changes

unless explicitly instructed.

---

## Commit Expectations

When asked to commit:

- use a focused commit
- commit only task-related files
- use a descriptive message
- do not include unrelated local changes

Before committing, report any unrelated modified/untracked files instead of silently including them.

---

## User Work Protection

Existing user changes are sacred.

Never overwrite or revert work that was not created by the current task unless explicitly instructed.

If you discover unrelated changes:

- preserve them
- work around them
- report them

Do not use destructive cleanup commands casually.

---

## Migration Safety

Never automatically apply destructive production migrations.

For high-risk database changes:

- create migration
- explain impact
- verify locally/staging
- require explicit approval before production application

Data deletion requires explicit confirmation unless it is isolated test data in an approved local/test environment.

---

## Scope Control

If a task says “implement X,” do not also implement:

- Y because it seems useful
- a redesign
- unrelated refactoring
- new analytics
- a new dependency stack
- additional auth methods
- new infrastructure

Finish X correctly first.

---

## When to Escalate

Pause implementation and surface the decision when a change materially affects:

- PRD scope
- money/payment
- privacy
- authentication
- security model
- RLS
- seller/buyer trust rules
- order semantics
- stock semantics
- moderation policy
- user data retention
- production infrastructure
- recurring infrastructure cost
- legal/compliance posture

Do not make these decisions silently.

---

## No-Guess Rule

When a material requirement is unclear:

- inspect canonical docs first
- inspect existing code second
- choose the least invasive interpretation if it is clearly safe
- otherwise flag the ambiguity

Do not fabricate product requirements.

---

## Documentation Updates

When implementation changes an approved architectural or product behavior:

- update the appropriate canonical doc in the same change

When implementation merely follows existing docs:

- do not rewrite docs unnecessarily

Do not allow documentation and code to drift materially.

---

## Definition of Done

A task is done only when:

- requested behavior is implemented
- architecture rules are respected
- security/ownership is enforced
- validation is present
- failure states are handled
- relevant tests pass
- typecheck/lint/build are clean where applicable
- no unrelated work was changed
- docs are updated if necessary
- final report clearly explains what changed

---

## Agent Completion Report

At the end of a coding task, report:

1. What changed
2. Key files changed
3. Database migration(s), if any
4. Security/RLS impact
5. Tests/checks run
6. Result
7. Any remaining issue or follow-up

Keep the report factual.

Do not claim success for checks that were not actually run.

---

## Explicit MVP Guardrail

Unless the canonical docs are changed, do not add:

- integrated payments
- GCash API
- escrow
- refunds
- courier APIs
- GPS Near Me
- dark mode
- video uploads
- voice/image chat
- calls
- typing indicators
- read receipts
- product variants
- SKU system
- scheduled publishing
- shop following
- shared carts
- commissions
- listing fees
- subscriptions
- sponsored marketplace ranking
- AI recommendations
- AI moderation dependency
- microservices
- dedicated search infrastructure
- international currency support
- multilingual UI

---

## Final Rule

When in doubt:

> Protect the approved product, protect user data, protect existing work, and implement the simplest secure solution that satisfies the task.
