# Preshopps CLAUDE.md

## Purpose

This file defines how Claude Code should work inside the Preshopps repository.

It is repository-specific operating guidance for implementation work.

Claude Code must follow the canonical product and architecture documents and must not invent new product behavior.

---

## Read First

At the start of every meaningful task, read:

1. `PRD.md`
2. `ARCHITECTURE.md`
3. `ARCHITECTURE_ESSENTIALS.md`
4. `AGENTS.md`
5. `CLAUDE.md`

Priority order:

```text
PRD.md
  > ARCHITECTURE.md
    > ARCHITECTURE_ESSENTIALS.md
      > AGENTS.md
        > CLAUDE.md
          > local implementation assumptions
```

If a lower-priority document conflicts with a higher-priority one, follow the higher-priority source.

Do not silently reinterpret product decisions.

---

## Product Summary

Preshopps is a simple, mobile-first, multi-seller marketplace for pre-loved and brand-new items.

Core principles:

- Guests can browse without an account.
- Marketplace discovery is product-first, not shop-first.
- One account may act as both buyer and seller.
- One shop maximum per account.
- Sellers publish listings.
- Buyers can favorite, message, add eligible items to cart, and submit order requests.
- Cars, Motorcycles, and For Rent listings are inquiry-only.
- Payments are not processed by Preshopps in MVP.
- Buyer and seller coordinate payment, meetup, delivery, shipping, or rental details themselves.
- Preshopps provides trust, messaging, order state, reviews, moderation, and marketplace discovery.
- UI should remain clean, light, simple, and uncluttered.

Do not expand beyond approved MVP scope.

---

## Development Philosophy

Claude Code should optimize for:

- correctness
- security
- clarity
- maintainability
- mobile usability
- small reviewable changes
- simple architecture

Prefer the simplest secure implementation that satisfies the requested behavior.

Avoid speculative engineering.

Do not introduce infrastructure because it may be useful someday.

---

## Architecture Style

Use a modular monolith.

Expected technology direction:

- Next.js App Router
- TypeScript
- React
- Tailwind CSS
- shadcn/ui or similar minimal primitives where useful
- Supabase Auth
- Supabase PostgreSQL
- Supabase Storage
- Supabase RLS
- Vercel
- transactional email abstraction, initially Resend or equivalent

Do not introduce:

- microservices
- separate backend framework
- Kafka/event bus
- Redis without proven need
- Elasticsearch/Algolia/Typesense/Meilisearch without approval
- unnecessary queues
- unnecessary cloud infrastructure

---

## Repository Structure

Prefer clear feature boundaries.

Target shape:

```text
app/
components/
features/
lib/
types/
supabase/
tests/
```

Feature areas may include:

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

Keep domain logic out of oversized React components.

---

## Task Execution

For every task:

1. Read the relevant canonical docs.
2. Inspect existing code before modifying anything.
3. Identify the smallest set of files required.
4. Check whether the requested behavior affects:
   - database schema
   - auth
   - RLS
   - ownership
   - order state
   - stock
   - privacy
   - moderation
   - SEO
   - email
   - storage
5. Implement only the requested scope.
6. Add or update tests where appropriate.
7. Run relevant checks.
8. Inspect the final diff.
9. Report exactly what changed.

Do not perform unrelated refactors.

---

## Important Product Guardrails

### Guest access

Guests may:

- browse
- search
- filter
- view shops
- view listings
- view reviews
- share listings
- maintain local recently viewed
- maintain local cart

Guests may not:

- favorite
- message
- submit order requests
- review
- sell
- submit support tickets

### Seller model

- One shop per account.
- Shop display names do not need to be unique.
- Shop slugs must be unique.
- Old slugs redirect to the new slug.
- One featured listing per shop.
- Featured listing affects only the shop page.

### Listing model

Statuses:

```text
draft
available
reserved
paused
sold
archived
```

Listing types:

```text
preloved
brand_new
```

Pre-loved conditions:

```text
like_new
very_good
good
fair
```

Brand New listings automatically use brand-new condition.

Fair condition requires known-flaws text.

### Inquiry-only categories

These categories must never expose Add to Cart:

- Cars
- Motorcycles
- For Rent

They may use:

- Message Seller
- Favorite
- Share
- Negotiable

### Normal sale categories

Eligible normal sale listings support:

- Add to Cart
- Order Request
- Message Seller
- Favorite
- Share

---

## Image Rules

Listing images:

- 1–8 images
- at least one real photo of the actual item
- preserve full aspect ratio
- no forced crop
- automatically resize/compress before upload
- maintain clear visual quality
- show per-image upload progress
- seller can reorder
- seller can change cover
- seller can remove photos if at least one valid actual-item photo remains

Pre-loved:

- actual-item photos only

Brand New:

- at least one actual-item photo
- may include catalog/reference images
- reference images must be labeled

No listing video in MVP.

---

## Location Rules

MVP UI supports Philippines only.

Location hierarchy:

```text
Philippines
  -> Province
    -> City / Municipality
      -> Barangay
```

Country support should exist in data architecture for future expansion.

Do not add GPS/Near Me.

Do not expose exact home addresses publicly.

Listing location defaults to shop location but may be changed per listing.

---

## Marketplace Rules

Default marketplace behavior:

- show all eligible active Philippines listings
- no forced Tangub-only default
- no GPS requirement
- default ordering: Newest first

Filters:

- keyword
- category
- listing type
- condition
- price
- province
- city/municipality
- barangay
- fulfillment method
- availability

Search/filter state must remain in the URL.

Do not silently restore old filters on a fresh visit.

Use progressive `Load More` / cursor pagination.

---

## Cart Rules

Guest cart:

- browser-local
- persists across browser restarts

Signed-in cart:

- database-backed
- persists across sessions

When a guest signs in:

- merge guest and account cart carefully
- revalidate price
- revalidate stock
- revalidate seller state
- revalidate availability
- prevent duplicate rows

Multi-seller cart:

- one visible cart may contain multiple sellers
- submission creates separate order request per seller

Unavailable cart item:

- remains visible
- clearly marked unavailable
- cannot be submitted
- other valid items may proceed

---

## Order Rules

Order request submission does not reserve inventory.

Reservation occurs only when seller accepts.

Acceptance must:

- re-check stock
- be transaction-safe
- never oversell

Conceptual order flow:

```text
pending
  -> accepted
  -> ready
  -> handed_over_or_shipped
  -> received_confirmed
  -> completed
```

Other states:

```text
declined
cancelled
expired
disputed
```

Rules:

- pending request expires after 72 hours
- seller reminder about 24 hours before expiry
- accepted orders do not auto-expire
- buyer may cancel directly only while pending
- accepted-order buyer cancellation becomes a request
- seller cancellation requires a reason
- partial acceptance is allowed
- buyer must confirm partial acceptance changes
- completion requires buyer confirmation of receipt
- review unlocks only after completed

Order item snapshots must preserve historical:

- title
- price
- quantity
- cover image reference
- item type/condition
- shop context

Later listing edits must never rewrite historical order data.

---

## Messaging Rules

MVP messaging is intentionally simple.

Conversation types:

- listing-specific
- general shop inquiry

Allowed:

- text
- unread status
- archive
- mute
- mark unread
- inbox search

Not allowed:

- image attachments
- video
- voice
- calls
- typing indicators
- read receipts
- message edit
- delete
- unsend

Messages are immutable.

External links in private messages may be plain text and should show a safety warning.

Do not render external clickable links in product descriptions.

---

## Review Rules

Reviews are seller-focused.

Eligibility:

- completed-order buyer only
- one review per completed order

Review:

- 1–5 stars
- short text
- up to 2 images
- purchased item may be shown as context

Editing:

- buyer may edit for 7 days
- seller may reply once
- seller reply editable for 7 days
- buyer cannot directly delete
- seller cannot hide
- admin moderation only

No product-rating system in MVP.

---

## Trusted Seller Logic

Initial criteria:

- verified email
- at least 5 completed orders
- at least 3 verified reviews
- average rating >= 4.0
- no active serious moderation issue

Trusted Seller status must be dynamically recalculated.

Do not permanently hardcode the badge.

Keep eligibility logic centralized and testable.

---

## Notifications

In-app notifications:

- message
- order request
- accepted
- declined
- cancelled
- partial acceptance
- ready
- handed over/shipped
- receipt confirmation required
- completed
- review
- moderation
- dispute updates

Email:

- important transactional/account events
- delayed/grouped unread chat notifications
- never one email per individual message

Email failure must not roll back successful core marketplace state.

---

## Moderation

Users may report:

- listings
- sellers/shops
- reviews
- messages/conversations

Common report reasons:

- Scam/Fraud
- Prohibited Item
- Misleading
- Harassment
- Spam
- Duplicate/Spam
- Other

Admin actions must be:

- permission checked
- auditable
- reasoned
- user-notified where appropriate

Private admin notes must remain private.

---

## Suspension

Seller suspension:

- hide public shop
- hide public listings
- preserve orders
- preserve messages
- preserve reviews
- preserve disputes
- preserve moderation history

Suspended seller may still sign in with restricted access for:

- suspension reason
- order history
- dispute/support access
- appeal

Separate buyer restrictions, seller restrictions, and full-account suspension are supported.

---

## Disputes

Dispute status:

```text
opened
under_review
resolved
```

Supports:

- reason
- explanation
- up to 3 images
- status history
- private admin notes

Do not build:

- escrow
- refund engine
- payment arbitration

Preshopps does not process payment in MVP.

---

## Admin Roles

### Admin

Can manage:

- users
- shops
- listings
- categories
- reports
- reviews
- orders
- disputes
- support
- moderation

### Super Admin

Everything Admin can do, plus:

- admin role management
- critical platform settings

Admin authorization must be enforced server-side and at the database/application boundary.

---

## Admin Audit Log

Important admin actions must be logged.

Capture:

- actor
- action
- target
- reason
- timestamp
- before/after summary where useful

Audit data must never be exposed publicly.

---

## Security Rules

Never:

- expose service-role keys client-side
- trust frontend role state
- trust client ownership
- expose private emails publicly
- expose exact addresses
- expose private admin notes
- weaken RLS for convenience
- make admin mutations directly from untrusted client paths
- log secrets
- commit secrets

Always validate user ownership and authorization on the trusted side.

---

## Supabase RLS

RLS is mandatory on user-owned data.

At minimum, protect:

- profiles
- shops
- listings
- favorites
- carts
- orders
- conversations
- messages
- reviews
- disputes
- support
- notifications

Public listing/shop reads should expose only intended public data.

Do not expose internal moderation metadata in public selects.

---

## Database Migration Rules

All schema changes require version-controlled migrations.

For each migration:

- explain why
- preserve existing data where possible
- add/update indexes
- add/update RLS
- update shared types
- test important constraints

Never automatically perform destructive production migrations.

Never drop production data casually.

---

## Validation Rules

Use shared schemas, preferably Zod.

Validate:

- auth
- profile
- shop
- slug
- listing
- conditional vehicle/rental fields
- uploads
- cart quantities
- orders
- transitions
- reviews
- messages
- disputes
- reports

Client validation improves UX.

Server validation is authoritative.

---

## SEO Rules

Public listing and shop routes should be SEO-friendly.

Use:

- server-generated metadata
- canonical URLs
- Open Graph
- listing image
- clean slugs
- structured data when useful

Examples:

```text
/shop/annes-closet
/item/nike-air-max-270-abc123
```

Sold/archived pages remain alive as unavailable pages.

Paused listings remain non-public.

Old shop slugs redirect.

---

## Social Sharing

Every public listing supports:

- Share
- Copy Link
- native Web Share API when available
- fallback when unavailable

Social metadata should point back to the canonical Preshopps item URL.

No Facebook Group auto-post automation in MVP.

---

## UI Rules

Design direction:

- mobile-first
- light mode only
- Apple-inspired simplicity
- white/light neutral surfaces
- near-black typography
- generous whitespace
- restrained rounding
- minimal shadows
- minimal animation
- one accent color
- product photography prioritized

Mobile bottom nav:

- Home
- Search
- Sell
- Messages
- Account

Mobile header:

- logo
- notifications
- cart

Avoid:

- flash-sale clutter
- loud gradients
- excessive badges
- dense dashboards
- giant hero banners
- hover-only interactions
- dark mode

---

## Performance Rules

Prioritize:

- fast mobile rendering
- cursor pagination
- indexed marketplace queries
- avoid N+1
- query only needed card fields
- responsive images
- lazy loading
- low client JS where possible

Do not add external cache/search infrastructure prematurely.

---

## Testing

Every meaningful task should add or update relevant tests.

Critical logic:

### Unit

- validators
- price formatting
- listing status transitions
- order transitions
- trusted seller calculation
- cart grouping
- inquiry-only category rules

### Integration

- auth/profile
- shop creation
- listing ownership
- image ownership
- cart merge
- order lifecycle
- stock conflict
- review eligibility
- moderation permissions
- RLS

### E2E

Critical flows:

1. Guest browse -> signup -> cart preserved -> order request
2. Seller signup -> shop -> listing -> inquiry
3. Multi-seller cart -> split order requests
4. Accept -> reserve -> ready -> handoff/shipping -> buyer receipt -> complete -> review
5. Seller suspension -> public shop/listings hidden
6. Dispute lifecycle

---

## Checks Before Completion

Run relevant project checks.

Typical checks:

```text
npm run typecheck
npm run lint
npm test
npm run build
```

Use the actual package scripts once created.

Do not report success if checks were not run.

If a check cannot run, state why.

---

## Git Safety

Never:

- force push
- hard reset user work
- delete branches
- discard unrelated local changes
- commit secrets
- silently include unrelated files

Before committing:

- inspect `git status`
- inspect `git diff`
- include only task-related files

Protect existing user changes.

---

## Commit Style

When asked to commit:

- use one focused commit where practical
- descriptive commit message
- commit only relevant files
- leave unrelated changes untouched

Example style:

```text
feat(listings): add seller listing creation flow
fix(orders): prevent stock oversell on acceptance
docs: add canonical architecture guidance
```

---

## Scope Discipline

Do not add these unless canonical docs are changed:

- payments
- GCash API
- QR payment processing
- escrow
- refunds
- courier integrations
- GPS Near Me
- dark mode
- video uploads
- image/voice chat
- calls
- typing indicators
- read receipts
- product variants
- SKU system
- scheduled publishing
- shop followers
- shared carts
- listing fees
- commission
- subscriptions
- sponsored marketplace ranking
- AI recommendations
- AI moderation dependency
- microservices
- dedicated search service
- international currencies
- multilingual UI

---

## Escalation Rule

Do not silently decide anything that materially changes:

- product scope
- payments
- privacy
- security
- authentication
- RLS
- ownership
- stock semantics
- order semantics
- trust/reputation
- moderation
- retention
- production infrastructure
- recurring cost
- legal/compliance posture

Surface the decision before implementation.

---

## User Interaction Rule

The project owner prefers controlled, one-step-at-a-time development.

When Claude Code is instructed through the project workflow:

- complete the requested step only
- report the result
- do not automatically continue to the next development milestone unless explicitly asked
- do not bundle multiple major tasks into one instruction
- keep debugging scope narrow

This is especially important for database, auth, deployment, and infrastructure work.

---

## Documentation Discipline

If code changes approved product or architecture behavior, update the relevant canonical document.

If implementation merely follows existing docs, avoid unnecessary doc churn.

Do not let the code and canonical docs materially diverge.

---

## Definition of Done

A task is complete only when:

- requested behavior works
- scope stayed focused
- authorization is correct
- RLS/security is correct
- validation exists
- errors are handled
- tests/checks pass where applicable
- no unrelated user work was changed
- documentation is updated if required
- final report is factual

---

## Completion Report Format

After a coding task, report:

### Completed

Brief statement of what was implemented.

### Files Changed

List key files.

### Database

Migration name and impact, or `None`.

### Security / RLS

State impact, or `No change`.

### Checks Run

List actual commands and results.

### Git Status

State remaining modified/untracked files.

### Notes

Only meaningful remaining issue, risk, or next decision.

Do not exaggerate completion.

---

## Final Instruction

When uncertain, use this rule:

> Read the canonical docs, protect user data and existing work, avoid scope drift, and implement the smallest secure solution that satisfies the approved Preshopps MVP.
