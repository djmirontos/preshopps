# Preshopps Architecture

## 1. Purpose

This document defines the technical architecture for the Preshopps MVP.

Preshopps is a mobile-first, multi-seller marketplace for pre-loved and brand-new items. The architecture must support anonymous browsing, seller shops, product listings, structured Philippine location filtering, messaging, carts, order requests, reviews, trust signals, moderation, disputes, notifications, SEO-friendly public pages, and admin operations while remaining intentionally simple enough for an MVP.

This architecture is constrained by the approved PRD and must not silently introduce out-of-scope features.

---

## 2. Architecture Goals

The system must be:

- Simple to develop and operate.
- Mobile-first and responsive across desktop, tablet, iPad, Android, and iPhone browsers.
- SEO-friendly for public listings and shop pages.
- Secure by default, with strict ownership and role boundaries.
- Fast for product browsing and image-heavy marketplace pages.
- Extensible enough to support future payments, international locations, richer seller verification, and native/mobile experiences without a full rewrite.
- Easy for Claude Code to work on incrementally without introducing unnecessary infrastructure.

The system must avoid premature complexity such as microservices, event buses, distributed queues, real-time presence systems, payment orchestration, AI recommendation systems, or custom search infrastructure in MVP.

---

## 3. Recommended Technology Stack

### 3.1 Web Application

- **Next.js** with App Router
- **TypeScript**
- **React**
- **Tailwind CSS**
- **shadcn/ui** or equivalent minimal component primitives where useful

Why:

- Strong SEO support for public listing and shop pages.
- Server rendering and static optimization where appropriate.
- Excellent mobile-responsive support.
- Simple deployment on Vercel.
- Good fit for Supabase-backed applications.

### 3.2 Backend Platform

- **Supabase**
  - PostgreSQL database
  - Supabase Auth
  - Supabase Storage
  - Row Level Security
  - Edge Functions only where server-side operations are needed

Why:

- Keeps infrastructure compact.
- Authentication, database, storage, and authorization are tightly integrated.
- PostgreSQL supports the marketplace relational model well.
- RLS provides strong per-user ownership protection.

### 3.3 Hosting

- **Vercel** for the Next.js application
- **Supabase Cloud** for database/auth/storage

### 3.4 Transactional Email

Use a transactional email provider through a server-side abstraction.

Recommended initial implementation:

- Resend or another simple transactional provider

Email sending must never occur directly from the browser.

### 3.5 Image Processing

Image resizing/compression should happen automatically in the client before upload.

Requirements:

- Preserve original aspect ratio.
- No destructive crop.
- Maintain visually clear output.
- Reduce file size before upload.
- Show per-image upload progress.

Browser-side resizing can use a small client library or Canvas API abstraction. The implementation should be replaceable later if server-side image processing is needed.

---

## 4. High-Level System Diagram

```text
Browser / Mobile Browser
        |
        v
Next.js Web App
        |
        +-----------------------------+
        |                             |
        v                             v
Supabase Auth                   Next.js Server / API Layer
        |                             |
        v                             +------------------+
Supabase PostgreSQL                                |
        |                                          v
        +-----------------------> Supabase Storage
        |
        +-----------------------> Transactional Email Provider
```

The application should remain a modular monolith.

Do not split into microservices for MVP.

---

## 5. Application Layering

Recommended logical layers:

```text
app/
  public marketplace routes
  auth routes
  buyer account routes
  seller dashboard routes
  admin routes

components/
  reusable UI components

features/
  auth
  marketplace
  listings
  shops
  cart
  orders
  messaging
  reviews
  notifications
  moderation
  disputes
  admin
  locations

lib/
  supabase clients
  auth helpers
  validation
  permissions
  image processing
  email
  seo
  formatting

types/
  shared TypeScript domain types
```

Business logic should live in feature modules or server-side domain helpers rather than inside large React components.

---

## 6. Rendering Strategy

### Public pages

Use server rendering or server components where appropriate for:

- Homepage
- Marketplace search result pages
- Public listing pages
- Public shop pages
- Public review views
- Category/location landing pages if added later

Goals:

- Good SEO.
- Fast initial render.
- Shareable social previews.

### Authenticated application areas

Use authenticated server components and client components where interaction requires it:

- Cart
- Messages
- Notifications
- Buyer account
- Seller dashboard
- Admin dashboard

### Client-only state

Client-local state is appropriate for:

- Guest cart
- Guest recently viewed items
- Temporary form state
- Upload progress
- UI filters before URL synchronization

---

## 7. Authentication Architecture

### MVP authentication

- Email + password only.
- Email verification required.
- Password reset via email.
- No SMS OTP.
- No Google/Facebook login in MVP.

### Guest access

Guests can:

- Browse listings.
- Search/filter.
- View shops/reviews.
- View listing details.
- Share listings.
- Add items to a local guest cart.
- Maintain locally stored recently viewed items.

Guests cannot:

- Favorite.
- Message sellers.
- Submit order requests.
- Leave reviews.
- Start selling.
- Submit support requests.

### Authenticated account model

Every registered user has one account identity.

A user may act as:

- Buyer only.
- Buyer + seller.
- Admin.
- Super Admin.

There is no separate seller authentication system.

---

## 8. Authorization Model

Authorization must be enforced at both application and database levels.

### User ownership rules

Users may only modify:

- Their own profile.
- Their own cart.
- Their own favorites.
- Their own messages/conversation participation.
- Their own order-side actions.
- Their own reviews within allowed rules.

### Seller ownership rules

A seller may only modify:

- Their own shop.
- Their own listings.
- Their own listing images.
- Their own seller-side order actions.
- Their own seller review replies.

### Admin boundaries

Admins may moderate platform content but should not impersonate normal sellers or silently rewrite seller content.

Super Admin alone can manage admin role assignments and critical platform-level configuration.

### Database enforcement

Use Supabase Row Level Security for user-owned and seller-owned tables.

Privileged moderation actions should use secure server-side operations and never rely on client-provided role claims alone.

---

## 9. Core Domain Model

Core entities:

```text
users/profile
  |
  +--- 0..1 shop
  |
  +--- favorites
  |
  +--- cart
  |
  +--- conversations
  |
  +--- orders as buyer
  |
  +--- reviews as buyer

shop
  |
  +--- listings
  +--- reviews
  +--- seller-side orders

listing
  |
  +--- listing_images
  +--- cart_items
  +--- order_items
  +--- listing-specific conversations
  +--- reports
```

Additional domains:

- locations
- notifications
- disputes
- moderation reports
- admin audit logs
- shop slug history
- support tickets

---

## 10. Recommended Database Model

Exact migrations belong in the database schema document later, but architecture should assume these core tables.

### Identity and profile

- `profiles`
- `user_roles`
- `user_restrictions`

### Shops

- `shops`
- `shop_slug_history`

### Listings

- `listings`
- `listing_images`
- `listing_vehicle_details`
- `listing_rental_details`

### Locations

- `countries`
- `provinces`
- `cities_municipalities`
- `barangays`

The MVP UI exposes Philippines-only structured location selection while the schema remains future-ready for more countries.

### Marketplace activity

- `favorites`
- `recently_viewed` for signed-in users
- `listing_metrics`

### Cart

- `carts`
- `cart_items`

Guest carts remain client-local until authentication.

### Orders

- `orders`
- `order_items`
- `order_status_history`
- `order_cancellation_requests`

### Messaging

- `conversations`
- `conversation_participants`
- `messages`

Messages are immutable after creation.

### Reviews

- `reviews`
- `review_images`
- `review_replies`

### Notifications

- `notifications`
- optional `notification_preferences` later if needed

### Moderation

- `reports`
- `moderation_actions`
- `admin_audit_logs`

### Disputes

- `disputes`
- `dispute_images`
- `dispute_status_history`
- `dispute_admin_notes`

### Support

- `support_tickets`

---

## 11. Listing Architecture

### Listing ownership

Every listing belongs to exactly one shop.

### Listing status model

Primary states:

- `draft`
- `available`
- `reserved`
- `paused`
- `sold`
- `archived`

Public discovery behavior:

- `available`: visible in marketplace/search.
- `reserved`: hidden from global discovery but visible on shop/direct URL.
- `paused`: hidden publicly.
- `sold`: hidden from normal discovery; direct URL remains accessible.
- `archived`: hidden from normal discovery; direct URL remains accessible with unavailable state.
- `draft`: seller/admin only.

### Listing type

Required:

- `preloved`
- `brand_new`

Condition rules:

- Brand New listing => condition automatically `brand_new`.
- Pre-loved => seller selects `like_new`, `very_good`, `good`, `fair`.
- `fair` requires known-flaws text.

### Category behavior

Categories are admin-managed.

Special transaction categories:

- Cars => inquiry only.
- Motorcycles => inquiry only.
- For Rent => inquiry only.
- Other standard sale categories => cart/order-request capable.

### Quantity

- One-off pre-loved listings commonly quantity `1`.
- Brand-new listings may have stock greater than `1`.
- Availability must be revalidated before order submission and seller acceptance.

### Negotiable

Boolean listing flag.

Price negotiation remains in messaging.

### Free listings

Price `0` is valid and displayed as `Free`.

Free listings still use normal order/request flow when category allows ordering.

---

## 12. Image Architecture

### Listing images

- 1 to 8 images.
- First/selected image is cover image.
- Seller can reorder images.
- Seller can change cover image.
- Images are automatically resized/compressed before upload.
- Full photo aspect ratio preserved.
- No forced crop.
- Upload progress displayed per image.

### Actual-item rule

Every listing must contain at least one actual-item photo.

Pre-loved:

- Actual item photos only.

Brand New:

- Actual item photo required.
- Catalog/reference images optionally allowed.
- Reference/catalog images clearly labeled.

### Storage layout

Recommended path pattern:

```text
listing-images/{shop_id}/{listing_id}/{image_id}.webp
review-images/{review_id}/{image_id}.webp
dispute-images/{dispute_id}/{image_id}.webp
shop-images/{shop_id}/profile.webp
profile-images/{user_id}/profile.webp
```

Use private buckets where content should not be universally public, and public or signed URL access only where required.

Public listing images can be optimized for CDN delivery.

---

## 13. Marketplace Query Architecture

Preshopps is marketplace-first, not shop-first.

Homepage and search query active listings across all eligible sellers.

Default marketplace ordering:

- Newest first.

Default marketplace location:

- All locations.

Location filtering is optional.

### Search filters

- Keyword
- Category
- Listing type
- Condition
- Price range
- Province
- City/municipality
- Barangay
- Fulfillment method
- Available only where applicable

### URL state

Search/filter state must be represented in URL query parameters.

Do not silently restore old filters on a fresh visit.

### Pagination

Use cursor-based progressive loading / `Load More`.

Avoid numbered pagination for the main marketplace experience.

### Search implementation

Start with PostgreSQL-backed text filtering/search.

Do not introduce Elasticsearch/Algolia/Meilisearch in MVP unless actual scale later requires it.

---

## 14. Shop Architecture

Each account can own at most one shop.

### Shop identity

- Display name: does not need to be unique.
- Slug: unique.
- Slug auto-generated initially.
- Seller may customize if available.
- Old slugs redirect through `shop_slug_history`.

### Shop public data

Public:

- Shop name
- Shop image/logo
- Description
- Province/city/optional barangay
- Active/Away status
- Rating
- Review count
- Completed order count
- Active listing count
- Member since
- Trusted Seller badge if earned
- Optional Facebook Messenger link

Private:

- Email
- Exact address
- Internal moderation data

### Featured listing

One seller-selected featured listing may appear first on that seller’s shop page.

It does not alter global marketplace ranking.

---

## 15. Cart Architecture

### Guest cart

Stored locally in browser storage.

### Signed-in cart

Stored in database.

### Authentication merge

After guest login/signup:

- Merge guest cart into account cart.
- Revalidate listing availability, seller status, price, and quantity.
- Avoid duplicate cart rows.

### Multi-seller carts

A user may add listings from multiple sellers to one cart.

At submission:

- Group items by seller/shop.
- Create separate order request per seller.

### Invalid cart items

If listing becomes sold/reserved/paused/unavailable:

- Keep item visible in cart.
- Mark unavailable.
- Prevent submission for that item.
- Allow buyer to proceed with valid items.

---

## 16. Order Architecture

### Order creation

Normal sale categories only.

Rental, car, and motorcycle listings are inquiry-only and do not create cart orders in MVP.

### Reservation behavior

Submitting an order request does not reserve stock.

Stock is reserved only when seller accepts.

Acceptance must occur inside a database transaction or equivalent safe atomic operation so two sellers/buyers cannot over-reserve the same quantity.

### Order status model

Conceptual flow:

```text
pending
  -> accepted
  -> ready
  -> handed_over_or_shipped
  -> received_confirmed
  -> completed
```

Additional states:

- declined
- cancelled
- expired
- disputed

Partial-acceptance flow requires buyer confirmation before proceeding.

### Pending expiration

- Pending request expires after 72 hours if unanswered.
- Send one seller reminder about 24 hours before expiry.

### Accepted orders

Accepted orders do not auto-expire.

### Cancellation

Buyer:

- Pending: direct cancel.
- Accepted: cancellation request requiring seller confirmation.

Seller:

- May cancel accepted order with reason.

Cancellation history is recorded internally and may inform risk/moderation logic.

### Completion

Seller marks order handed over/shipped.

Buyer confirms receipt.

Only after buyer confirmation does order become completed.

Review becomes available after completion.

### Order snapshots

Each `order_item` must preserve a snapshot of relevant listing information at order time:

- Listing ID
- Title
- Price
- Quantity
- Cover image reference
- Condition/type
- Seller/shop context

This prevents later listing edits from changing order history.

---

## 17. Messaging Architecture

Messaging is deliberately lightweight.

### Conversation types

- Listing-specific inquiry
- General shop inquiry

If the same buyer contacts a seller about different listings, each listing gets a separate listing-specific conversation.

### MVP capabilities

- Text messages only.
- Immutable messages.
- No edit/delete/unsend.
- No image attachments.
- No typing indicators.
- No read receipts.
- Unread count only.
- Archive.
- Mute.
- Mark unread.
- Inbox filters: All / Unread / Archived.
- Inbox search by participant/shop/listing context.

### Link handling

Messages may contain plain-text external links.

UI should warn users that external sites are not verified by Preshopps.

### Blocking

Blocked users:

- Cannot start new conversations.
- Cannot submit new order requests to blocker.
- Cannot leave new reviews involving blocker.
- Existing historical records remain intact.

Public marketplace content remains visible.

### Real-time behavior

Supabase Realtime may be used for new-message and notification refresh if convenient.

However, MVP must not depend on complex live-presence infrastructure.

Polling/revalidation fallback should remain possible.

---

## 18. Reviews Architecture

Reviews are seller-focused, not reusable product-score reviews.

### Eligibility

- Only completed order buyers may review.
- One review per completed order.

### Review content

- 1–5 stars.
- Short text.
- Up to 2 images.
- Purchased item may be displayed as context.

### Editing

- Buyer can edit within 7 days.
- Seller review reply can be edited within 7 days.
- Buyer cannot directly delete review.
- Seller cannot hide review.
- Admin moderation controls removal.

### Seller response

One public seller response per review.

### Rating computation

- All verified reviews count equally in MVP.
- Display one decimal place + review count.
- No `0.0`; use `No reviews yet` / `New seller`.

### Trusted Seller

Initial criteria:

- Verified email.
- 5+ completed orders.
- 3+ verified reviews.
- Average rating >= 4.0.
- No active serious moderation issues.

Badge is recalculated and not permanent.

---

## 19. Notifications Architecture

### In-app notifications

Core events:

- New message.
- New order request.
- Order accepted.
- Order declined.
- Order cancelled.
- Partial order changed.
- Order ready.
- Order shipped/handed over.
- Receipt confirmation needed.
- Order completed.
- New review.
- Moderation action.
- Dispute update.

### Email notifications

Immediate email for important transactional events:

- New order request.
- Accept/decline/cancel.
- Major order-status transitions.
- Dispute/moderation events.
- Password/account/security events.

Messages:

- In-app immediately.
- Delayed or grouped email if unread.

### Delivery architecture

Use server-side notification orchestration.

Recommended flow:

```text
Domain action
  -> database mutation succeeds
  -> create in-app notification
  -> enqueue/send transactional email server-side
```

For MVP, this can be handled synchronously or via a simple background/server function where practical.

Do not introduce a complex queue system unless needed.

---

## 20. Dispute Architecture

Eligible order participants may open a dispute on relevant active orders.

### Dispute data

- Reason.
- Explanation.
- Up to 3 images.

### Status

- Opened
- Under Review
- Resolved

### Admin capabilities

Admin can:

- Review order history.
- Review relevant conversation context.
- Review dispute evidence.
- Add private admin notes.
- Cancel order.
- Mark resolved.
- Mark completed when justified.

No escrow, refunds, or payment arbitration exists in MVP because Preshopps does not process payments.

Resolved dispute history remains available to buyer, seller, and admin but is not public.

---

## 21. Moderation Architecture

### Reportable targets

- Listing
- Seller/shop
- Review
- Message/conversation

### Report reasons

Include at minimum:

- Scam/Fraud
- Prohibited Item
- Misleading
- Harassment
- Spam
- Duplicate/Spam
- Other

### Admin actions

- Hide/remove listing.
- Suspend seller privileges.
- Restrict buyer privileges.
- Fully suspend account.
- Remove review.
- Remove individual review image.
- Resolve dispute.

### Suspended accounts

Suspended seller:

- Public shop/listings hidden.
- Can still sign in with restricted access.
- Can see suspension reason.
- Can access history/disputes/support.
- Can submit appeal.

### Appeals

Simple suspension appeal form to admin.

### Audit log

Important admin actions must create immutable audit entries recording:

- Admin actor.
- Target entity.
- Action.
- Reason.
- Timestamp.
- Relevant metadata.

---

## 22. Location Architecture

MVP UI is Philippines-only.

Database is future-ready for international expansion.

### Structured hierarchy

```text
Country
  -> Province
    -> City / Municipality
      -> Barangay
```

No seller free-text location for filtering.

Listing location defaults from shop location but can be changed per listing.

Exact private address is never public.

Optional meetup note may be free text but should be short and non-sensitive.

### Future extension

Database should support `country_code` from Day 1.

GPS/near-me functionality is explicitly out of MVP.

---

## 23. Vehicle Listing Architecture

Cars and Motorcycles are inquiry-only.

Optional structured fields:

- Brand
- Model
- Year
- Mileage
- Transmission
- Fuel type
- Registration status
- Documents available

Do not expose plate number or VIN as public listing fields.

No vehicle checkout/order flow in MVP.

---

## 24. Rental Listing Architecture

For Rent is inquiry-only.

Structured fields:

- Rental price
- Rental period
- Optional security deposit
- Rental terms
- Optional minimum rental period
- Optional capacity
- Optional what’s included
- Optional rules/restrictions
- Location
- Simple availability state

No booking calendar, automated rental scheduling, escrow, or payment handling in MVP.

---

## 25. Recently Viewed Architecture

### Guest

Stored locally in browser.

### Signed-in user

May be persisted to account for cross-session usage.

Keep list bounded and exclude hidden/deleted content from display.

Do not overbuild recommendation logic around recently viewed data.

---

## 26. Seller Metrics Architecture

Track internal/private listing metrics:

- Views
- Favorites
- Inquiries
- Order requests

These are visible to the seller in lightweight form.

No public view counts.

No advanced seller analytics/charts in MVP.

---

## 27. SEO Architecture

Public listing and shop pages must be SEO-friendly.

### Requirements

- Server-rendered metadata.
- Unique title and description.
- Canonical URLs.
- Clean shop/listing slugs.
- Open Graph metadata for social sharing.
- Product image in social previews.
- Indexable public active listing/shop pages.

### Sold/archived listings

Direct URLs remain accessible with clear unavailable state and related active items.

### Paused listings

Not publicly accessible as active content.

### Slug redirects

Shop slug history should issue permanent or appropriate redirects to current shop URL.

---

## 28. Social Sharing Architecture

Every listing must support:

- Share action.
- Copy link.
- Native Web Share API where supported.
- Graceful fallback when unsupported.

Shared page previews should contain:

- Product image.
- Title.
- Price.
- Condition/type.
- Location.
- Direct Preshopps URL.

No Facebook Group auto-post automation in MVP.

---

## 29. Responsive UI Architecture

The same web application serves all form factors.

### Mobile navigation

Bottom navigation:

- Home
- Search
- Sell
- Messages
- Account

Header:

- Preshopps logo
- Notifications
- Cart

### Desktop/tablet

Navigation may move to a clean top/header layout while preserving feature parity.

### Design rules

- Light mode only.
- Clean Apple-inspired spacing.
- Minimal visual clutter.
- High-quality product photography.
- Strong touch targets.
- Responsive layouts from small phones to desktops.
- Avoid desktop-only hover dependencies.

---

## 30. Validation Strategy

Use shared validation schemas for client/server consistency.

Recommended:

- Zod or equivalent TypeScript schema validation.

Validate:

- Listing fields.
- Shop creation.
- Slugs.
- Cart quantities.
- Order transitions.
- Review eligibility.
- Message length.
- Image count/type/size.
- Rental/vehicle conditional fields.

Never trust client-side validation alone.

---

## 31. Security Architecture

### Core rules

- Enforce RLS.
- Never expose service-role credentials to browser.
- Server-only privileged operations.
- Validate ownership on every mutation.
- Sanitize and safely render user-generated text.
- Rate-limit abuse-prone endpoints/actions.
- Validate image MIME type and allowed file size.
- Restrict upload paths by authenticated ownership.
- Protect admin routes both at app layer and backend layer.

### Sensitive data

Do not expose:

- User email publicly.
- Exact address publicly.
- Internal moderation notes.
- Admin-only risk metadata.

### Links

Product descriptions should not render external clickable links.

Private message links may be displayed with safety warning.

---

## 32. Performance Architecture

### Marketplace feed

- Cursor-based pagination.
- Query only required card fields.
- Add appropriate database indexes for status, category, location, created_at, shop_id.
- Avoid N+1 queries.

### Images

- Compress before upload.
- Store optimized formats where practical.
- Serve through CDN.
- Use responsive image sizing.
- Lazy-load below-the-fold content.

### Database

Index common filters and joins.

Do not prematurely cache complex dynamic data outside Postgres unless real usage proves it necessary.

---

## 33. Error Handling

The UI must handle:

- Failed uploads.
- Network interruptions.
- Stale cart items.
- Listing removed while viewing.
- Seller suspended mid-flow.
- Order stock conflicts.
- Message send failure.
- Email delivery failure without rolling back core database transaction.

Core principle:

Marketplace state must remain correct even if a secondary side effect such as email sending fails.

---

## 34. Observability

MVP should include lightweight operational visibility:

- Application error logging.
- Server/API errors.
- Auth failures.
- Failed email attempts.
- Failed uploads.
- Admin audit logs.

Advanced APM and distributed tracing are not required at launch.

---

## 35. Environment Management

Use separate environments:

- Local development
- Preview/staging
- Production

Never share production secrets in source control.

Expected environment variables include:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY   # server only
EMAIL_PROVIDER_API_KEY      # server only
NEXT_PUBLIC_APP_URL
```

Additional keys should be documented as they are introduced.

---

## 36. Deployment Strategy

### Development

Local Next.js application connected to a development Supabase project where practical.

### Preview

Vercel preview deployments for feature branches/pull requests.

### Production

Main branch deploys production app after review.

Database migrations must be version-controlled and applied deliberately.

Do not allow Claude Code to make destructive production database changes automatically.

---

## 37. Testing Strategy

MVP should prioritize tests around business-critical rules rather than chasing maximum coverage.

### Unit tests

- Price formatting.
- Listing status rules.
- Trusted Seller calculation.
- Order transition validation.
- Cart grouping by seller.
- Rental/vehicle transaction-mode logic.

### Integration tests

- Auth + profile creation.
- Shop creation.
- Listing creation.
- Image ownership.
- Order request lifecycle.
- Stock reservation conflict.
- Review eligibility.
- Moderation permissions.

### End-to-end tests

Critical flows:

1. Guest browse -> signup -> preserved cart -> order request.
2. Seller signup -> shop -> listing -> buyer inquiry.
3. Multi-seller cart -> split orders.
4. Seller accepts -> reserve stock -> ready -> shipped/handed over -> buyer confirms -> review.
5. Seller suspension hides listings.
6. Dispute flow.

---

## 38. Explicit MVP Non-Goals

Do not architect or implement these unless the PRD is formally changed:

- Payment gateway.
- GCash API integration.
- QR payment workflow.
- Escrow.
- Refund engine.
- Shipping courier API integrations.
- Real-time courier tracking.
- GPS-based Near Me.
- Dark mode.
- Video uploads.
- Voice messages.
- Message image attachments.
- Typing indicators.
- Read receipts.
- Internal calling.
- Product variants.
- SKU system.
- Complex warehouse inventory.
- Scheduled listing publishing.
- Shop followers.
- Shared carts.
- Paid seller plans.
- Listing fees.
- Marketplace commission.
- Sponsored/featured global ranking.
- AI recommendations.
- AI moderation as a dependency.
- Dedicated search cluster.
- Microservices.
- Native mobile app.
- International currencies.
- Multi-language UI.

---

## 39. Future-Safe Extension Points

The architecture should leave room for later additions without implementing them now:

### Payments

`orders` and `order_items` should support future payment records without embedding payment state directly into listing records.

Future tables may include:

- `payments`
- `payment_attempts`
- `payouts`

### International expansion

Location schema includes country support even though MVP is Philippines-only.

### Stronger seller verification

Future separate verification domain can support:

- Phone verification.
- Identity verification.
- Verified seller badges.

### Better search

Marketplace queries can later be moved to dedicated search infrastructure if Postgres is no longer sufficient.

### Native mobile

Core business rules should remain server/database-centric enough that a future mobile client can reuse them.

---

## 40. Architectural Decision Summary

Preshopps MVP will use a **modular monolith** architecture:

- Next.js responsive web frontend and server layer.
- Supabase Auth.
- PostgreSQL as the single source of truth.
- Supabase Storage for marketplace media.
- RLS for ownership and access control.
- Transactional email through a server-side provider.
- Server-rendered public marketplace pages for SEO.
- Client-side automatic image compression before upload.
- Structured order state machine with seller acceptance and buyer receipt confirmation.
- Lightweight built-in messaging.
- Admin moderation and audit trail.

The architecture intentionally optimizes for **clarity, security, maintainability, and fast MVP iteration**, not maximum technical sophistication.

---

## 41. Source of Truth Rule

If implementation decisions conflict with the approved Preshopps PRD, the PRD wins unless the PRD is explicitly amended.

Claude Code and future contributors must not expand product scope simply because a feature would be technically easy to add.

Architecture changes that materially affect scope, privacy, security, user flows, payments, moderation, or data ownership require explicit product approval before implementation.
