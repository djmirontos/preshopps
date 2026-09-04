-- Reviews module, schema only. Creates public.reviews and public.review_images.
-- No RPCs, no RLS policies, no public read functions, no storage bucket, no
-- moderation tables, no trusted-seller calculation, no aggregate cache, no
-- product/listing rating schema. RLS/security and all review RPCs are a
-- separate, later migration (0034) per locked task scope.
--
-- Pre-inspection findings (read-only, immediately before writing this file)
-- -----------------------------------------------------------------------
-- Migration history ends at 0032_fix_start_conversation_state_invariant; this
-- is the next migration, no drift. Confirmed live: no public.reviews table,
-- no public.review_images table, and no function whose name matches
-- '%review%' or '%rating%' exists anywhere in the public schema -- a clean
-- namespace, no collision.
--
-- orders relevant columns (live): id uuid default gen_random_uuid(), buyer_id
-- uuid not null (fk -> profiles(id) on delete restrict), shop_id uuid not
-- null (fk -> shops(id) on delete restrict), status order_status_enum not
-- null default 'pending', completed_at timestamptz nullable. order_status_enum
-- values: pending, changes_pending, accepted, ready, handed_over_or_shipped,
-- received_confirmed, completed, declined, cancelled, expired, disputed --
-- 'completed' is the terminal value the future create_review RPC will gate
-- on (not implemented here).
--
-- profiles.id: uuid not null, NO default (assigned externally to equal
-- auth.users.id via the existing handle_new_user trigger, not
-- gen_random_uuid()) -- reviews.buyer_id references this exact column.
-- shops.id: uuid not null default gen_random_uuid() -- reviews.shop_id
-- references this exact column.
--
-- order_items relevant columns (live, NOT modified by this migration): id,
-- order_id, shop_id, listing_id (nullable, fk -> listings(id) on delete set
-- null), status order_item_status_enum (pending, accepted, declined),
-- quantity, listing_title_snapshot, listing_public_code_snapshot,
-- price_cents_snapshot, shop_name_snapshot, listing_cover_image_snapshot_path
-- (nullable), created_at. These snapshot columns already capture everything
-- a future public review read needs to render "purchased item reference"
-- context (title, price, quantity, cover image, shop name) without touching
-- listings (which may have since changed) -- confirming the strong
-- expectation stated in the task brief: no purchased-item-reference column
-- of any kind (listing_id, order_item_id, or otherwise) is added to
-- reviews. A future public read RPC derives this by querying
-- order_items where order_id = reviews.order_id and status = 'accepted'
-- (declined/pending line items were never actually fulfilled and should not
-- be shown as "purchased"), correctly supporting multi-item orders without
-- pretending a review belongs to one single product. This assumption held
-- on inspection -- not stopping, proceeding as instructed.
--
-- updated_at convention (live, confirmed unbroken across every existing
-- table that has an updated_at column -- carts, conversation_user_states,
-- listing_metrics, listing_rental_details, listing_vehicle_details,
-- listings, orders, profiles, shops): a single
-- "before update ... execute function moddatetime('updated_at')" trigger
-- named set_updated_at. public.reviews follows this exact, unbroken
-- convention below. public.review_images has no updated_at column (it is
-- immutable child data -- an image reference is replaced wholesale by a
-- future RPC, never edited in place) and therefore gets no trigger, matching
-- the same reasoning applied to every other trigger-free child/detail table
-- in this schema.
--
-- FK delete convention (live, confirmed uniform across the entire schema):
-- every identity/ownership FK (buyer_id, shop_id, owner_id, sender_id,
-- initiator_id, user_id -> profiles/shops/orders) is ON DELETE RESTRICT.
-- ON DELETE CASCADE is used only for a table's own strictly-owned child rows
-- scoped by an id it fully owns (e.g. listing_images.listing_id ->
-- listings). reviews.order_id/buyer_id/shop_id therefore use RESTRICT
-- (below), and review_images.review_id uses CASCADE (below) -- both follow
-- precedent exactly, no new convention invented.
--
-- UUID/default convention (live, confirmed): every non-identity-linked
-- table's primary key is "id uuid primary key default gen_random_uuid()".
-- reviews.id and review_images.id follow this exactly.
--
-- Reply-column consistency constraints (analysis)
-- -----------------------------------------------------------------------
-- The future seller-reply RPC's exact timestamp semantic at first-reply time
-- (whether reply_updated_at is stamped to now() alongside reply_created_at,
-- or left NULL until a genuine second edit) is explicitly not decided by
-- this migration -- it is deferred to 0034. The two structural constraints
-- below are the loosest rule that still rejects every combination that is
-- malformed under EITHER future semantic, so neither future choice is
-- foreclosed by this schema:
--   reviews_reply_body_created_at_pair_check:
--     (reply_body is null) = (reply_created_at is null)
--     -- a reply's body and its creation timestamp always exist together or
--     -- not at all; rejects "reply text with no creation time" and
--     -- "creation time with no reply text".
--   reviews_reply_updated_requires_created_check:
--     reply_updated_at is null or reply_created_at is not null
--     -- an edit timestamp can never exist without a creation timestamp;
--     -- still allows reply_updated_at to be null immediately after first
--     -- creation (preserving the "not yet edited" distinction) if 0034
--     -- chooses that semantic, while still rejecting any state where a
--     -- reply is edited but was never created.
-- A stronger fully-symmetric "all three null or all three non-null"
-- constraint was considered and rejected: it would force reply_updated_at to
-- be stamped at creation time, silently deciding the open RPC-semantic
-- question this migration is not scoped to decide.
--
-- Max-two-images structural proof
-- -----------------------------------------------------------------------
-- sort_order smallint not null check (sort_order between 0 and 1) limits
-- every row to exactly one of two legal values (0 or 1). unique(review_id,
-- sort_order) forbids two rows for the same review from sharing a sort_order
-- value. Since only two distinct values are legal at all, and each is
-- usable at most once per review_id, a given review_id can appear in at
-- most 2 rows (one at sort_order 0, one at sort_order 1) -- a third row
-- would require a third legal sort_order value, which does not exist, or
-- would collide with an existing (review_id, sort_order) pair, which the
-- unique constraint forbids. 0, 1, or 2 image rows per review are all
-- reachable; 3+ is structurally unreachable. No trigger needed.

create table public.reviews (
  id uuid primary key default gen_random_uuid(),

  order_id uuid not null
    references public.orders(id) on delete restrict,

  buyer_id uuid not null
    references public.profiles(id) on delete restrict,

  shop_id uuid not null
    references public.shops(id) on delete restrict,

  rating smallint not null,

  body text null,

  reply_body text null,
  reply_created_at timestamptz null,
  reply_updated_at timestamptz null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint reviews_order_id_key unique (order_id),

  constraint reviews_rating_check
    check (rating between 1 and 5),

  -- optional review text: when present, must contain at least one
  -- non-whitespace character and stay within 1000 characters. Uses the
  -- whitespace-aware POSIX character-class pattern established in 0031
  -- (single-argument btrim() strips only ASCII space, not tab/newline, and
  -- is deliberately not used here as the blankness guard). The future RPC
  -- normalizes whitespace-only input to NULL before INSERT/UPDATE, so this
  -- CHECK only ever needs to validate genuinely-supplied text.
  constraint reviews_body_check
    check (
      body is null
      or (
        char_length(body) <= 1000
        and body ~ '[^[:space:]]'
      )
    ),

  -- seller reply text: same length/whitespace shape as review body when
  -- present.
  constraint reviews_reply_body_check
    check (
      reply_body is null
      or (
        char_length(reply_body) <= 1000
        and reply_body ~ '[^[:space:]]'
      )
    ),

  -- reply_body and reply_created_at always exist together or not at all.
  constraint reviews_reply_body_created_at_pair_check
    check ((reply_body is null) = (reply_created_at is null)),

  -- reply_updated_at can never be set without reply_created_at also being
  -- set (an edit cannot predate a creation), but may remain null
  -- immediately after first creation -- see header analysis above.
  constraint reviews_reply_updated_requires_created_check
    check (reply_updated_at is null or reply_created_at is not null)
);

create trigger set_updated_at
  before update on public.reviews
  for each row execute function moddatetime('updated_at');

create index reviews_shop_id_created_at_id_idx
  on public.reviews (shop_id, created_at desc, id);

create index reviews_shop_id_rating_created_at_id_idx
  on public.reviews (shop_id, rating desc, created_at desc, id);

create table public.review_images (
  id uuid primary key default gen_random_uuid(),

  review_id uuid not null
    references public.reviews(id) on delete cascade,

  storage_path text not null,

  sort_order smallint not null,

  created_at timestamptz not null default now(),

  constraint review_images_storage_path_check
    check (storage_path ~ '[^[:space:]]'),

  constraint review_images_sort_order_check
    check (sort_order between 0 and 1),

  constraint review_images_review_id_sort_order_key
    unique (review_id, sort_order)
);
