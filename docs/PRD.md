# Preshopps Product Requirements Document (PRD)

## 1. Document Status

- **Product:** Preshopps
- **Document:** Product Requirements Document (PRD)
- **Status:** Canonical MVP Product Specification
- **Version:** 1.0
- **Date:** 2026-09-01
- **Primary Market:** Philippines
- **Initial Launch Focus:** Tangub City and nearby communities, while remaining browseable across all supported Philippine locations
- **Currency:** Philippine Peso (PHP / ₱)
- **Language:** English only for MVP

This document is the primary source of truth for Preshopps MVP product behavior. Implementation must follow this specification unless a later documented decision explicitly changes it.

---

## 2. Product Vision

Preshopps is a simple, clean, mobile-first multi-seller marketplace for **pre-loved and brand-new items**.

The product begins as a marketplace dedicated to helping the founder's wife sell her own pre-loved and brand-new items, but it is intentionally designed from Day 1 so other users can create their own shops and sell as well.

Preshopps should feel substantially simpler, calmer, and less cluttered than large marketplaces. It should prioritize product discovery, trust, messaging, and easy seller onboarding over complex commerce infrastructure.

### Core product statement

> Buy and sell pre-loved and brand-new items from local sellers.

### Core product promise

A seller should be able to publish an item easily, a buyer should be able to discover it easily, and both should be able to connect and complete a transaction without unnecessary complexity.

---

## 3. Product Principles

1. **Guest-first discovery** — users should see products immediately without being forced to register.
2. **Marketplace-first, shop-second** — users browse products across all sellers first; individual shops are secondary destinations.
3. **Mobile-first** — the website must work exceptionally well on mobile phones, tablets, iPads, and desktop screens.
4. **Apple-inspired simplicity** — clean, spacious, light-theme UI with minimal clutter and strong product photography.
5. **Trust over growth hacks** — seller reputation, reviews, order history, safety reminders, and moderation matter.
6. **No unnecessary MVP complexity** — payment gateways, logistics integrations, real-time chat extras, and other advanced systems are deferred.
7. **Philippines-first, globally extensible** — MVP UI is Philippines-only, but location architecture must not block international expansion later.
8. **Zero seller fees for MVP** — growth and adoption come before monetization.

---

## 4. User Types

### 4.1 Guest

A guest does not need an account to:

- Browse listings
- Search products
- Use filters
- View product detail pages
- View seller shop pages
- View seller reviews
- Share listing links
- Use location filters
- Add items to cart
- View recently viewed items stored locally on the device/browser

A guest must sign in or create an account to:

- Favorite items
- Submit order requests
- Send messages
- Start selling
- Leave reviews
- Open disputes
- Submit support requests

### 4.2 Registered Buyer

A registered buyer can:

- Perform all guest actions
- Favorite listings
- Maintain a persistent account cart
- Submit order requests
- Send product-specific or general shop inquiries
- Receive notifications
- Confirm receipt of completed transactions
- Leave verified seller reviews
- Report listings, shops, reviews, or conversations
- Block other users
- Open disputes on eligible orders
- Submit support requests

### 4.3 Seller

A seller uses the same normal account as a buyer. There is no separate seller registration system.

A registered user activates selling by creating one shop.

A seller can:

- Maintain one shop only
- Publish and manage listings
- Receive order requests
- Accept or decline orders
- Partially accept multi-item orders
- Manage fulfillment states
- Message buyers
- View seller dashboard metrics
- Receive reviews
- Reply once to each buyer review
- Pause, archive, reserve, or mark listings sold
- Submit moderation appeals if seller privileges are suspended

### 4.4 Admin

Admin can manage:

- Users
- Sellers/shops
- Listings
- Categories
- Reports
- Reviews
- Orders
- Disputes
- Support submissions
- Moderation actions
- Basic site settings

### 4.5 Super Admin

Super Admin can perform all Admin actions plus:

- Manage admins
- Manage critical platform settings
- Perform elevated administrative actions

---

## 5. Account and Authentication Requirements

### 5.1 Authentication

MVP authentication uses:

- Email
- Password
- Email verification
- Email-based password reset

Not included in MVP:

- SMS OTP
- Phone login
- Google login
- Facebook login
- Security questions

### 5.2 User profile

Minimal account profile fields:

- Display name
- Email
- Optional profile photo
- Optional province
- Optional city/municipality
- Optional barangay
- Member since

Do not require:

- Birthday
- Gender
- Phone number
- Exact address

Display names do not need to be unique. Email is the unique account identifier.

### 5.3 Account privacy

Private by default:

- Email address
- Exact address
- Internal account details
- Phone number

No public phone-number field exists in MVP.

### 5.4 Account deletion

Users may request account deletion.

The system must preserve data necessary for:

- Completed orders
- Reviews
- Disputes
- Moderation
- Fraud prevention
- Audit/history requirements

Public profile information may be anonymized after deletion.

### 5.5 Terms acceptance

At signup, users must accept:

- Terms of Use
- Privacy Policy

Before publishing their first listing, sellers must also accept:

- Marketplace Rules
- Prohibited Items Policy

---

## 6. Seller Onboarding and Shop Model

### 6.1 Seller onboarding

A registered user taps **Start Selling** and creates a shop.

Required shop fields:

- Shop name
- Short description
- Province
- City/Municipality

Optional shop fields:

- Barangay
- Shop profile/logo image
- Facebook Messenger link

### 6.2 Shop ownership

- One shop per account in MVP
- Shop display names do **not** need to be unique
- Shop slugs **must** be unique
- Only the owner may create/edit/manage listings in that shop
- Admin may moderate or remove content but should not normally edit seller content on the seller's behalf

### 6.3 Shop slug

Example:

`preshopps.com/shop/annes-closet`

Rules:

- Auto-generated from shop name
- Seller may edit during setup if available
- Slug must be unique
- Reserved system slugs must be blocked
- Seller may change slug later with a warning
- Old slugs should redirect to the new slug so old shared links continue working

### 6.4 Public shop information

Public shop page may show:

- Shop logo/photo
- Shop name
- Province/city/optional barangay
- Short description
- Trusted Seller badge if earned
- Average rating
- Review count
- Completed order count
- Active listing count
- Member since
- Optional Facebook Messenger link
- Active listings
- Reserved listings, clearly marked
- Reviews tab

No shop banner/cover photo in MVP.

### 6.5 Shop status

Public seller status:

- Active
- Away

Administrative seller status may include:

- Active
- Suspended

Exact last-seen timestamp is private and not shown.

No response-time indicator in MVP.

---

## 7. Marketplace Discovery Model

### 7.1 Default marketplace behavior

Preshopps opens to a **global marketplace feed of all eligible active listings** within the MVP's Philippines market.

There is no default Tangub-only filter.

Users immediately see items for sale.

### 7.2 Marketplace-first architecture

Public marketplace pages aggregate listings from all eligible sellers.

Each listing still belongs to exactly one shop.

Primary navigation relationship:

`Marketplace → Product → Seller Shop`

not:

`Seller Shop → Product`

### 7.3 Homepage ordering

Default homepage product ordering:

- Newest first

Future smarter ranking may use:

- Popularity
- Location relevance
- Seller trust
- Engagement

but these are not part of MVP ranking.

### 7.4 Homepage sections

MVP homepage should include:

- Compact hero
- Marketplace explanation
- Search
- Noticeable location control
- Compact horizontal category selector
- Fresh Finds
- Pre-loved
- Brand New
- Popular Shops, only when there is enough real activity

Avoid large, wasteful hero banners.

Products should appear almost immediately.

### 7.5 Example compact hero

Headline:

**Find something worth loving again.**

Supporting copy:

**Buy and sell pre-loved and brand-new items from local sellers.**

Primary actions may include:

- Browse Items
- Start Selling

---

## 8. Categories

MVP categories:

- Women
- Men
- Kids & Baby
- Shoes
- Bags & Accessories
- Electronics
- Home & Living
- Beauty & Personal Care
- Sports & Hobbies
- Cars
- Motorcycles
- For Rent
- Other

Categories are admin-managed only.

Sellers cannot create arbitrary categories.

Sellers may use **Suggest a Category** to request a new category for admin review.

---

## 9. Listing Types and Condition

### 9.1 Listing type

Every listing must have a required listing type:

- Pre-loved
- Brand New

Listing type is separate from category.

### 9.2 Condition logic

If listing type = **Brand New**:

- Condition is automatically Brand New

If listing type = **Pre-loved**:

Seller chooses:

- Like New
- Very Good
- Good
- Fair

### 9.3 Known flaws

Pre-loved listings include a prominent field:

**Known flaws / signs of use**

This field is:

- Optional for Like New / Very Good / Good
- Required for Fair

---

## 10. Standard Listing Requirements

### 10.1 Core listing fields

MVP standard listing fields:

- Product title
- Category
- Listing type
- Condition
- Price
- Negotiable toggle
- Optional original price
- Description
- Optional brand
- Province
- City/Municipality
- Optional barangay
- Quantity
- Fulfillment methods
- Optional meetup location note
- 1–8 photos

Not required in MVP:

- SKU
- Product variants
- Sizes/colors as structured variants
- Shipping weight
- Dimensions
- Complex inventory attributes

Size, color, model, and similar details may be written in the title or description.

### 10.2 Listing status

Listing states include:

- Draft
- Available
- Reserved
- Paused
- Sold
- Archived

### 10.3 Status visibility

**Draft**
- Seller/admin only

**Available**
- Public marketplace
- Public shop
- Searchable

**Reserved**
- Hidden from global marketplace/search
- Visible on seller shop page with Reserved badge
- Accessible through direct listing URL

**Paused**
- Non-public
- Seller/admin only

**Sold**
- Hidden from normal marketplace/search
- Direct URL remains accessible
- Page clearly shows Sold
- May show related active items

**Archived**
- Hidden from marketplace/search
- Direct URL remains accessible
- Page shows No longer available
- May show related active items

### 10.4 Listing expiration

Listings do not automatically expire in MVP.

A future version may remind sellers to reconfirm old listings.

### 10.5 Duplicate listing behavior

Seller may use **Duplicate Listing** as a convenience feature.

Rules:

- Duplicate creates a new Draft
- It must be reviewed/edited before publishing
- The system should discourage accidental duplicate active posts of the same item
- Lightweight duplicate detection/warnings may be added
- Users can report Duplicate/Spam listings

---

## 11. Listing Images

### 11.1 Image count

Each listing supports:

- Minimum 1 photo
- Maximum 8 photos

### 11.2 Actual-item photo requirement

Every listing must include at least one actual photo of the item being sold.

For Pre-loved listings:

- Actual-item photos only
- No stock/catalog imagery

For Brand New listings:

- At least one actual-item photo required
- Stock/catalog images may be included additionally
- Non-actual images must be labeled **Reference Image** or **Catalog Image**

### 11.3 Image processing

When a seller selects an image:

1. Preshopps automatically resizes/compresses it before upload
2. Seller does not manually choose compression or dimensions
3. Original aspect ratio must be preserved
4. The whole photo must remain visible
5. Do not crop the actual uploaded image during processing
6. Output should remain clear and sharp enough for product viewing
7. File size should be reduced for faster upload and delivery

### 11.4 Upload UX

During upload:

- Show selected image
- Show circular progress indicator centered over the image
- Show subtle overlay while uploading
- Show completion state when done
- On failure, show Retry and Remove
- Publishing is blocked until required uploads complete successfully

### 11.5 Image management

Seller may:

- Reorder images
- Change cover image after publishing
- Remove images after publishing

The system must prevent removal if that would leave the listing without at least one valid actual-item photo.

### 11.6 Product card image rendering

Cards should preserve the full image visually where possible using fit/contain behavior rather than aggressively cropping products.

### 11.7 Video

Video uploads are out of scope for MVP.

---

## 12. Pricing

### 12.1 Currency

MVP supports PHP only.

### 12.2 Price fields

Standard listings support:

- Main price
- Optional Negotiable toggle
- Optional original price

### 12.3 Free items

Price of ₱0 is allowed.

Display:

**Free**

instead of:

`₱0`

Free listings still use the normal order-request flow where applicable.

### 12.4 Negotiable

The Negotiable attribute should be visible on:

- Product cards
- Product detail pages

Negotiation itself happens inside messaging.

No formal Make Offer workflow in MVP.

---

## 13. Specialized Categories

## 13.1 Cars and Motorcycles

Cars and Motorcycles are **inquiry-only** categories in MVP.

Allowed buyer actions:

- Browse
- Favorite
- Share
- Message Seller

Not allowed:

- Add to Cart
- Standard order-request flow

Optional vehicle fields:

- Brand
- Model
- Year
- Mileage
- Transmission
- Fuel type
- Registration status
- Documents available

Registration status examples:

- Registered
- Expired Registration
- For Renewal

Documents available may include:

- OR/CR
- Deed of sale
- Service records

Do not expose:

- Plate number
- VIN

These may be shared privately if buyer and seller choose.

### 13.2 For Rent

For Rent listings are also **inquiry-only** in MVP.

Optional/structured rental fields:

- Rental price
- Rental period: Daily / Weekly / Monthly / Other
- Optional security deposit
- Short rental terms
- Minimum rental period
- Optional capacity
- Optional What's Included
- Optional Rules / Restrictions
- Location
- Availability

Rental availability states:

- Available
- Unavailable
- Paused

No booking calendar or automated reservation scheduling in MVP.

Specific dates, deposit details, rules, and handover are discussed through messaging.

### 13.3 Category-based transaction behavior

Inquiry-only:

- Cars
- Motorcycles
- For Rent

Cart + order-request flow:

- All other sale categories

Negotiable may still be enabled on inquiry-only listings.

---

## 14. Location System

### 14.1 MVP geographic scope

Preshopps UI supports Philippines locations only in MVP.

Database architecture must include a country identifier such as country_code so international expansion is possible later.

### 14.2 Structured location hierarchy

Use structured Philippine location data:

`Country → Province → City/Municipality → Barangay`

Country is fixed to Philippines in MVP UI.

### 14.3 Listing location

Each listing uses structured fields:

- Province
- City/Municipality
- Optional Barangay

No free-text primary location field.

An optional short meetup/location note is allowed.

Exact home addresses must never be publicly displayed.

### 14.4 Shop location inheritance

New listings inherit the shop's location by default.

Seller may change the location per listing.

### 14.5 Marketplace location filter

Default:

- All supported Philippine listings

Noticeable filter control:

`All Philippines → Province → City/Municipality → Barangay`

Location filtering works for guests and signed-in users.

No GPS requirement.

No Near Me / distance filter in MVP.

### 14.6 Filter persistence

Do not automatically restore old filters on a fresh visit.

Filter state should persist via URL query parameters during current browsing, browser navigation, saved links, or shared links.

---

## 15. Search and Filters

### 15.1 Keyword search

Search should cover:

- Product title
- Description
- Category
- Shop name
- Location

### 15.2 MVP filters

- Category
- Listing type
- Condition
- Price range
- Province
- City/Municipality
- Barangay
- Fulfillment method
- Available only

### 15.3 Sorting

Marketplace default:

- Newest first

Additional sort options may include:

- Price: Low to High
- Price: High to Low

Shop listing sort:

- Newest
- Price: Low to High
- Price: High to Low

### 15.4 Search URL state

Search and filter state should be reflected in the URL.

Example:

`/search?province=misamis-occidental&city=tangub&category=electronics`

This enables:

- Bookmarking
- Sharing
- Browser back/forward
- Refresh persistence
- Easier debugging

### 15.5 Result loading

Use progressive **Load More** / cursor-based loading.

Do not use numbered pagination as the primary marketplace UX.

---

## 16. Product Cards

Product cards should remain minimal.

Show:

- Product photo
- Product title
- Price
- Condition badge
- Location
- Posted time
- Favorite heart
- Shop name in subtle secondary text

Do not clutter cards with:

- Long descriptions
- Excessive badges
- Fulfillment icons
- Full seller rating details

### 16.1 Posted time

Use relative labels such as:

- Just now
- 2 hours ago
- 3 days ago
- 2 weeks ago

### 16.2 Public view counts

Do not show view counts publicly in MVP.

View tracking may exist internally.

---

## 17. Product Detail Page

Recommended content hierarchy:

1. Full product photo gallery
2. Product title
3. Price
4. Condition
5. Location
6. Description
7. Seller/shop information and trust signals
8. Fulfillment options
9. Reviews / seller reputation context
10. Related items

Primary actions for normal sale listings:

- Message Seller
- Add to Cart
- Favorite
- Share

Primary actions for inquiry-only listings:

- Message Seller
- Favorite
- Share

Important actions should remain easy to reach on mobile without cluttering the interface.

### 17.1 Related items

Sold, Reserved, Archived, or otherwise unavailable listings may show:

**You may also like**

with active listings based on:

- Same category
- Same location when useful
- Same seller when appropriate

---

## 18. Favorites

Favorites are included in MVP.

Rules:

- Signed-in users can favorite listings
- Guests tapping Favorite must sign in or create an account
- Guest favorites are not stored locally
- Favorites persist for registered users

Shop following is out of scope for MVP.

---

## 19. Recently Viewed

### 19.1 Guests

Store recently viewed items locally in the browser/device.

### 19.2 Signed-in users

Recently viewed history may be associated with the account.

### 19.3 Display

Show a lightweight Recently Viewed section on Home or Account.

Exclude removed/hidden listings where necessary.

---

## 20. Cart

### 20.1 Guest cart

Guests may add eligible sale listings to cart.

Guest cart:

- Stored locally on device/browser
- Persists through browser close/reopen
- Survives signup/login

### 20.2 Signed-in cart

Signed-in cart:

- Persists across sessions
- Stored with the account
- May be available across devices

Guest cart should merge carefully with signed-in cart after authentication.

### 20.3 Cart visibility

Header should include a visible cart icon on all screen sizes with item-count badge when non-empty.

### 20.4 Multi-seller cart

Buyer may add listings from multiple sellers into one cart.

When submitting, Preshopps splits the cart into separate order requests per seller.

Each seller sees only their own items.

### 20.5 Quantity

Buyer may request quantity up to current available stock.

Preshopps must revalidate inventory before order submission.

### 20.6 Stale/unavailable cart items

If an item becomes Sold, Reserved, Paused, removed, or otherwise unavailable:

- Keep it visible in cart
- Mark it Unavailable
- Disable submission for that item
- Let buyer remove it
- Allow remaining valid items to proceed

### 20.7 Shared carts

Shared carts are out of scope for MVP.

---

## 21. Order Requests

### 21.1 Payment model

MVP does **not** process payments.

Buyer and seller coordinate payment outside the platform through messaging.

Possible future payment options:

- GCash
- QR code payments
- Other supported payment integrations

### 21.2 Order submission

For eligible normal-sale listings:

Buyer submits an order request to seller.

Seller receives:

- In-app notification
- Email notification

Order request includes:

- Requested items
- Quantity
- Buyer display name
- Fulfillment preference
- Snapshot of relevant item details

### 21.3 Order snapshot

The order must preserve a snapshot of important listing data at the time of request, including:

- Product title
- Price
- Quantity
- Relevant item details

This protects the order from later listing edits.

### 21.4 Seller response

Seller may:

- Accept
- Decline
- Partially accept multi-item requests

### 21.5 Partial acceptance

If seller accepts only some items:

- Buyer receives in-app + email notification
- Accepted and declined items are clearly shown
- Buyer must tap **Confirm Changes** before remaining accepted items continue

### 21.6 Reservation timing

Submitting an order request does **not** reserve stock.

Stock is reserved only when seller accepts.

At acceptance time:

- Re-check inventory
- Prevent acceptance beyond available quantity

For one-off quantity-1 items:

- First accepted request reserves the item
- Listing becomes Reserved

### 21.7 Order request expiration

Unanswered order requests expire after **72 hours**.

One reminder is sent to seller approximately **24 hours before expiration** via:

- In-app notification
- Email

Accepted orders do not auto-expire.

---

## 22. Order Status Flow

Core order progression:

`Pending → Accepted → Ready → Handed Over/Shipped → Buyer Confirms Received → Completed`

Alternative outcomes:

- Pending → Declined
- Pending → Expired
- Pending → Buyer Cancelled
- Accepted → Cancellation Requested
- Accepted/Ready/etc. → Cancelled
- Active order → Disputed

### 22.1 Ready

Seller may mark an accepted order **Ready**.

### 22.2 Handed Over/Shipped

Seller indicates fulfillment has occurred:

- Handed Over
- Shipped

depending on fulfillment method.

### 22.3 Buyer confirmation

Order becomes Completed only after buyer confirms receipt.

No automatic completion in MVP.

If buyer never confirms receipt, order remains unresolved until:

- Buyer confirms
- Order is cancelled
- Dispute/admin intervention resolves it

### 22.4 Completion and reviews

Completed status unlocks verified review eligibility.

---

## 23. Cancellation Rules

### 23.1 Buyer cancellation

While Pending:

- Buyer may cancel immediately

After Accepted:

- Buyer submits cancellation request
- Seller confirms cancellation

### 23.2 Seller cancellation

Seller may cancel an accepted order and must choose a reason such as:

- Item unavailable
- Buyer requested cancellation
- Unable to fulfill
- Other

Buyer receives:

- In-app notification
- Email

Listing may return to Available unless seller keeps it Paused/Archived.

### 23.3 Cancellation trust handling

Cancellation history is tracked internally.

Do not publicly shame users with raw cancellation counts.

Repeated problematic cancellations may influence:

- Internal risk checks
- Moderation
- Trust evaluation

---

## 24. Fulfillment

Seller-level supported fulfillment methods:

- Meet-up
- Pickup
- Local delivery
- Shipping

Listing can inherit shop-level fulfillment methods.

Exact arrangements are discussed in messaging.

Preshopps does not calculate shipping or delivery fees in MVP.

Buyer and seller agree on fees themselves.

No courier integrations in MVP.

---

## 25. Messaging

### 25.1 Messaging scope

Preshopps includes a lightweight built-in messaging system.

Two conversation types:

- Listing inquiry — tied to a specific product
- General shop inquiry — tied to seller/shop only

### 25.2 Conversation separation

If a buyer messages the same seller about different listings, keep separate product-linked conversations per listing.

### 25.3 Message format

MVP messaging is:

- Text only
- No image attachments
- No voice notes
- No calls
- No typing indicators
- No read receipts

### 25.4 Message immutability

Once sent:

- No editing
- No deletion
- No unsend grace period

This preserves evidence for disputes and moderation.

### 25.5 Links in messages

Private messages may contain plain-text external links.

Show a lightweight safety warning such as:

**External link — open carefully. Preshopps does not verify third-party websites.**

### 25.6 Product descriptions and links

Product descriptions must not contain clickable external links.

URLs should be stripped, neutralized, or otherwise prevented from becoming external checkout/spam links.

### 25.7 Inbox functionality

Inbox includes:

- Conversation list
- Unread badges
- Search
- Archive
- Mute Conversation
- Mark as Unread

Inbox filters:

- All
- Unread
- Archived

Inbox search supports:

- Buyer/seller display name
- Shop name
- Listing title

No separate Resolved conversation state.

### 25.8 Message retention

Messages do not auto-delete.

Archive hides a conversation from the main inbox but preserves history.

### 25.9 Message notifications

- In-app notification immediately for new messages
- Email only for messages that remain unread after a delay or as grouped notifications
- Do not email users for every single message

Mute suppresses ordinary chat notifications, but critical order/dispute notifications still appear.

### 25.10 External Messenger

Seller may optionally provide a Facebook Messenger link.

Built-in Preshopps messaging remains the primary marketplace communication path.

No other external social/contact links in MVP.

---

## 26. Reviews

### 26.1 Review eligibility

Only buyers with a **Completed** order may leave a review.

### 26.2 Review target

Reviews are seller-focused.

The purchased item may appear as context, but the star rating contributes to the seller's reputation, not a reusable product rating.

### 26.3 Review content

Each verified review supports:

- 1–5 star rating
- Short written review
- Up to 2 review photos
- Purchased item reference

One review per completed order.

### 26.4 Review editing

Buyer may edit their review for **7 days** after posting.

After 7 days:

- Review becomes read-only
- Admin may intervene if necessary

Buyer cannot directly delete a posted review.

Removal requests go through moderation.

### 26.5 Seller reply

Seller may post one public reply per review.

Seller may edit that reply for **7 days**.

After 7 days, reply becomes read-only unless admin intervenes.

### 26.6 Review moderation

Seller cannot hide or delete reviews.

Seller may report a review.

Admin may:

- Remove invalid/abusive reviews
- Remove an individual review image without deleting the full review

### 26.7 Review display

Seller average rating:

- One decimal place
- Total review count

Example:

`★ 4.8 · 27 reviews`

New sellers should show:

- New seller
- No reviews yet

Never show `0.0` as if it were a bad rating.

### 26.8 Review filtering

Shop review tab supports rating filters:

- All
- 5
- 4
- 3
- 2
- 1

Review sorting:

- Newest
- Highest Rated

No Helpful voting in MVP.

### 26.9 Rating calculation

All verified reviews contribute equally to the seller's average rating in MVP.

---

## 27. Seller Trust and Reputation

### 27.1 Public trust signals

Public shop pages may show:

- Verified email status where appropriate
- Member since
- Average rating
- Review count
- Completed order count
- Active listing count
- Trusted Seller badge

### 27.2 Trusted Seller requirements

Initial Trusted Seller criteria:

- Verified email
- At least 5 completed orders
- At least 3 verified reviews
- Average rating of at least 4.0
- No active serious moderation issues

### 27.3 Trusted Seller behavior

Trusted Seller badge is dynamic, not permanent.

The system recalculates eligibility.

Badge may be removed if seller no longer qualifies.

Do not use **Verified Seller** unless actual identity verification exists in a future version.

### 27.4 Seller metrics visibility

Public:

- Completed orders
- Active listings
- Rating/review count

Not public:

- Dispute count
- Raw cancellation count
- Internal risk score

### 27.5 Buyer reputation

Lightweight buyer reputation may include:

- Member since
- Completed order count
- Internal cancellation history
- Optional seller-to-buyer rating after completed transaction

Buyer reputation should be less prominent than seller reputation.

---

## 28. Seller Dashboard

MVP seller dashboard includes:

- Shop overview
- Active listings
- Reserved listings
- Sold listings
- Paused listings
- Drafts
- Archived listings
- Create listing
- Edit listing
- Incoming order requests
- Messages
- Reviews
- Basic shop settings

### 28.1 Private listing performance

Seller may see per-listing private metrics:

- Views
- Favorite count
- Inquiry/message count
- Order request count

No advanced charts or revenue analytics in MVP.

### 28.2 Featured listing

Seller may feature **one listing** at the top of their own shop page.

Featured status affects only the seller's shop page.

It does **not** boost ranking in the global marketplace feed.

### 28.3 Scheduled publishing

Out of scope for MVP.

Drafts provide the preparation workflow.

---

## 29. Listing Editing and Inventory Protection

### 29.1 Editing after order request

Seller may edit a listing after an order request exists, but active accepted orders must retain their original order snapshot.

Critical order details such as price/identity must not silently mutate the buyer's agreed order.

### 29.2 Inventory behavior

For quantity 1:

- Accepted order changes listing to Reserved
- Completed order changes listing to Sold
- Cancelled accepted order may return listing to Available

For quantity >1:

- Reserve accepted quantity
- Reduce available stock
- Listing remains Available until remaining available quantity reaches zero

---

## 30. Blocking

Buyer and seller may block one another.

Blocked users may still see public marketplace content where it is public.

Blocking prevents direct interaction:

- No new messages
- No new order requests
- No new reviews between blocked parties
- No new general shop inquiries

Existing order, review, moderation, and dispute history remains preserved.

---

## 31. Reporting and Moderation

Users may report:

- Listing
- Seller/shop
- Review
- Message/conversation

Report reasons include:

- Scam/Fraud
- Prohibited Item
- Misleading
- Harassment
- Spam
- Duplicate/Spam
- Other

Reports may include optional notes.

Admin may:

- Hide/remove listings
- Suspend seller privileges
- Restrict buyer privileges
- Suspend entire account
- Remove abusive reviews
- Remove review images
- Resolve moderation cases

No automated AI moderation in MVP.

---

## 32. Prohibited Items

Preshopps must launch with a clear prohibited-items policy.

Examples include:

- Weapons and ammunition
- Illegal drugs
- Prescription medicines
- Counterfeit goods
- Stolen goods
- Adult sexual products
- Hazardous chemicals
- Alcohol
- Nicotine products
- Anything illegal under applicable Philippine law

This list may be expanded by policy.

---

## 33. Suspension and Restrictions

### 33.1 Seller suspension

When seller privileges are suspended:

- Public shop becomes hidden
- Public listings become hidden
- Seller cannot publish
- Seller cannot receive new order requests
- Seller cannot continue normal seller activity

Preserve:

- Existing orders
- Messages
- Reviews
- Disputes
- Moderation records

### 33.2 Suspended seller sign-in

Suspended seller may still sign in with restricted access to:

- See suspension notice/reason
- View existing order history
- View dispute/support information
- Submit an appeal

### 33.3 Restriction types

Admin may apply:

- Seller-only restrictions
- Buyer-side restrictions
- Full-account suspension

### 33.4 Suspension appeal

Suspended sellers may submit a basic **Appeal Suspension** form.

Admin may:

- Restore privileges
- Keep suspension

---

## 34. Disputes

### 34.1 Eligibility

Buyer or seller may open a dispute on an eligible active order.

### 34.2 Dispute submission

Dispute includes:

- Reason
- Short explanation
- Up to 3 supporting images

### 34.3 Dispute status

User-visible timeline:

`Opened → Under Review → Resolved`

### 34.4 Admin dispute actions

Admin may:

- Review order
- Review relevant messages/history
- Add private internal notes
- Cancel order
- Close dispute
- Mark order completed when evidence is sufficient

### 34.5 Payment limitation

Preshopps does not provide escrow, refunds, or payment arbitration in MVP because payments are not processed by Preshopps.

### 34.6 Dispute history

Resolved disputes remain attached to order history for:

- Buyer
- Seller
- Admin

Dispute counts/rates are not displayed publicly.

---

## 35. Notifications

### 35.1 In-app notifications

Notify users about:

- New message
- New order request
- Order accepted
- Order declined
- Order partially accepted
- Buyer confirmation required
- Order cancelled
- Cancellation request
- Order marked Ready
- Order marked Handed Over/Shipped
- Order completed
- New review
- Review reply
- Dispute activity
- Moderation action
- Relevant admin/support events

### 35.2 Notification center

Header includes notification bell with unread-count badge.

Opening a notification should deep-link to the relevant:

- Message
- Order
- Review
- Listing
- Dispute

### 35.3 Email notifications

Use email for important events such as:

- New order request
- Order acceptance/decline
- Partial acceptance
- Order expiration reminder
- Important unread messaging summary
- Moderation action
- Account/security events

Do not send an email for every chat message.

### 35.4 Push notifications

Browser/PWA push notifications are out of scope for MVP unless explicitly added later.

---

## 36. Social Sharing

Every public listing should support:

- Share Listing
- Copy Link
- Native share sheet on supported mobile devices

Shared content should link directly back to the Preshopps listing.

### 36.1 Social preview metadata

Public listing pages should include metadata suitable for Facebook/Messenger/social previews, including:

- Product image
- Title
- Price
- Condition
- Location
- Direct Preshopps URL

### 36.2 Facebook usage

Preshopps does not depend on automatic posting into Facebook Groups.

Users can manually share listing links into:

- Facebook groups
- Messenger
- WhatsApp
- Other platforms

The social platform is a discovery channel; the canonical listing remains on Preshopps.

---

## 37. SEO and Public URLs

### 37.1 Public shop URLs

Example:

`/shop/annes-closet`

### 37.2 Public listing URLs

Example:

`/item/nike-air-max-270-abc123`

### 37.3 SEO behavior

Public active listings and public shop pages should be indexable by search engines.

Include:

- Clean page title
- Meta description
- Social preview metadata
- Structured data where useful

### 37.4 Sold/archived URLs

Do not break old shared URLs.

Sold and archived pages should remain accessible with clear unavailable status and related-item recommendations.

Paused listings remain non-public.

---

## 38. Navigation and Responsive UX

### 38.1 Mobile navigation

Bottom navigation:

- Home
- Search
- Sell
- Messages
- Account

Top header:

- Preshopps logo
- Notifications
- Cart

### 38.2 Tablet/Desktop

Navigation may move into a clean top header while preserving the same information architecture.

### 38.3 Responsive requirement

Preshopps must work properly on:

- Small Android phones
- iPhones
- Large phones
- Tablets
- iPad
- Laptops
- Desktop monitors

No separate mobile site.

One responsive application.

---

## 39. Visual Design Direction

### 39.1 Theme

MVP uses **light mode only**.

No dark mode.

### 39.2 Style

Apple-inspired simplicity:

- White / very light neutral surfaces
- Strong black/near-black typography
- Large whitespace
- Subtle borders
- Minimal shadows
- Restrained corner rounding
- High-quality product photography
- One elegant accent color
- Clear typography hierarchy
- Minimal animation

Avoid:

- Flash-sale clutter
- Countdown timers
- Excessive badges
- Loud gradients
- Crowded dashboards
- Shopee/Lazada-style information overload

### 39.3 Product card priority

Product photography should do most of the visual work.

---

## 40. Admin Dashboard

Admin dashboard MVP includes:

- Users
- Sellers/shops
- Listings
- Categories
- Reports
- Reviews
- Orders
- Disputes
- Support submissions
- Basic site settings
- Suspend/restore users
- Suspend/restore seller privileges
- Hide/remove listings
- Moderation history

Admin UI should prioritize function over visual complexity.

---

## 41. Admin Audit Log

Important administrative actions must be logged.

Audit record should capture:

- Admin identity
- Action performed
- Target resource/user
- Previous state when applicable
- New state when applicable
- Timestamp
- Reason when applicable

Examples:

- User suspension
- Seller restriction
- Listing removal
- Review removal
- Review-image removal
- Dispute resolution
- Admin role change

---

## 42. Moderation Notifications

When admin takes an action affecting a user, the affected user receives:

- In-app notification
- Email notification

User-facing message should explain the reason clearly.

Private admin notes must never be exposed to users.

---

## 43. Support

### 43.1 Support page

Preshopps includes a Contact / Support page.

Support form requires login.

Categories may include:

- General inquiry
- Account issue
- Order/dispute issue
- Report a problem

Support submissions route to admin and may optionally trigger email notification.

### 43.2 Guest support

Guests cannot submit the support form.

### 43.3 Public contact email

Public footer should provide:

**support@preshopps.com**

for general, legal, or privacy contact.

---

## 44. Public Informational Pages

Include in MVP:

- How It Works
- Safety Tips
- Terms of Use
- Privacy Policy
- Marketplace Rules / Prohibited Items Policy
- Contact / Support

Do not include an About page in MVP.

### 44.1 How It Works

Include two simple sections:

- How to Buy
- How to Sell

### 44.2 Safety Tips

Include lightweight reminders such as:

- Meet in safe public places when appropriate
- Verify item condition before completing payment when possible
- Avoid sharing unnecessary sensitive information
- Be cautious with external links
- Understand that shipping/payment arrangements are coordinated between users in MVP

---

## 45. Marketplace Fees and Monetization

MVP policy:

- No listing fee
- No marketplace commission
- No seller subscription
- No buyer fee

Primary objective:

- Grow inventory
- Grow seller adoption
- Grow buyer usage
- Validate marketplace behavior

Possible future monetization, not MVP:

- Featured listings
- Promoted shops
- Transaction fees after integrated payments
- Optional seller services

---

## 46. Explicit MVP Exclusions

The following are intentionally out of scope unless a later canonical decision adds them:

- Integrated GCash payment processing
- QR payment processing
- Credit/debit card processing
- Escrow
- Refund engine
- Marketplace wallet
- Seller subscription plans
- Listing fees
- Marketplace commission
- Courier integrations
- Automatic shipping fee calculation
- Internal logistics tracking
- GPS-based Near Me filtering
- Phone/SMS authentication
- Social login
- Dark mode
- Video uploads
- Product variants system
- Automated AI moderation
- AI product recommendations
- AI search
- Real-time typing indicators
- Read receipts
- Voice notes
- Calls
- Image messaging
- Message editing/deletion
- Message unsend
- Formal Make Offer workflow
- Shop following
- Seller follower counts
- Live selling
- Auctions
- Coupons
- Loyalty points
- Rewards
- Flash sales
- Countdown timers
- Scheduled listing publishing
- Shared carts
- Public view counts
- Public dispute rates
- Public cancellation counts
- Automated rental booking calendar
- Automated rental deposits
- Vehicle checkout/order flow
- Rental checkout/order flow
- External checkout links
- External seller website links
- Public seller phone numbers
- TikTok/Instagram/social profile links beyond optional Messenger
- Shop cover/banner photos
- About page
- International currency support
- Multi-language support

---

## 47. Future Roadmap Candidates

Potential later features, subject to validation:

- GCash integration
- QR-code payment workflows
- Integrated payment confirmation
- Optional escrow
- Phone verification
- Optional identity verification
- Verified Seller badge based on real identity checks
- Near Me using browser geolocation
- International marketplace expansion
- Multi-currency
- Filipino localization
- Shop following
- Seller notifications for new followers/listings
- Push notifications / PWA notifications
- Formal Make Offer negotiation workflow
- Rental calendar
- Courier/shipping integrations
- Featured/promoted listings
- Smarter feed ranking
- Seller analytics dashboards
- Product video uploads
- Advanced anti-fraud systems
- Advanced automated moderation

---

## 48. Core Marketplace Success Criteria

The MVP succeeds if users can reliably complete this journey:

### Seller

1. Create account
2. Verify email
3. Create shop
4. Create listing
5. Upload photos successfully
6. Publish item
7. Receive inquiry/order request
8. Communicate with buyer
9. Fulfill transaction
10. Receive verified review

### Buyer

1. Open Preshopps without signup
2. Immediately see items for sale
3. Search/filter listings
4. Open product page
5. Evaluate seller trust
6. Favorite or add eligible item to cart
7. Sign in when transaction requires account
8. Send inquiry/order request
9. Communicate with seller
10. Confirm receipt
11. Leave verified review

### Platform

1. Keep public browsing fast and uncluttered
2. Preserve listing/shop SEO and shared URLs
3. Maintain seller/buyer privacy
4. Prevent overselling through acceptance-time inventory validation
5. Preserve moderation/dispute history
6. Support responsive UX across mobile, tablet, and desktop

---

## 49. Product North Star for MVP

Preshopps should never feel like a complicated ecommerce system merely because it supports multiple sellers.

The MVP should feel like:

> A beautiful, trustworthy local marketplace where people can discover something, understand who is selling it, talk directly, and complete the transaction simply.

If a feature does not materially improve discovery, trust, listing, messaging, ordering, fulfillment, or moderation, it should usually remain outside MVP.

---

## 50. Canonical Decision Rule

When implementation details are ambiguous:

1. Prefer the simplest behavior consistent with this PRD.
2. Do not invent new MVP features.
3. Do not expand scope without a documented product decision.
4. Preserve guest browsing and mobile-first simplicity.
5. Preserve privacy and trust controls.
6. Preserve one-account / one-shop architecture.
7. Preserve marketplace-first discovery.
8. Preserve no-payment-processing MVP scope.
9. Preserve light-mode Apple-inspired design direction.
10. Escalate material product, security, architecture, cost, or UX tradeoffs for review before implementation.

