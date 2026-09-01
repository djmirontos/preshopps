# Preshopps Architecture Essentials

## 1. Purpose

This file is the compact implementation reference for the Preshopps MVP.

Use it as the fast architectural checklist during development. It does **not** replace `PRD.md` or `ARCHITECTURE.md`.

Source-of-truth order:

1. `PRD.md`
2. `ARCHITECTURE.md`
3. `ARCHITECTURE_ESSENTIALS.md`

If this file conflicts with the PRD, the PRD wins. If it conflicts with the full architecture while the PRD is silent, the full architecture wins.

Do not expand MVP scope without explicit product approval.

---

## 2. Core Architecture

Preshopps is a **modular monolith**.

Use:

- Next.js App Router
- TypeScript
- React
- Tailwind CSS
- shadcn/ui or similarly minimal UI primitives where useful
- Supabase Auth
- Supabase PostgreSQL
- Supabase Storage
- Supabase Row Level Security
- Vercel
- Server-side transactional email abstraction, initially Resend or equivalent

Do **not** introduce microservices, event buses, dedicated search infrastructure, complex job queues, or unnecessary infrastructure in MVP.

---

## 3. Product Shape

Preshopps is a mobile-first multi-seller marketplace.

Core relationship:

```text
User
  -> optional single Shop
      -> Listings
```

Public discovery is:

```text
Marketplace -> Listing -> Shop
```

not shop-first browsing.

Guests immediately see active marketplace listings without signing in.

---

## 4. Route / Application Areas

Keep logical areas separated:

```text
app/
  public marketplace
  auth
  buyer account
  seller dashboard
  admin

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
  locations
  admin

lib/
  supabase
  auth
  validation
  permissions
  image-processing
  email
  seo
  formatting
```

Do not put core business logic inside large React components.

---

## 5. Authentication

MVP auth:

- Email + password
- Email verification required
- Password reset by email
- No SMS OTP
- No Google/Facebook auth

Guests may:

- Browse
- Search/filter
- View listing details
- View shops/reviews
- Share
- Add to local guest cart
- Keep local recently viewed history

Guests may not:

- Favorite
- Message
- Submit order requests
- Review
- Sell
- Submit support tickets

One account may be:

- Buyer
- Buyer + Seller
- Admin
- Super Admin

No separate seller login system.

---

## 6. Authorization and Security

Security must be enforced at both app and database levels.

Required:

- RLS on user-owned and seller-owned tables
- Ownership validation on every mutation
- Service-role key server-side only
- Admin operations server-side only
- Role checks must not rely only on client state
- Sanitize user-generated text
- Validate file MIME type and size
- Restrict upload paths by owner
- Rate-limit abuse-prone actions
- Never expose exact private addresses
- Never expose account email publicly
- Never expose private admin notes or risk metadata

Messages may contain plain-text external links with a warning.

Product descriptions must not render external clickable links.

---

## 7. Core Tables

Architecture should assume at minimum:

### Identity

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

### Marketplace

- `favorites`
- `recently_viewed`
- `listing_metrics`

### Cart

- `carts`
- `cart_items`

### Orders

- `orders`
- `order_items`
- `order_status_history`
- `order_cancellation_requests`

### Messaging

- `conversations`
- `conversation_participants`
- `messages`

### Reviews

- `reviews`
- `review_images`
- `review_replies`

### Notifications

- `notifications`

### Moderation / Admin

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

Exact schema belongs in the database schema work, not this file.

---

## 8. Shop Rules

- One shop maximum per account.
- Shop display name does not need to be globally unique.
- Shop slug must be unique.
- Slug is auto-generated but seller may customize if available.
- Old slugs must redirect through slug history.
- One featured listing per shop.
- Featured listing affects only that shop page, never global marketplace ranking.

Public shop data:

- Name
- Logo/photo
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
- Moderation/risk metadata

---

## 9. Listing Rules

Every listing belongs to exactly one shop.

Statuses:

```text
draft
available
reserved
paused
sold
archived
```

Visibility:

- `available`: global marketplace + shop + direct URL
- `reserved`: shop + direct URL, hidden from global search/feed
- `paused`: non-public
- `sold`: direct URL remains accessible, hidden from normal discovery
- `archived`: direct URL remains accessible as unavailable, hidden from normal discovery
- `draft`: seller/admin only

Listing type:

- `preloved`
- `brand_new`

Condition rules:

- Brand New -> condition automatically `brand_new`
- Pre-loved -> `like_new`, `very_good`, `good`, `fair`
- `fair` requires known-flaws text

Free listings:

- Price `0` is valid
- Display as `Free`

Negotiable:

- Boolean flag
- Negotiation happens in messaging only

No formal product variants or SKU system in MVP.

---

## 10. Category Transaction Rules

Inquiry-only categories:

- Cars
- Motorcycles
- For Rent

These support:

- Message Seller
- Favorite
- Share

They do **not** use cart/order requests.

Normal sale categories use:

- Add to Cart
- Order Request
- Message Seller
- Favorite
- Share

Cars and motorcycles may have optional structured fields:

- Brand
- Model
- Year
- Mileage
- Transmission
- Fuel type
- Registration status
- Documents available

Do not expose VIN or plate number as public fields.

Rental optional fields:

- Rental price
- Rental period
- Security deposit
- Rental terms
- Minimum rental period
- Capacity
- What’s included
- Rules/restrictions
- Location
- Simple availability

No booking calendar in MVP.

---

## 11. Images

Listing images:

- 1 to 8
- Preserve full original aspect ratio
- No forced crop
- Automatically resize/compress before upload
- Keep output visually clear
- Per-image upload progress
- Seller can reorder
- Seller can change cover
- Seller can remove images if at least one valid actual-item image remains

Actual-item rule:

- Every listing requires at least one real photo of the actual item
- Pre-loved: actual-item photos only
- Brand New: may also include catalog/reference images
- Reference images must be clearly labeled

Recommended storage paths:

```text
listing-images/{shop_id}/{listing_id}/{image_id}.webp
review-images/{review_id}/{image_id}.webp
dispute-images/{dispute_id}/{image_id}.webp
shop-images/{shop_id}/profile.webp
profile-images/{user_id}/profile.webp
```

Do not upload original oversized images if the optimized client output is sufficient.

---

## 12. Marketplace Feed

Default:

- All eligible Philippines listings
- No Tangub-only default
- No GPS requirement
- Newest first

Filters:

- Keyword
- Category
- Listing type
- Condition
- Price range
- Province
- City/Municipality
- Barangay
- Fulfillment method
- Available only

Search/filter state must live in URL query parameters.

Do not silently restore old filters on fresh visits.

Use cursor-based progressive loading / `Load More`.

Do not use numbered pagination as the primary marketplace UX.

Start with PostgreSQL search/filtering.

---

## 13. Location

MVP UI:

```text
Philippines
  -> Province
    -> City / Municipality
      -> Barangay
```

Country is Philippines-only in MVP UI.

Database must include country support from Day 1 for future expansion.

Listing location defaults to shop location but may be changed per listing.

Exact private/home address must never be public.

GPS/Near Me is out of MVP.

---

## 14. Cart

Guest cart:

- Browser-local
- Persists after browser close

Signed-in cart:

- Stored in database
- Persists across sessions

On login/signup:

- Merge guest cart into account cart
- Revalidate price
- Revalidate availability
- Revalidate quantity
- Revalidate seller status
- Prevent duplicate cart rows

Multi-seller cart:

- Buyer may mix sellers in one cart
- Submission groups items by seller
- Create separate order request per seller

If a cart item becomes unavailable:

- Keep visible
- Mark unavailable
- Disable submission for that item
- Let buyer continue with valid items

---

## 15. Orders

Order requests apply only to normal sale categories.

Stock reservation rule:

- Submitting request does not reserve stock
- Seller acceptance reserves stock
- Acceptance must be atomic/transaction-safe
- Never oversell

Conceptual status flow:

```text
pending
  -> accepted
  -> ready
  -> handed_over_or_shipped
  -> received_confirmed
  -> completed
```

Other states:

- declined
- cancelled
- expired
- disputed

Pending:

- Expires after 72 hours if unanswered
- Seller reminder about 24 hours before expiry

Accepted:

- Does not auto-expire

Cancellation:

- Buyer may directly cancel while pending
- After acceptance, buyer submits cancellation request
- Seller may cancel accepted order with a reason

Partial acceptance:

- Allowed
- Buyer must confirm changed accepted items before continuing

Completion:

- Seller marks handed over/shipped
- Buyer confirms receipt
- Only then -> completed
- Review unlocks after completion

Order items must preserve snapshots of:

- Listing ID
- Title
- Price
- Quantity
- Cover image reference
- Condition/type
- Seller/shop context

Later listing edits must never rewrite order history.

---

## 16. Messaging

Conversation types:

- Listing-specific
- General shop

Separate listing-specific thread per listing.

MVP messaging:

- Text only
- Immutable
- No edit
- No delete
- No unsend
- No image attachments
- No voice
- No calls
- No typing indicator
- No read receipts
- Unread state only

Inbox:

- All
- Unread
- Archived
- Search
- Archive
- Mute
- Mark as Unread

Blocking:

- Blocked users cannot start new conversations
- Cannot submit new order requests to blocker
- Cannot leave new reviews involving blocker
- Existing history remains preserved
- Public listings remain visible

Supabase Realtime may refresh new messages/notifications, but do not build live presence infrastructure.

---

## 17. Reviews and Trust

Reviews:

- Seller-focused
- Completed-order buyers only
- One review per completed order
- 1–5 stars
- Short text
- Up to 2 images
- Purchased item may be shown as context

Editing:

- Buyer review editable for 7 days
- Seller gets one public reply
- Seller reply editable for 7 days
- Buyer cannot directly delete review
- Seller cannot hide review
- Admin controls moderation/removal

Rating:

- All verified reviews count equally
- Display one decimal place + review count
- No `0.0`; show `New seller` / `No reviews yet`

Trusted Seller criteria:

- Verified email
- At least 5 completed orders
- At least 3 verified reviews
- Average rating >= 4.0
- No active serious moderation issue

Badge must be recalculated and is not permanent.

---

## 18. Notifications and Email

In-app notifications for:

- New message
- New order request
- Accepted/declined/cancelled
- Partial acceptance
- Ready
- Handed over/shipped
- Receipt confirmation required
- Completed
- New review
- Moderation action
- Dispute update

Email immediately for important transactional/account events.

Chat:

- In-app immediately
- Delayed or grouped email if unread
- Never email every individual chat message

Order/database state must not roll back merely because email delivery fails.

---

## 19. Disputes

Eligible order participants may open disputes.

Dispute supports:

- Reason
- Explanation
- Up to 3 images

Status:

```text
opened
under_review
resolved
```

Admin may:

- Review order
- Review relevant messages
- Review evidence
- Add private notes
- Cancel order
- Resolve dispute
- Mark completed when justified

No refunds, escrow, or payment arbitration in MVP because Preshopps does not process payments.

Dispute history remains private to buyer, seller, and admin.

---

## 20. Moderation

Users may report:

- Listing
- Shop/seller
- Review
- Message/conversation

Reasons include:

- Scam/Fraud
- Prohibited Item
- Misleading
- Harassment
- Spam
- Duplicate/Spam
- Other

Admin may:

- Hide/remove listing
- Suspend seller privileges
- Restrict buyer privileges
- Fully suspend account
- Remove review
- Remove individual review image
- Resolve disputes

Suspended sellers:

- Public shop/listings hidden
- May still sign in with restricted access
- Can see suspension reason
- Can access history/disputes/support
- Can submit appeal

Important admin actions require immutable audit logs.

Admin notes remain private.

---

## 21. Roles

MVP admin roles:

### Admin

Can manage:

- Users
- Shops
- Listings
- Categories
- Reports
- Reviews
- Orders
- Disputes
- Support
- Moderation

### Super Admin

Everything Admin can do, plus:

- Manage admin role assignments
- Critical platform configuration

Admin route protection must exist at both application and backend levels.

---

## 22. SEO and Public URLs

Public shop example:

```text
/shop/annes-closet
```

Public listing example:

```text
/item/nike-air-max-270-abc123
```

Public active listings and shops should be SEO-friendly.

Include:

- Server-rendered metadata
- Canonical URLs
- Unique title
- Meta description
- Open Graph
- Product image
- Structured data where useful

Sold/archived URLs remain alive with unavailable status and related active items.

Paused listings are non-public.

Old shop slugs redirect to current slug.

---

## 23. Social Sharing

Every public listing:

- Share
- Copy Link
- Native Web Share API where available
- Fallback where unavailable

Social preview should include:

- Product image
- Title
- Price
- Condition/type
- Location
- Direct Preshopps URL

No Facebook Group auto-post automation.

Preshopps remains the canonical listing destination.

---

## 24. UI / Responsive Rules

One responsive web app.

Mobile bottom navigation:

- Home
- Search
- Sell
- Messages
- Account

Mobile header:

- Preshopps logo
- Notifications
- Cart

Desktop/tablet may move navigation into a clean top header.

Design:

- Light mode only
- Apple-inspired simplicity
- White/light-neutral surfaces
- Near-black text
- Large whitespace
- Minimal shadows
- Restrained rounding
- Strong touch targets
- Product photography prioritized
- One accent color
- Minimal animation
- No desktop-only hover dependency

Avoid:

- Flash-sale clutter
- Countdown timers
- Excessive badges
- Loud gradients
- Shopee/Lazada-style overload

---

## 25. Validation

Use shared TypeScript validation schemas, preferably Zod or equivalent.

Validate at minimum:

- Shop creation
- Slugs
- Listing fields
- Conditional vehicle/rental fields
- Image count/type/size
- Cart quantities
- Order transitions
- Review eligibility
- Message length

Never trust client-side validation alone.

---

## 26. Performance

Marketplace:

- Cursor pagination
- Query only fields required for cards
- Avoid N+1 queries
- Index common filters and joins

Likely indexes include combinations around:

- listing status
- category
- province/city/barangay
- created_at
- shop_id

Images:

- Compress before upload
- CDN delivery
- Responsive image sizes
- Lazy load below fold

Do not add external caching/search systems until real usage proves they are necessary.

---

## 27. Error Handling

Explicitly handle:

- Failed uploads
- Network interruption
- Stale cart items
- Listing removed mid-view
- Seller suspended mid-flow
- Stock conflict at acceptance
- Message send failure
- Email failure

Core marketplace/database state is authoritative.

Secondary side effects must not corrupt core state.

---

## 28. Environments and Deployment

Environments:

- Local
- Preview/staging
- Production

Core environment variables:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
EMAIL_PROVIDER_API_KEY
NEXT_PUBLIC_APP_URL
```

Rules:

- Never commit secrets
- Service-role key is server-only
- Version-control all migrations
- Apply DB migrations deliberately
- Claude Code must never make destructive production DB changes automatically

Hosting:

- Vercel
- Supabase Cloud

---

## 29. Testing Priorities

Prioritize business-critical rules.

Unit:

- Price formatting
- Listing status transitions
- Trusted Seller calculation
- Order transition rules
- Multi-seller cart grouping
- Inquiry-only category rules

Integration:

- Auth/profile
- Shop creation
- Listing creation
- Image ownership
- Order lifecycle
- Acceptance-time stock conflict
- Review eligibility
- Moderation permissions

Critical E2E:

1. Guest browse -> signup -> preserved cart -> order request
2. Seller signup -> shop -> listing -> buyer inquiry
3. Multi-seller cart -> split orders
4. Accept -> reserve -> ready -> handed over/shipped -> buyer confirms -> review
5. Seller suspension -> public content hidden
6. Dispute lifecycle

---

## 30. Explicit MVP Non-Goals

Do **not** implement unless the PRD is formally changed:

- Payment gateway
- GCash API
- QR payment workflow
- Escrow
- Refund engine
- Courier APIs
- Live courier tracking
- GPS Near Me
- Dark mode
- Video uploads
- Voice messages
- Message image attachments
- Typing indicators
- Read receipts
- Calling
- Product variants
- SKU system
- Complex warehouse inventory
- Scheduled listing publishing
- Shop followers
- Shared carts
- Seller subscription plans
- Listing fees
- Marketplace commission
- Sponsored global ranking
- AI recommendations
- AI moderation dependency
- Dedicated search cluster
- Microservices
- Native mobile app
- International currencies
- Multi-language UI

---

## 31. Future-Safe, Not Future-Built

Architecture should leave clean extension points for:

- Payments
- GCash / QR flows
- International locations
- Stronger seller identity verification
- Better search infrastructure
- Native mobile client

Do not implement these now.

---

## 32. Claude Code Guardrails

Before implementing any feature:

1. Check `PRD.md`.
2. Check `ARCHITECTURE.md`.
3. Use this file as the fast implementation checklist.
4. Prefer the simplest implementation consistent with the approved product.
5. Do not invent features.
6. Do not silently change user flows.
7. Do not weaken privacy or RLS.
8. Do not bypass ownership rules.
9. Do not introduce new infrastructure without architectural need.
10. Do not make destructive production changes.
11. Escalate material scope, security, privacy, cost, or architecture decisions before implementation.

---

## 33. Final Architecture Rule

Preshopps should remain:

> A secure, responsive, SEO-friendly modular marketplace built with the fewest moving parts necessary to support the approved MVP well.

Clarity, correctness, privacy, maintainability, and fast iteration are more important than technical novelty.
