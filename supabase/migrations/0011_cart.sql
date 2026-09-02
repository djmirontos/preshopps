-- Cart structural schema for the approved Preshopps design: carts and
-- cart_items only. No orders, order RPCs, messaging, reviews,
-- notifications, moderation, disputes, support, storage, or application
-- RLS policies are created here. Guest carts remain entirely
-- client-local and are never represented in this schema.

-- =============================================================================
-- carts
-- =============================================================================
--
-- One signed-in cart per user, enforced by UNIQUE(user_id) directly (no
-- separate index needed for "find my cart" beyond this constraint).
--
-- Delete behavior: user_id -> profiles(id) ON DELETE CASCADE. A cart is
-- pure user convenience data with no contractual or historical value on
-- its own — the same reasoning already applied to favorites/
-- recently_viewed in 0010, deliberately different from the RESTRICT used
-- for identity/shop/listing/order-adjacent "must survive" data.

create table carts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint carts_user_id_fkey
    foreign key (user_id) references profiles (id)
    on delete cascade
);

-- updated_at maintenance via the already-installed moddatetime
-- extension. cart_items deliberately does NOT get this trigger — see
-- that table's comment below.
create trigger set_updated_at
before update on carts
for each row
execute function extensions.moddatetime(updated_at);

-- =============================================================================
-- cart_items
-- =============================================================================
--
-- UNIQUE(cart_id, listing_id) is "one line per listing in a cart":
-- changing quantity updates the existing row, it never inserts a
-- duplicate line for the same listing.
--
-- cart_id -> carts(id) ON DELETE CASCADE: a cart_item has no meaning
-- without its cart — ordinary dependent-row cleanup, not a "must
-- survive" concern.
--
-- listing_id -> listings(id) ON DELETE RESTRICT (deliberately NOT
-- CASCADE): the approved product behavior is that when a listing
-- becomes unavailable, the cart row must remain visible so the UI can
-- show "unavailable" and let the buyer remove it explicitly — CASCADE
-- would silently delete that cart row the instant something happened to
-- the listing, before the UI ever had a chance to surface it. In
-- practice this is close to moot: listings are normally archived, sold,
-- or paused (a status change, not a row deletion — see 0008), never
-- hard-deleted in the normal product flow; the rare admin-only hard
-- delete path is exactly the case RESTRICT is meant to guard: it forces
-- that path to consciously deal with any carts still referencing the
-- listing rather than silently discarding cart state out from under a
-- buyer.
--
-- Deliberately NOT enforced here (all dynamic, revalidated at
-- submission time by future trusted logic, not this migration):
--   - quantity <= listings.stock_quantity (stock changes over time)
--   - listing status = 'available' (a listing may go unavailable while
--     still sitting in a user's cart — that's the whole point of
--     RESTRICT above)
--   - category cart-eligibility / inquiry-only exclusion (Cars,
--     Motorcycles, For Rent) — the future add-to-cart path consults
--     categories.is_inquiry_only; no category id/name is hardcoded here
--   - shop active status
--   - price-change detection beyond storing the snapshot itself (see
--     price_cents_snapshot below)
--
-- price_cents_snapshot is NOT contractual order history — order_items'
-- future immutable snapshot is what preserves that. This column exists
-- solely so a future read can detect "the listing's live price differs
-- from what was true when this was added to the cart" and prompt a
-- revalidation; it is not itself the source of truth for anything. No
-- title/shop/image snapshot columns and no currency column are added
-- (MVP is PHP only, per approved scope).

create table cart_items (
  id uuid primary key default gen_random_uuid(),
  cart_id uuid not null,
  listing_id uuid not null,
  quantity integer not null,
  price_cents_snapshot bigint not null,
  added_at timestamptz not null default now(),
  constraint cart_items_cart_id_fkey
    foreign key (cart_id) references carts (id)
    on delete cascade,
  constraint cart_items_listing_id_fkey
    foreign key (listing_id) references listings (id)
    on delete restrict,
  constraint cart_items_quantity_check
    check (quantity >= 1),
  constraint cart_items_price_cents_snapshot_check
    check (price_cents_snapshot >= 0),
  constraint cart_items_cart_id_listing_id_key
    unique (cart_id, listing_id)
);

-- No updated_at on cart_items: added_at is deliberately the fixed
-- original add-to-cart time, not a last-modified timestamp. A quantity
-- or snapshot change is represented by the row's current values, not by
-- when it was last touched — there is no approved product need (e.g. a
-- "recently changed" cart view) that would justify tracking that
-- separately, so no trigger/column is added for it.
--
-- No shop_id column on carts or cart_items: multi-seller grouping is
-- derived by joining cart_items -> listings -> shops at read/submission
-- time, not stored redundantly. Storing shop_id here would duplicate
-- data already reachable through listing_id with no proven query need
-- to justify it (per instruction, avoid redundant storage without a
-- concrete integrity/performance reason).
--
-- Indexes: UNIQUE(cart_id, listing_id) already covers both duplicate
-- prevention and "all items in this cart" (cart_id leads). No separate
-- cart_items(listing_id) index is added: it would only matter for the
-- FK RESTRICT check when hard-deleting a listing, and listings are
-- effectively never hard-deleted in normal product behavior (see
-- above) — the same "rare admin action, sequential scan is acceptable"
-- reasoning already applied to shop/category FK coverage in 0008.
