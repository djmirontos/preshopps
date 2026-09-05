-- Minimal Notifications backend: in-app notification persistence + read layer
-- only. No email/push/Realtime in this migration -- deferred to a future
-- application/worker integration per canonical docs. No dispute/moderation
-- notification types are added because those backend modules do not exist
-- live yet; their canonical notification requirements remain deferred.
--
-- Pre-inspection findings (read-only, immediately before writing this file)
-- -----------------------------------------------------------------------
-- Migration history ends at 0039_order_submission; this is the next
-- migration, no drift. Confirmed live: no notifications table, no
-- notification enum, no notification-referencing function, no
-- notification-named policy exists anywhere. Object counts confirmed
-- unchanged from the 0039 baseline (tables=31, indexes=85, triggers=10,
-- enums=16, policies=14, functions=32); all 32 pre-existing function
-- def-hashes captured as the regression baseline. Every function this
-- migration replaces was re-read in full via pg_get_functiondef immediately
-- before writing this file: submit_cart_order, accept_order_items,
-- mark_order_ready, mark_order_handed_over_or_shipped, complete_order,
-- cancel_accepted_order, request_order_cancellation,
-- resolve_order_cancellation, expire_pending_orders, send_message,
-- start_conversation, create_review, upsert_review_reply. profiles, orders,
-- conversations, conversation_user_states, reviews, shops, messages
-- columns were re-confirmed live.
--
-- Data model (locked)
-- -----------------------------------------------------------------------
-- notifications carries only structural reference columns (recipient_id,
-- type, actor_id, order_id, conversation_id, review_id, dedupe_key,
-- created_at, read_at) -- no title/body/payload/json, no delivery/email/push
-- state. Every recipient-facing string is projected fresh by
-- get_my_notifications from profiles/orders/conversations/listings, never
-- stored, so a later display-name/shop-name change is reflected
-- automatically and nothing here can go stale the way order_items'
-- deliberate snapshots must not.
--
-- Creation model (locked)
-- -----------------------------------------------------------------------
-- No client-facing create_notification RPC exists anywhere. Every
-- notification is inserted only inside an already-trusted SECURITY DEFINER
-- business function, after its real mutation has already happened (never
-- inside an idempotent early-return branch), with an internally-derived
-- recipient/actor (never a caller-supplied parameter), guarded against a
-- soft-deleted recipient, and de-duplicated via
-- ON CONFLICT ON CONSTRAINT notifications_recipient_type_dedupe_key DO
-- NOTHING -- never a bare ON CONFLICT (recipient_id, type, dedupe_key)
-- column list, to avoid the exact PL/pgSQL ambiguity class previously found
-- in 0037 (a bare conflict-target column list is an expression-parsing
-- position that can collide with a function's own RETURNS TABLE output
-- column names -- several of these functions output a column literally
-- named order_id/review_id/conversation_id). Naming the constraint sidesteps
-- that class entirely, since a constraint name is a plain object reference,
-- never an expression position. Every notification INSERT here targets an
-- explicit column list (a pure catalog lookup, not an expression position),
-- so no ambiguity risk exists there either, mirroring the same reasoning
-- already used for submit_cart_order's order_items insert in 0039.
--
-- Every replaced function keeps its original validation/locking/state-
-- machine logic byte-for-byte; the only additions are (a) one or two extra
-- already-locked columns pulled into an existing SELECT ... FOR UPDATE where
-- a notification hook genuinely needs a value the function did not
-- previously select (buyer_id and/or shop_id, in accept_order_items,
-- mark_order_ready, mark_order_handed_over_or_shipped, complete_order,
-- cancel_accepted_order, request_order_cancellation,
-- resolve_order_cancellation, expire_pending_orders), and (b) one guarded
-- INSERT INTO public.notifications per real-transition branch, placed after
-- all existing mutations and after every existing idempotency early-return,
-- immediately before that branch's own return. No transaction boundary is
-- introduced; a later failure in the same function (e.g. a later statement
-- raising) rolls back the whole transaction including any notification
-- already inserted earlier in that same call, satisfying "failed submission
-- must not leave an orphan notification" without any special handling.
--
-- Actor rule (locked): a real authenticated caller who caused the event
-- (buyer submitting, seller accepting, sender sending, buyer reviewing,
-- seller replying) is recorded as actor_id. complete_order and
-- expire_pending_orders have no auth.uid() call at all (both are
-- documented, pre-existing, trusted/system-callable paths) -- their
-- notifications use actor_id = NULL rather than fabricating a system user.
--
-- Blocking/deleted-recipient semantics (locked): no new block gate is added
-- to any order-lifecycle hook -- a block that occurs after a valid order
-- already exists must not silently suppress the buyer's own status
-- notifications about their own order. send_message/start_conversation/
-- create_review/upsert_review_reply already hard-block on user_blocks
-- before any mutation, so their hooks are naturally never reached when
-- blocked. Every hook suppresses creation (via a WHERE NOT EXISTS guard
-- against profiles.deleted_at) when the recipient is soft-deleted; no hook
-- checks whether the actor is deleted, since historical rows must remain
-- and actor identity is only ever masked at read time.
--
-- Mute semantics (locked): new_message hooks in send_message and
-- start_conversation check the recipient's own conversation_user_states.muted
-- flag and suppress the notification (not the message) when true. Archived
-- state is never checked -- archiving does not suppress per canon.
--
-- get_my_notifications hidden-listing guard (locked, corrected): conversation_
-- listing_title is populated only when (a) the joined listing's status is IN
-- ('available', 'reserved', 'sold', 'archived') -- the four states that
-- already permit public direct-listing detail per canon -- AND (b) the
-- listing's shop owner has no active seller_suspended/account_suspended
-- restriction (lifted_at IS NULL). A draft/paused listing, or any listing
-- whose seller is currently suspended, projects NULL instead -- a
-- suspended seller's shop/listings are canonically hidden from every public
-- marketplace surface, and this notification projection must not become an
-- alternate disclosure path for that same hidden data. The predicate is
-- evaluated via a NOT EXISTS subquery against an internal-only shop join
-- (owner_id is read only inside that subquery, never selected as an output
-- column). Suppressing the title never suppresses the notification row
-- itself (notification_id/type/created_at/read_at/conversation_id remain
-- returned in every case) -- only the optional listing-title context is
-- hidden, since the recipient already legitimately owns the conversation.
-- Blocking is unrelated to this guard and is never checked here: an
-- existing conversation's history, including its listing title, remains
-- legitimate even after the two parties later block each other.
create type public.notification_type_enum as enum (
  'order_request_received',
  'order_accepted',
  'order_declined',
  'order_changes_pending',
  'order_ready',
  'order_handed_over_or_shipped',
  'order_completed',
  'order_cancelled',
  'order_cancellation_requested',
  'order_cancellation_rejected',
  'order_expired',
  'new_message',
  'new_review',
  'review_reply'
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  type public.notification_type_enum not null,
  actor_id uuid references public.profiles(id) on delete set null,
  order_id uuid references public.orders(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete cascade,
  review_id uuid references public.reviews(id) on delete cascade,
  dedupe_key text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  constraint notifications_dedupe_key_not_blank_check check (length(btrim(dedupe_key)) > 0),
  constraint notifications_recipient_type_dedupe_key unique (recipient_id, type, dedupe_key)
);

create index notifications_recipient_created_idx
  on public.notifications (recipient_id, created_at desc, id desc);

alter table public.notifications enable row level security;

create policy notifications_select_own
  on public.notifications for select
  to authenticated
  using (auth.uid() = recipient_id);

comment on table public.notifications is
  'In-app notification persistence layer. No raw INSERT/UPDATE/DELETE policy exists -- all writes happen inside trusted SECURITY DEFINER business functions or the four notification RPCs. No title/body/payload/delivery-state columns by design; every recipient-facing string is projected fresh by get_my_notifications.';

-- ============================================================
-- get_my_notifications
-- ============================================================
create or replace function public.get_my_notifications(
  p_limit integer default 20,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null
)
returns table (
  notification_id uuid,
  type public.notification_type_enum,
  created_at timestamptz,
  read_at timestamptz,
  actor_display_name text,
  actor_avatar_path text,
  order_id uuid,
  order_public_code text,
  conversation_id uuid,
  conversation_listing_title text,
  review_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_deleted_at timestamptz;
begin
  -- ===================== authentication =====================
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'Authentication required.' using detail = 'NOT_AUTHENTICATED';
  end if;

  -- ===================== limit bounds =====================
  if p_limit is null or p_limit < 1 or p_limit > 50 then
    raise exception 'Limit must be between 1 and 50.' using detail = 'LIMIT_INVALID';
  end if;

  -- ===================== cursor: both-or-neither =====================
  if (p_before_created_at is null) <> (p_before_id is null) then
    raise exception 'Cursor must include both created_at and id, or neither.' using detail = 'CURSOR_INVALID';
  end if;

  -- ===================== missing/deleted caller profile: zero rows, not an error =====================
  select p.deleted_at into v_deleted_at
    from public.profiles p
    where p.id = v_caller;

  if not found or v_deleted_at is not null then
    return;
  end if;

  return query
    select
      n.id as notification_id,
      n.type,
      n.created_at,
      n.read_at,
      case when ap.deleted_at is null then ap.display_name else null end as actor_display_name,
      case when ap.deleted_at is null then ap.avatar_storage_path else null end as actor_avatar_path,
      n.order_id,
      o.public_code as order_public_code,
      n.conversation_id,
      case
        when l.status in ('available', 'reserved', 'sold', 'archived')
          and not exists (
            select 1 from public.user_restrictions ur
            where ur.user_id = ls.owner_id
              and ur.lifted_at is null
              and ur.restriction_type in ('seller_suspended', 'account_suspended')
          )
        then l.title
        else null
      end as conversation_listing_title,
      n.review_id
    from public.notifications n
    left join public.profiles ap on ap.id = n.actor_id
    left join public.orders o on o.id = n.order_id
    left join public.conversations c on c.id = n.conversation_id
    left join public.listings l on l.id = c.listing_id
    left join public.shops ls on ls.id = l.shop_id
    where n.recipient_id = v_caller
      and (
        p_before_created_at is null
        or n.created_at < p_before_created_at
        or (n.created_at = p_before_created_at and n.id < p_before_id)
      )
    order by n.created_at desc, n.id desc
    limit p_limit;
end;
$$;

revoke all on function public.get_my_notifications(integer, timestamptz, uuid) from public;
revoke all on function public.get_my_notifications(integer, timestamptz, uuid) from anon;
grant execute on function public.get_my_notifications(integer, timestamptz, uuid) to authenticated;

-- ============================================================
-- get_my_notification_unread_count
-- ============================================================
create or replace function public.get_my_notification_unread_count()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_deleted_at timestamptz;
  v_count integer;
begin
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'Authentication required.' using detail = 'NOT_AUTHENTICATED';
  end if;

  select p.deleted_at into v_deleted_at
    from public.profiles p
    where p.id = v_caller;

  if not found or v_deleted_at is not null then
    return 0;
  end if;

  select count(*) into v_count
    from public.notifications n
    where n.recipient_id = v_caller
      and n.read_at is null;

  return v_count;
end;
$$;

revoke all on function public.get_my_notification_unread_count() from public;
revoke all on function public.get_my_notification_unread_count() from anon;
grant execute on function public.get_my_notification_unread_count() to authenticated;

-- ============================================================
-- mark_notification_read
-- ============================================================
create or replace function public.mark_notification_read(
  p_notification_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
begin
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'Authentication required.' using detail = 'NOT_AUTHENTICATED';
  end if;

  -- ===================== foreign/nonexistent/already-read: silent no-op, no information leak =====================
  update public.notifications
    set read_at = now()
    where id = p_notification_id
      and recipient_id = v_caller
      and read_at is null;
end;
$$;

revoke all on function public.mark_notification_read(uuid) from public;
revoke all on function public.mark_notification_read(uuid) from anon;
grant execute on function public.mark_notification_read(uuid) to authenticated;

-- ============================================================
-- mark_all_notifications_read
-- ============================================================
create or replace function public.mark_all_notifications_read()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_count integer;
begin
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'Authentication required.' using detail = 'NOT_AUTHENTICATED';
  end if;

  update public.notifications
    set read_at = now()
    where recipient_id = v_caller
      and read_at is null;

  get diagnostics v_count = row_count;

  return v_count;
end;
$$;

revoke all on function public.mark_all_notifications_read() from public;
revoke all on function public.mark_all_notifications_read() from anon;
grant execute on function public.mark_all_notifications_read() to authenticated;

-- ============================================================
-- submit_cart_order (+ order_request_received notification)
-- ============================================================
create or replace function public.submit_cart_order(
  p_cart_item_ids uuid[],
  p_fulfillment_choices jsonb,
  p_buyer_note text default null
)
returns table (
  order_id uuid,
  shop_id uuid,
  order_public_code text,
  item_count integer,
  total_cents bigint,
  status public.order_status_enum
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_id uuid;
  v_deleted_at timestamptz;
  v_buyer_note text;
  v_constraint_name text;
  v_public_code text;
  v_new_order_id uuid;
  v_attempt integer;
  v_shop_owner_id uuid;
  r record;
begin
  -- ===================== auth =====================
  v_caller_id := auth.uid();
  if v_caller_id is null then
    raise exception 'Authentication required.' using detail = 'NOT_AUTHENTICATED';
  end if;

  -- ===================== active buyer profile =====================
  select p.deleted_at into v_deleted_at
    from public.profiles p
    where p.id = v_caller_id;

  if not found or v_deleted_at is not null then
    raise exception 'Account is not available.' using detail = 'INTERACTION_BLOCKED';
  end if;

  -- ===================== buyer restrictions =====================
  if exists (
    select 1 from public.user_restrictions ur
    where ur.user_id = v_caller_id
      and ur.lifted_at is null
      and ur.restriction_type in ('buyer_restricted', 'account_suspended')
  ) then
    raise exception 'Account is currently restricted.' using detail = 'INTERACTION_BLOCKED';
  end if;

  -- ===================== structural validation of selected ids =====================
  if p_cart_item_ids is null or coalesce(array_length(p_cart_item_ids, 1), 0) = 0 then
    raise exception 'At least one cart item must be selected.' using detail = 'SUBMISSION_INVALID';
  end if;

  if exists (select 1 from unnest(p_cart_item_ids) x where x is null) then
    raise exception 'Selected cart item ids may not be null.' using detail = 'SUBMISSION_INVALID';
  end if;

  if (select count(*) from unnest(p_cart_item_ids)) <> (select count(distinct x) from unnest(p_cart_item_ids) x) then
    raise exception 'Duplicate cart item ids are not allowed.' using detail = 'SUBMISSION_INVALID';
  end if;

  -- ===================== materialize selected rows with live state =====================
  drop table if exists pg_temp.tmp_submit_items;
  create temporary table tmp_submit_items (
    cart_item_id uuid primary key,
    listing_id uuid not null,
    shop_id uuid not null,
    shop_owner_id uuid not null,
    shop_name text not null,
    quantity integer not null,
    cart_price_snapshot bigint not null,
    current_price bigint not null,
    available_quantity integer not null,
    listing_title text not null,
    listing_public_code text not null,
    cover_image_path text,
    is_orderable boolean not null,
    is_blocked boolean not null,
    matched_order_id uuid
  ) on commit drop;

  insert into tmp_submit_items (
    cart_item_id, listing_id, shop_id, shop_owner_id, shop_name, quantity,
    cart_price_snapshot, current_price, available_quantity, listing_title,
    listing_public_code, cover_image_path, is_orderable, is_blocked
  )
  select
    ci.id,
    l.id,
    s.id,
    s.owner_id,
    s.name,
    ci.quantity,
    ci.price_cents_snapshot,
    l.price_cents,
    l.available_quantity,
    l.title,
    l.public_code,
    img.storage_path,
    (
      l.status = 'available'
      and cat.is_inquiry_only = false
      and not exists (
        select 1 from public.user_restrictions ur
        where ur.user_id = s.owner_id
          and ur.lifted_at is null
          and ur.restriction_type in ('seller_suspended', 'account_suspended')
      )
    ),
    exists (
      select 1 from public.user_blocks ub
      where (ub.blocker_id = v_caller_id and ub.blocked_id = s.owner_id)
         or (ub.blocker_id = s.owner_id and ub.blocked_id = v_caller_id)
    )
    from public.cart_items ci
    join public.carts c on c.id = ci.cart_id
    join public.listings l on l.id = ci.listing_id
    join public.shops s on s.id = l.shop_id
    join public.categories cat on cat.id = l.category_id
    left join public.listing_images img on img.id = l.cover_image_id
    where c.user_id = v_caller_id
      and ci.id = any(p_cart_item_ids);

  -- ===================== ownership/existence: every id must have matched =====================
  if (select count(*) from tmp_submit_items) <> (select count(distinct x) from unnest(p_cart_item_ids) x) then
    raise exception 'One or more selected cart items were not found.' using detail = 'CART_ITEM_NOT_FOUND';
  end if;

  -- ===================== listing eligibility (generic, non-revealing) =====================
  if exists (select 1 from tmp_submit_items t where not t.is_orderable) then
    raise exception 'One or more selected listings cannot be ordered.' using detail = 'LISTING_NOT_ORDERABLE';
  end if;

  -- ===================== own shop =====================
  if exists (select 1 from tmp_submit_items t where t.shop_owner_id = v_caller_id) then
    raise exception 'You cannot buy your own listing.' using detail = 'CANNOT_BUY_OWN_LISTING';
  end if;

  -- ===================== peer block =====================
  if exists (select 1 from tmp_submit_items t where t.is_blocked) then
    raise exception 'Interaction is blocked.' using detail = 'INTERACTION_BLOCKED';
  end if;

  -- ===================== quantity vs live availability (fail closed) =====================
  if exists (select 1 from tmp_submit_items t where t.quantity < 1 or t.quantity > t.available_quantity) then
    raise exception 'Requested quantity exceeds available stock.' using detail = 'QUANTITY_UNAVAILABLE';
  end if;

  -- ===================== price drift =====================
  if exists (select 1 from tmp_submit_items t where t.current_price <> t.cart_price_snapshot) then
    raise exception 'Price has changed since this item was added to cart.' using detail = 'PRICE_CHANGED';
  end if;

  -- ===================== buyer note normalization =====================
  v_buyer_note := nullif(btrim(p_buyer_note), '');
  if v_buyer_note is not null and char_length(v_buyer_note) > 1000 then
    raise exception 'Buyer note is too long.' using detail = 'SUBMISSION_INVALID';
  end if;

  -- ===================== fulfillment payload: structural, cast-safe validation =====================
  if p_fulfillment_choices is null or jsonb_typeof(p_fulfillment_choices) <> 'array' then
    raise exception 'Fulfillment choices must be a JSON array.' using detail = 'FULFILLMENT_INVALID';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_fulfillment_choices) as elem
    where jsonb_typeof(elem) <> 'object'
       or not (elem ? 'shop_id')
       or jsonb_typeof(elem -> 'shop_id') <> 'string'
       or (elem ->> 'shop_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or not (elem ? 'method')
       or jsonb_typeof(elem -> 'method') <> 'string'
       or (elem ->> 'method') not in ('meetup', 'pickup', 'local_delivery', 'shipping')
  ) then
    raise exception 'Fulfillment choices contain an invalid entry.' using detail = 'FULFILLMENT_INVALID';
  end if;

  if (select count(*) from jsonb_array_elements(p_fulfillment_choices)) <>
     (select count(distinct (elem ->> 'shop_id')) from jsonb_array_elements(p_fulfillment_choices) elem) then
    raise exception 'Duplicate fulfillment choice for the same shop.' using detail = 'FULFILLMENT_INVALID';
  end if;

  drop table if exists pg_temp.tmp_submit_shops;
  create temporary table tmp_submit_shops (
    shop_id uuid primary key,
    method public.fulfillment_method_enum not null,
    matched_order_id uuid,
    public_code text
  ) on commit drop;

  insert into tmp_submit_shops (shop_id, method)
  select (elem ->> 'shop_id')::uuid, (elem ->> 'method')::public.fulfillment_method_enum
    from jsonb_array_elements(p_fulfillment_choices) as elem;

  -- ===================== exact shop-set match =====================
  if exists (
    select 1 from tmp_submit_items t
    where not exists (select 1 from tmp_submit_shops f where f.shop_id = t.shop_id)
  ) then
    raise exception 'Missing fulfillment choice for a selected shop.' using detail = 'FULFILLMENT_INVALID';
  end if;

  if exists (
    select 1 from tmp_submit_shops f
    where not exists (select 1 from tmp_submit_items t where t.shop_id = f.shop_id)
  ) then
    raise exception 'Fulfillment choice given for a shop not in the selection.' using detail = 'FULFILLMENT_INVALID';
  end if;

  -- ===================== per-shop listing compatibility =====================
  if exists (
    select 1
    from tmp_submit_items t
    join tmp_submit_shops f on f.shop_id = t.shop_id
    where not exists (
      select 1 from public.listing_fulfillment_methods lfm
      where lfm.listing_id = t.listing_id and lfm.method = f.method
    )
  ) then
    raise exception 'A selected listing does not support the chosen fulfillment method.' using detail = 'FULFILLMENT_INVALID';
  end if;

  -- ===================== all validation passed: create one order per shop =====================
  for r in select f.shop_id, f.method from tmp_submit_shops f loop
    v_attempt := 0;
    loop
      v_attempt := v_attempt + 1;
      v_public_code := 'PSO-' || upper(encode(extensions.gen_random_bytes(8), 'hex'));
      begin
        insert into public.orders (public_code, buyer_id, shop_id, status, fulfillment_method, buyer_note)
        values (v_public_code, v_caller_id, r.shop_id, 'pending', r.method, v_buyer_note)
        returning id into v_new_order_id;
        exit;
      exception when unique_violation then
        get stacked diagnostics v_constraint_name = constraint_name;
        if v_constraint_name = 'orders_public_code_key' then
          if v_attempt >= 5 then
            raise exception 'Unable to generate a unique order code.' using detail = 'SUBMISSION_INVALID';
          end if;
        else
          raise;
        end if;
      end;
    end loop;

    -- ===================== notification: seller receives one per created order =====================
    select s.owner_id into v_shop_owner_id
      from public.shops s
      where s.id = r.shop_id;

    insert into public.notifications (recipient_id, type, actor_id, order_id, dedupe_key)
    select v_shop_owner_id, 'order_request_received', v_caller_id, v_new_order_id, v_new_order_id::text
    where not exists (
      select 1 from public.profiles p where p.id = v_shop_owner_id and p.deleted_at is not null
    )
    on conflict on constraint notifications_recipient_type_dedupe_key do nothing;

    update tmp_submit_shops set matched_order_id = v_new_order_id, public_code = v_public_code
      where tmp_submit_shops.shop_id = r.shop_id;
    update tmp_submit_items set matched_order_id = v_new_order_id
      where tmp_submit_items.shop_id = r.shop_id;
  end loop;

  -- ===================== order items: exactly one per selected cart item =====================
  insert into public.order_items (
    order_id, shop_id, listing_id, status, quantity,
    listing_title_snapshot, listing_public_code_snapshot, price_cents_snapshot,
    shop_name_snapshot, listing_cover_image_snapshot_path
  )
  select
    t.matched_order_id, t.shop_id, t.listing_id, 'pending', t.quantity,
    t.listing_title, t.listing_public_code, t.current_price,
    t.shop_name, t.cover_image_path
    from tmp_submit_items t;

  -- ===================== cart cleanup: only the selected, now-submitted rows =====================
  delete from public.cart_items ci
    where ci.id = any(p_cart_item_ids);

  -- ===================== one row per created order, deterministic order =====================
  return query
    select
      f.matched_order_id as order_id,
      f.shop_id,
      f.public_code as order_public_code,
      agg.item_count,
      agg.total_cents,
      'pending'::public.order_status_enum as status
    from tmp_submit_shops f
    join lateral (
      select count(*)::integer as item_count,
             sum(t.current_price * t.quantity)::bigint as total_cents
      from tmp_submit_items t
      where t.shop_id = f.shop_id
    ) agg on true
    order by f.shop_id;
end;
$$;

-- ============================================================
-- accept_order_items (+ order_accepted / order_declined / order_changes_pending)
-- ============================================================
create or replace function public.accept_order_items(p_order_id uuid, p_accepted_item_ids uuid[], p_declined_item_ids uuid[])
returns table (order_id uuid, order_status public.order_status_enum, was_already_processed boolean, accepted_item_ids uuid[], declined_item_ids uuid[], stock_conflict_item_ids uuid[])
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_order_status public.order_status_enum;
  v_order_shop_id uuid;
  v_order_buyer_id uuid;
  v_shop_owner_id uuid;

  v_accepted_ids uuid[];
  v_declined_ids uuid[];
  v_all_decided_ids uuid[];
  v_pending_ids uuid[];
  v_bad_ids uuid[];
  v_missing_ids uuid[];

  v_stock_conflict_ids uuid[] := '{}';
  v_final_accepted_ids uuid[];
  v_final_declined_ids uuid[];
  v_conflict_batch uuid[];

  v_ok_listing_ids uuid[] := '{}';
  v_ok_listing_qty integer[] := '{}';
  v_ok_listing_new_reserved integer[] := '{}';
  v_ok_listing_new_available integer[] := '{}';
  v_ok_listing_status public.listing_status_enum[] := '{}';

  v_listing_id uuid;
  v_agg_qty integer;
  v_stock_qty integer;
  v_reserved_qty integer;
  v_avail_qty integer;
  v_listing_status public.listing_status_enum;

  v_accepted_count integer;
  v_total_count integer;
  v_outcome_status public.order_status_enum;
  v_note text;

  v_derived_accepted uuid[];
  v_derived_declined uuid[];

  i integer;
begin
  -- ===================== authentication =====================
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'Authentication required.' using detail = 'NOT_AUTHENTICATED';
  end if;

  -- ===================== lock order row (universal serialization point) =====================
  select o.status, o.shop_id, o.buyer_id
    into v_order_status, v_order_shop_id, v_order_buyer_id
    from public.orders o
    where o.id = p_order_id
    for update;

  if not found then
    raise exception 'Order not found.' using detail = 'ORDER_NOT_FOUND';
  end if;

  -- ===================== authorization: caller must own the order's shop =====================
  select s.owner_id into v_shop_owner_id
    from public.shops s
    where s.id = v_order_shop_id;

  if v_shop_owner_id is distinct from v_caller then
    raise exception 'You do not have permission to act on this order.' using detail = 'NOT_ORDER_SELLER';
  end if;

  -- ===================== idempotency: only a pending order may be processed =====================
  if v_order_status <> 'pending' then
    select coalesce(array_agg(oi.id) filter (where oi.status = 'accepted'), '{}'),
           coalesce(array_agg(oi.id) filter (where oi.status = 'declined'), '{}')
      into v_derived_accepted, v_derived_declined
      from public.order_items oi
      where oi.order_id = p_order_id;

    return query
      select p_order_id, v_order_status, true, v_derived_accepted, v_derived_declined, '{}'::uuid[];
    return;
  end if;

  -- ===================== normalize input =====================
  v_accepted_ids := coalesce(p_accepted_item_ids, '{}');
  v_declined_ids := coalesce(p_declined_item_ids, '{}');

  if exists (select 1 from unnest(v_accepted_ids) u where u is null)
     or exists (select 1 from unnest(v_declined_ids) u where u is null) then
    raise exception 'Item decision arrays may not contain a null item id.' using detail = 'INVALID_ITEM_DECISIONS';
  end if;

  -- duplicate ids within either array, or the same id in both arrays
  if (select count(*) from unnest(v_accepted_ids)) <> (select count(distinct u) from unnest(v_accepted_ids) u)
     or (select count(*) from unnest(v_declined_ids)) <> (select count(distinct u) from unnest(v_declined_ids) u)
     or exists (
       select 1 from unnest(v_accepted_ids) a join unnest(v_declined_ids) d on a = d
     ) then
    raise exception 'Duplicate or overlapping item decisions are not allowed.' using detail = 'DUPLICATE_ITEM_DECISION';
  end if;

  v_all_decided_ids := v_accepted_ids || v_declined_ids;

  -- ===================== lock this order's order_items rows =====================
  perform 1 from public.order_items oi where oi.order_id = p_order_id order by oi.id for update;

  select coalesce(array_agg(oi.id order by oi.id), '{}') into v_pending_ids
    from public.order_items oi
    where oi.order_id = p_order_id and oi.status = 'pending';

  v_total_count := coalesce(array_length(v_pending_ids, 1), 0);
  if v_total_count = 0 then
    raise exception 'Order has no pending items to decide.' using detail = 'INVALID_ITEM_DECISIONS';
  end if;

  -- every decided id must belong to this order
  select array_agg(x) into v_bad_ids
    from unnest(v_all_decided_ids) x
    where not exists (
      select 1 from public.order_items oi where oi.id = x and oi.order_id = p_order_id
    );
  if v_bad_ids is not null then
    raise exception 'One or more item IDs do not belong to this order.' using detail = 'ITEM_NOT_IN_ORDER';
  end if;

  -- every decided id must currently be pending
  select array_agg(x) into v_bad_ids
    from unnest(v_all_decided_ids) x
    join public.order_items oi on oi.id = x and oi.order_id = p_order_id
    where oi.status <> 'pending';
  if v_bad_ids is not null then
    raise exception 'One or more items have already been decided.' using detail = 'ITEM_ALREADY_DECIDED';
  end if;

  -- every pending item must receive an explicit decision (completeness rule)
  select array_agg(x) into v_missing_ids
    from unnest(v_pending_ids) x
    where not (x = any(v_all_decided_ids));
  if v_missing_ids is not null then
    raise exception 'Every pending item must receive an explicit decision.' using detail = 'INVALID_ITEM_DECISIONS';
  end if;

  -- ===================== stock-conflict items with a NULL listing_id =====================
  select array_agg(oi.id) into v_conflict_batch
    from public.order_items oi
    where oi.id = any(v_accepted_ids) and oi.listing_id is null;
  if v_conflict_batch is not null then
    v_stock_conflict_ids := v_stock_conflict_ids || v_conflict_batch;
  end if;

  -- ===================== lock referenced listings in deterministic order, classify =====================
  for v_listing_id, v_agg_qty in
    select oi.listing_id, sum(oi.quantity)::integer
      from public.order_items oi
      where oi.id = any(v_accepted_ids) and oi.listing_id is not null
      group by oi.listing_id
      order by oi.listing_id
  loop
    select l.stock_quantity, l.reserved_quantity, l.available_quantity, l.status
      into v_stock_qty, v_reserved_qty, v_avail_qty, v_listing_status
      from public.listings l
      where l.id = v_listing_id
      for update;

    if not found
       or v_listing_status in ('draft', 'archived', 'sold')
       or v_avail_qty < v_agg_qty then
      select array_agg(oi.id) into v_conflict_batch
        from public.order_items oi
        where oi.id = any(v_accepted_ids) and oi.listing_id = v_listing_id;
      v_stock_conflict_ids := v_stock_conflict_ids || v_conflict_batch;
      continue;
    end if;

    v_ok_listing_ids := v_ok_listing_ids || v_listing_id;
    v_ok_listing_qty := v_ok_listing_qty || v_agg_qty;
    v_ok_listing_new_reserved := v_ok_listing_new_reserved || (v_reserved_qty + v_agg_qty);
    v_ok_listing_new_available := v_ok_listing_new_available || (v_avail_qty - v_agg_qty);
    v_ok_listing_status := v_ok_listing_status || v_listing_status;
  end loop;

  -- ===================== final item classification =====================
  select coalesce(array_agg(oi.id), '{}') into v_final_accepted_ids
    from public.order_items oi
    where oi.id = any(v_accepted_ids) and not (oi.id = any(v_stock_conflict_ids));

  select coalesce(array_agg(x), '{}') into v_final_declined_ids
    from unnest(v_pending_ids) x
    where not (x = any(v_final_accepted_ids));

  v_accepted_count := coalesce(array_length(v_final_accepted_ids, 1), 0);

  if v_accepted_count = v_total_count then
    v_outcome_status := 'accepted';
  elsif v_accepted_count = 0 then
    v_outcome_status := 'declined';
  else
    v_outcome_status := 'changes_pending';
  end if;

  v_note := case
    when coalesce(array_length(v_stock_conflict_ids, 1), 0) > 0
      then format('%s item(s) auto-declined due to insufficient stock or an unavailable listing.', array_length(v_stock_conflict_ids, 1))
    else null
  end;

  -- ===================== item status writes (all outcomes) =====================
  update public.order_items set status = 'accepted' where id = any(v_final_accepted_ids);
  update public.order_items set status = 'declined' where id = any(v_final_declined_ids);

  -- ===================== outcome-specific mutation =====================
  if v_outcome_status = 'accepted' then
    -- reservations first (the ledger is authoritative), then the cached aggregate
    insert into public.inventory_reservations (listing_id, order_id, order_item_id, shop_id, quantity)
      select oi.listing_id, p_order_id, oi.id, v_order_shop_id, oi.quantity
        from public.order_items oi
        where oi.id = any(v_final_accepted_ids);

    for i in 1 .. coalesce(array_length(v_ok_listing_ids, 1), 0) loop
      update public.listings
        set reserved_quantity = v_ok_listing_new_reserved[i],
            status = case
              when v_ok_listing_new_available[i] = 0 and v_ok_listing_status[i] in ('available', 'reserved')
                then 'reserved'::public.listing_status_enum
              else status
            end
        where id = v_ok_listing_ids[i];
    end loop;
  end if;

  -- (no listing/reservation mutation for 'declined' or 'changes_pending' outcomes)

  -- lifecycle timestamps: accepted_at is set only when this call's resolved
  -- outcome is 'accepted', declined_at only when it is 'declined'; the
  -- 'changes_pending' outcome touches neither (both CASE branches
  -- preserve the column's current value, a no-op for a pending-origin
  -- order where both are already NULL).
  update public.orders
    set status = v_outcome_status,
        accepted_at = case when v_outcome_status = 'accepted' then now() else accepted_at end,
        declined_at = case when v_outcome_status = 'declined' then now() else declined_at end
    where id = p_order_id;

  insert into public.order_status_history (order_id, from_status, to_status, changed_by, note)
    values (p_order_id, 'pending', v_outcome_status, v_caller, v_note);

  -- ===================== notification: buyer receives outcome-specific event =====================
  insert into public.notifications (recipient_id, type, actor_id, order_id, dedupe_key)
  select
    v_order_buyer_id,
    case v_outcome_status
      when 'accepted' then 'order_accepted'::public.notification_type_enum
      when 'declined' then 'order_declined'::public.notification_type_enum
      else 'order_changes_pending'::public.notification_type_enum
    end,
    v_caller,
    p_order_id,
    p_order_id::text || ':' || v_outcome_status::text
  where not exists (
    select 1 from public.profiles p where p.id = v_order_buyer_id and p.deleted_at is not null
  )
  on conflict on constraint notifications_recipient_type_dedupe_key do nothing;

  return query
    select p_order_id, v_outcome_status, false, v_final_accepted_ids, v_final_declined_ids, v_stock_conflict_ids;
end;
$$;

-- ============================================================
-- mark_order_ready (+ order_ready)
-- ============================================================
create or replace function public.mark_order_ready(p_order_id uuid)
returns table (order_id uuid, order_status public.order_status_enum, was_already_ready boolean, ready_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_order_status public.order_status_enum;
  v_order_shop_id uuid;
  v_order_buyer_id uuid;
  v_shop_owner_id uuid;
  v_existing_ready_at timestamptz;
  v_new_ready_at timestamptz;
begin
  -- ===================== authentication =====================
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'Authentication required.' using detail = 'NOT_AUTHENTICATED';
  end if;

  -- ===================== lock order row (universal serialization point) =====================
  select o.status, o.shop_id, o.ready_at, o.buyer_id
    into v_order_status, v_order_shop_id, v_existing_ready_at, v_order_buyer_id
    from public.orders o
    where o.id = p_order_id
    for update;

  if not found then
    raise exception 'Order not found.' using detail = 'ORDER_NOT_FOUND';
  end if;

  -- ===================== authorization: caller must own the order's shop =====================
  select s.owner_id into v_shop_owner_id
    from public.shops s
    where s.id = v_order_shop_id;

  if v_shop_owner_id is distinct from v_caller then
    raise exception 'You do not have permission to act on this order.' using detail = 'NOT_ORDER_SELLER';
  end if;

  -- ===================== idempotency: already-ready is success, zero mutation =====================
  if v_order_status = 'ready' then
    return query
      select p_order_id, v_order_status, true, v_existing_ready_at;
    return;
  end if;

  -- ===================== only accepted orders may progress to ready =====================
  if v_order_status <> 'accepted' then
    raise exception 'Order is not in a state that can be marked ready.' using detail = 'ORDER_NOT_READYABLE';
  end if;

  -- ===================== cancellation-request freeze (approved progression blocker, not corruption handling) =====================
  if exists (
    select 1
    from public.order_cancellation_requests ocr
    where ocr.order_id = p_order_id and ocr.status = 'pending'
  ) then
    raise exception 'A pending cancellation request must be resolved before this order can progress.' using detail = 'CANCELLATION_REQUEST_PENDING';
  end if;

  -- ===================== parent progression: status + lifecycle timestamp together, nothing else touched =====================
  v_new_ready_at := now();

  update public.orders as o
    set status = 'ready',
        ready_at = v_new_ready_at
    where o.id = p_order_id;

  -- ===================== exactly one parent history row =====================
  insert into public.order_status_history (order_id, from_status, to_status, changed_by, note)
    values (p_order_id, 'accepted', 'ready', v_caller, null);

  -- ===================== notification: buyer receives ready event =====================
  insert into public.notifications (recipient_id, type, actor_id, order_id, dedupe_key)
  select v_order_buyer_id, 'order_ready', v_caller, p_order_id, p_order_id::text || ':ready'
  where not exists (
    select 1 from public.profiles p where p.id = v_order_buyer_id and p.deleted_at is not null
  )
  on conflict on constraint notifications_recipient_type_dedupe_key do nothing;

  return query
    select p_order_id, 'ready'::public.order_status_enum, false, v_new_ready_at;
end;
$$;

-- ============================================================
-- mark_order_handed_over_or_shipped (+ order_handed_over_or_shipped)
-- ============================================================
create or replace function public.mark_order_handed_over_or_shipped(p_order_id uuid)
returns table (order_id uuid, order_status public.order_status_enum, was_already_handed_over_or_shipped boolean, handed_over_or_shipped_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_order_status public.order_status_enum;
  v_order_shop_id uuid;
  v_order_buyer_id uuid;
  v_shop_owner_id uuid;
  v_existing_handed_over_or_shipped_at timestamptz;
  v_new_handed_over_or_shipped_at timestamptz;
begin
  -- ===================== authentication =====================
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'Authentication required.' using detail = 'NOT_AUTHENTICATED';
  end if;

  -- ===================== lock order row (universal serialization point) =====================
  select o.status, o.shop_id, o.handed_over_or_shipped_at, o.buyer_id
    into v_order_status, v_order_shop_id, v_existing_handed_over_or_shipped_at, v_order_buyer_id
    from public.orders o
    where o.id = p_order_id
    for update;

  if not found then
    raise exception 'Order not found.' using detail = 'ORDER_NOT_FOUND';
  end if;

  -- ===================== authorization: caller must own the order's shop =====================
  select s.owner_id into v_shop_owner_id
    from public.shops s
    where s.id = v_order_shop_id;

  if v_shop_owner_id is distinct from v_caller then
    raise exception 'You do not have permission to act on this order.' using detail = 'NOT_ORDER_SELLER';
  end if;

  -- ===================== idempotency: already-handed-over/shipped is success, zero mutation =====================
  if v_order_status = 'handed_over_or_shipped' then
    return query
      select p_order_id, v_order_status, true, v_existing_handed_over_or_shipped_at;
    return;
  end if;

  -- ===================== only ready orders may progress to handed_over_or_shipped =====================
  if v_order_status <> 'ready' then
    raise exception 'Order is not in a state that can be marked handed over or shipped.' using detail = 'ORDER_NOT_HANDOVERABLE';
  end if;

  -- ===================== cancellation-request freeze (approved progression blocker, not corruption handling) =====================
  if exists (
    select 1
    from public.order_cancellation_requests ocr
    where ocr.order_id = p_order_id and ocr.status = 'pending'
  ) then
    raise exception 'A pending cancellation request must be resolved before this order can progress.' using detail = 'CANCELLATION_REQUEST_PENDING';
  end if;

  -- ===================== parent progression: status + lifecycle timestamp together, nothing else touched =====================
  v_new_handed_over_or_shipped_at := now();

  update public.orders as o
    set status = 'handed_over_or_shipped',
        handed_over_or_shipped_at = v_new_handed_over_or_shipped_at
    where o.id = p_order_id;

  -- ===================== exactly one parent history row =====================
  insert into public.order_status_history (order_id, from_status, to_status, changed_by, note)
    values (p_order_id, 'ready', 'handed_over_or_shipped', v_caller, null);

  -- ===================== notification: buyer receives handed-over/shipped event =====================
  insert into public.notifications (recipient_id, type, actor_id, order_id, dedupe_key)
  select v_order_buyer_id, 'order_handed_over_or_shipped', v_caller, p_order_id, p_order_id::text || ':handed_over_or_shipped'
  where not exists (
    select 1 from public.profiles p where p.id = v_order_buyer_id and p.deleted_at is not null
  )
  on conflict on constraint notifications_recipient_type_dedupe_key do nothing;

  return query
    select p_order_id, 'handed_over_or_shipped'::public.order_status_enum, false, v_new_handed_over_or_shipped_at;
end;
$$;

-- ============================================================
-- complete_order (+ order_completed to buyer AND seller, actor NULL)
-- ============================================================
create or replace function public.complete_order(p_order_id uuid)
returns table (order_id uuid, order_status public.order_status_enum, was_already_completed boolean, completed_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_status public.order_status_enum;
  v_existing_completed_at timestamptz;
  v_now timestamptz;
  v_order_buyer_id uuid;
  v_order_shop_id uuid;
  v_shop_owner_id uuid;

  v_accepted_count integer;

  v_listing_ids uuid[] := '{}';
  v_agg_qtys integer[] := '{}';
  v_new_stock integer[] := '{}';
  v_new_reserved integer[] := '{}';
  v_new_status public.listing_status_enum[] := '{}';

  v_listing_id uuid;
  v_agg_qty integer;
  v_stock_qty integer;
  v_reserved_qty integer;
  v_listing_status public.listing_status_enum;
  v_other_active_exists boolean;

  i integer;
begin
  -- ===================== lock order row (universal serialization point; service-role only, no auth.uid()) =====================
  select o.status, o.completed_at, o.buyer_id, o.shop_id
    into v_order_status, v_existing_completed_at, v_order_buyer_id, v_order_shop_id
    from public.orders o
    where o.id = p_order_id
    for update;

  if not found then
    raise exception 'Order not found.' using detail = 'ORDER_NOT_FOUND';
  end if;

  -- ===================== idempotency: already-completed is success, zero mutation, checked before any deeper lock =====================
  if v_order_status = 'completed' then
    return query
      select p_order_id, v_order_status, true, v_existing_completed_at;
    return;
  end if;

  -- ===================== only received_confirmed orders may progress to completed =====================
  if v_order_status <> 'received_confirmed' then
    raise exception 'Order is not in a state that can be completed.' using detail = 'ORDER_NOT_COMPLETABLE';
  end if;

  -- ===================== transaction-stable time, captured after eligibility, before deeper locking/mutation =====================
  v_now := now();

  -- ===================== lock this order's order_items (their locked status/quantity back every check below) =====================
  perform 1 from public.order_items oi where oi.order_id = p_order_id order by oi.id for update;

  -- ===================== at least one accepted item is required =====================
  select count(*) into v_accepted_count
    from public.order_items oi
    where oi.order_id = p_order_id and oi.status = 'accepted';

  if v_accepted_count = 0 then
    raise exception 'Order has no accepted items to complete.' using detail = 'RESERVATION_STATE_INVALID';
  end if;

  -- ===================== lock this order's active reservations =====================
  perform 1 from public.inventory_reservations ir where ir.order_id = p_order_id and ir.status = 'active' order by ir.id for update;

  -- ===================== coverage guard: every accepted item must have exactly one matching active reservation =====================
  if exists (
    select 1
    from public.order_items oi
    where oi.order_id = p_order_id
      and oi.status = 'accepted'
      and not exists (
        select 1
        from public.inventory_reservations ir
        where ir.order_item_id = oi.id
          and ir.status = 'active'
          and ir.quantity = oi.quantity
      )
  ) then
    raise exception 'An accepted item is missing a valid active reservation.' using detail = 'RESERVATION_STATE_INVALID';
  end if;

  -- ===================== consistency guard: every active reservation for this order must belong to an accepted item with matching quantity =====================
  -- ownership (order/shop/listing) is already structurally guaranteed by
  -- inventory_reservations_order_item_ownership_fkey; only status and
  -- quantity need checking here
  if exists (
    select 1
    from public.inventory_reservations ir
    join public.order_items oi on oi.id = ir.order_item_id
    where ir.order_id = p_order_id
      and ir.status = 'active'
      and (oi.status <> 'accepted' or ir.quantity <> oi.quantity)
  ) then
    raise exception 'Reservation state is inconsistent with order items.' using detail = 'RESERVATION_STATE_INVALID';
  end if;

  -- ===================== aggregate consumed quantity per listing from this order's locked active reservations =====================
  for v_listing_id, v_agg_qty in
    select ir.listing_id, sum(ir.quantity)::integer
      from public.inventory_reservations ir
      where ir.order_id = p_order_id and ir.status = 'active'
      group by ir.listing_id
      order by ir.listing_id
  loop
    v_listing_ids := v_listing_ids || v_listing_id;
    v_agg_qtys := v_agg_qtys || v_agg_qty;
  end loop;

  -- ===================== lock affected listings in deterministic order, validate arithmetic, compute resulting values =====================
  for i in 1 .. coalesce(array_length(v_listing_ids, 1), 0) loop
    select l.stock_quantity, l.reserved_quantity, l.status
      into v_stock_qty, v_reserved_qty, v_listing_status
      from public.listings l
      where l.id = v_listing_ids[i]
      for update;

    if not found then
      raise exception 'Reserved listing no longer exists.' using detail = 'RESERVATION_STATE_INVALID';
    end if;

    if v_stock_qty < v_agg_qtys[i] or v_reserved_qty < v_agg_qtys[i] then
      raise exception 'Listing stock/reserved quantity is insufficient to complete.' using detail = 'RESERVATION_STATE_INVALID';
    end if;

    if (v_stock_qty - v_agg_qtys[i]) < (v_reserved_qty - v_agg_qtys[i]) then
      raise exception 'Resulting listing quantities would be inconsistent.' using detail = 'RESERVATION_STATE_INVALID';
    end if;

    v_new_stock := v_new_stock || (v_stock_qty - v_agg_qtys[i]);
    v_new_reserved := v_new_reserved || (v_reserved_qty - v_agg_qtys[i]);

    -- status algorithm: only 'reserved' with no other order's active
    -- reservation remaining transitions to 'sold'; every other current
    -- status (available/paused/archived/sold/draft) is left untouched
    select exists (
      select 1
      from public.inventory_reservations ir2
      where ir2.listing_id = v_listing_ids[i]
        and ir2.status = 'active'
        and ir2.order_id <> p_order_id
    ) into v_other_active_exists;

    v_new_status := v_new_status || (
      case
        when v_listing_status = 'reserved' and not v_other_active_exists
          then 'sold'::public.listing_status_enum
        else v_listing_status
      end
    );
  end loop;

  -- ===================== consume this order's active reservations (the ledger is authoritative, updated before the cached aggregates) =====================
  update public.inventory_reservations ir
    set status = 'consumed',
        resolved_at = v_now
    where ir.order_id = p_order_id and ir.status = 'active';

  -- ===================== apply computed stock/reserved/status per listing =====================
  for i in 1 .. coalesce(array_length(v_listing_ids, 1), 0) loop
    update public.listings
      set stock_quantity = v_new_stock[i],
          reserved_quantity = v_new_reserved[i],
          status = v_new_status[i]
      where id = v_listing_ids[i];
  end loop;

  -- ===================== parent completion: status + lifecycle timestamp together, nothing else touched =====================
  update public.orders as o
    set status = 'completed',
        completed_at = v_now
    where o.id = p_order_id;

  -- ===================== exactly one parent history row, last mutation for late-failure rollback testability =====================
  insert into public.order_status_history (order_id, from_status, to_status, changed_by, note)
    values (p_order_id, 'received_confirmed', 'completed', null, null);

  -- ===================== notifications: both buyer and seller receive completion event =====================
  -- actor is NULL: this function has no auth.uid() (trusted/system-callable
  -- path per its own existing comment), so fabricating an actor would be
  -- incorrect rather than merely incomplete.
  select s.owner_id into v_shop_owner_id
    from public.shops s
    where s.id = v_order_shop_id;

  insert into public.notifications (recipient_id, type, actor_id, order_id, dedupe_key)
  select v_order_buyer_id, 'order_completed', null, p_order_id, p_order_id::text || ':completed'
  where not exists (
    select 1 from public.profiles p where p.id = v_order_buyer_id and p.deleted_at is not null
  )
  on conflict on constraint notifications_recipient_type_dedupe_key do nothing;

  insert into public.notifications (recipient_id, type, actor_id, order_id, dedupe_key)
  select v_shop_owner_id, 'order_completed', null, p_order_id, p_order_id::text || ':completed'
  where not exists (
    select 1 from public.profiles p where p.id = v_shop_owner_id and p.deleted_at is not null
  )
  on conflict on constraint notifications_recipient_type_dedupe_key do nothing;

  return query
    select p_order_id, 'completed'::public.order_status_enum, false, v_now;
end;
$$;

-- ============================================================
-- cancel_accepted_order (+ order_cancelled)
-- ============================================================
create or replace function public.cancel_accepted_order(p_order_id uuid, p_reason text)
returns table (order_id uuid, order_status public.order_status_enum, was_already_cancelled boolean, cancelled_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_order_status public.order_status_enum;
  v_order_shop_id uuid;
  v_shop_owner_id uuid;
  v_existing_cancelled_at timestamptz;
  v_order_buyer_id uuid;
  v_reason text;
  v_req_id uuid;
  v_from_status public.order_status_enum;

  v_listing_ids uuid[] := '{}';
  v_agg_qtys integer[] := '{}';
  v_new_reserved integer[] := '{}';
  v_new_available integer[] := '{}';
  v_old_status public.listing_status_enum[] := '{}';

  v_listing_id uuid;
  v_agg_qty integer;
  v_stock_qty integer;
  v_reserved_qty integer;
  v_listing_status public.listing_status_enum;

  i integer;
begin
  -- ===================== authentication =====================
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'Authentication required.' using detail = 'NOT_AUTHENTICATED';
  end if;

  -- ===================== lock order row (universal serialization point) =====================
  select o.status, o.shop_id, o.cancelled_at, o.buyer_id
    into v_order_status, v_order_shop_id, v_existing_cancelled_at, v_order_buyer_id
    from public.orders o
    where o.id = p_order_id
    for update;

  if not found then
    raise exception 'Order not found.' using detail = 'ORDER_NOT_FOUND';
  end if;

  -- ===================== authorization: caller must own the order's shop =====================
  select s.owner_id into v_shop_owner_id
    from public.shops s
    where s.id = v_order_shop_id;

  if v_shop_owner_id is distinct from v_caller then
    raise exception 'You do not have permission to act on this order.' using detail = 'NOT_ORDER_SELLER';
  end if;

  -- ===================== idempotency: already-cancelled is success, zero mutation, origin-agnostic =====================
  if v_order_status = 'cancelled' then
    return query
      select p_order_id, v_order_status, true, v_existing_cancelled_at;
    return;
  end if;

  -- ===================== only accepted/ready orders may be seller-cancelled here =====================
  if v_order_status not in ('accepted', 'ready') then
    raise exception 'Order is not in a state that can be directly cancelled.' using detail = 'ORDER_NOT_CANCELLABLE';
  end if;

  -- ===================== reason validation (after idempotency/eligibility, before any lock beyond orders) =====================
  v_reason := btrim(p_reason);
  if v_reason is null or length(v_reason) = 0 then
    raise exception 'A cancellation reason is required.' using detail = 'INVALID_CANCELLATION_REASON';
  end if;

  v_from_status := v_order_status;

  -- ===================== lock the current pending buyer cancellation request, if any =====================
  select ocr.id into v_req_id
    from public.order_cancellation_requests ocr
    where ocr.order_id = p_order_id and ocr.status = 'pending'
    for update;

  -- ===================== lock this order's order_items (their locked status/quantity back the reservation check below) =====================
  perform 1 from public.order_items oi where oi.order_id = p_order_id order by oi.id for update;

  -- ===================== lock this order's active reservations =====================
  perform 1 from public.inventory_reservations ir where ir.order_id = p_order_id and ir.status = 'active' order by ir.id for update;

  -- ===================== reservation/item consistency guard =====================
  -- ownership is already structurally guaranteed by inventory_reservations_order_item_ownership_fkey;
  -- only status and quantity need checking here
  if exists (
    select 1
    from public.inventory_reservations ir
    join public.order_items oi on oi.id = ir.order_item_id
    where ir.order_id = p_order_id
      and ir.status = 'active'
      and (oi.status <> 'accepted' or ir.quantity <> oi.quantity)
  ) then
    raise exception 'Reservation state is inconsistent with order items.' using detail = 'RESERVATION_STATE_INVALID';
  end if;

  -- ===================== aggregate release quantity per listing =====================
  for v_listing_id, v_agg_qty in
    select ir.listing_id, sum(ir.quantity)::integer
      from public.inventory_reservations ir
      where ir.order_id = p_order_id and ir.status = 'active'
      group by ir.listing_id
      order by ir.listing_id
  loop
    v_listing_ids := v_listing_ids || v_listing_id;
    v_agg_qtys := v_agg_qtys || v_agg_qty;
  end loop;

  -- ===================== lock affected listings in deterministic order, validate, compute resulting values =====================
  for i in 1 .. coalesce(array_length(v_listing_ids, 1), 0) loop
    select l.stock_quantity, l.reserved_quantity, l.status
      into v_stock_qty, v_reserved_qty, v_listing_status
      from public.listings l
      where l.id = v_listing_ids[i]
      for update;

    if v_reserved_qty < v_agg_qtys[i] then
      raise exception 'Listing reserved quantity is insufficient to release.' using detail = 'RESERVATION_STATE_INVALID';
    end if;

    v_new_reserved := v_new_reserved || (v_reserved_qty - v_agg_qtys[i]);
    v_new_available := v_new_available || (v_stock_qty - (v_reserved_qty - v_agg_qtys[i]));
    v_old_status := v_old_status || v_listing_status;
  end loop;

  -- ===================== release reservations (the ledger is authoritative, updated before the cached aggregate) =====================
  update public.inventory_reservations ir
    set status = 'released',
        resolved_at = now()
    where ir.order_id = p_order_id and ir.status = 'active';

  -- ===================== update the cached listing aggregates and reopen visibility only where safe =====================
  for i in 1 .. coalesce(array_length(v_listing_ids, 1), 0) loop
    update public.listings
      set reserved_quantity = v_new_reserved[i],
          status = case
            when v_old_status[i] = 'reserved' and v_new_available[i] > 0
              then 'available'::public.listing_status_enum
            else status
          end
      where id = v_listing_ids[i];
  end loop;

  -- ===================== parent order cancellation: status + lifecycle timestamp together, nothing else touched =====================
  update public.orders
    set status = 'cancelled',
        cancelled_at = now()
    where id = p_order_id;

  -- ===================== auto-confirm the pending buyer cancellation request, if one existed =====================
  if v_req_id is not null then
    update public.order_cancellation_requests
      set status = 'confirmed',
          reviewed_by = v_caller,
          reviewed_at = now(),
          review_note = v_reason
      where id = v_req_id;
  end if;

  -- ===================== exactly one parent history row, carrying the seller's reason =====================
  insert into public.order_status_history (order_id, from_status, to_status, changed_by, note)
    values (p_order_id, v_from_status, 'cancelled', v_caller, v_reason);

  -- ===================== notification: buyer receives cancellation event =====================
  insert into public.notifications (recipient_id, type, actor_id, order_id, dedupe_key)
  select v_order_buyer_id, 'order_cancelled', v_caller, p_order_id, p_order_id::text || ':cancelled'
  where not exists (
    select 1 from public.profiles p where p.id = v_order_buyer_id and p.deleted_at is not null
  )
  on conflict on constraint notifications_recipient_type_dedupe_key do nothing;

  return query
    select p_order_id, 'cancelled'::public.order_status_enum, false, now();
end;
$$;

-- ============================================================
-- request_order_cancellation (+ order_cancellation_requested)
-- ============================================================
create or replace function public.request_order_cancellation(p_order_id uuid, p_reason text)
returns table (request_id uuid, order_id uuid, request_status public.cancellation_request_status_enum, was_already_pending boolean, requested_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_order_status public.order_status_enum;
  v_order_buyer_id uuid;
  v_order_shop_id uuid;
  v_shop_owner_id uuid;
  v_reason text;
  v_existing_id uuid;
  v_existing_status public.cancellation_request_status_enum;
  v_existing_requested_at timestamptz;
  v_new_id uuid;
  v_new_requested_at timestamptz;
begin
  -- ===================== authentication =====================
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'Authentication required.' using detail = 'NOT_AUTHENTICATED';
  end if;

  -- ===================== lock order row (universal serialization point) =====================
  select o.status, o.buyer_id, o.shop_id
    into v_order_status, v_order_buyer_id, v_order_shop_id
    from public.orders o
    where o.id = p_order_id
    for update;

  if not found then
    raise exception 'Order not found.' using detail = 'ORDER_NOT_FOUND';
  end if;

  -- ===================== authorization: caller must be the order's buyer =====================
  if v_order_buyer_id is distinct from v_caller then
    raise exception 'You do not have permission to act on this order.' using detail = 'NOT_ORDER_BUYER';
  end if;

  -- ===================== only accepted/ready orders may open a cancellation request =====================
  if v_order_status not in ('accepted', 'ready') then
    raise exception 'Order is not in a state a cancellation request can be created for.' using detail = 'ORDER_NOT_CANCELLABLE';
  end if;

  -- ===================== reason validation (before the existing-pending-request check) =====================
  v_reason := btrim(p_reason);
  if v_reason is null or length(v_reason) = 0 then
    raise exception 'A cancellation reason is required.' using detail = 'INVALID_CANCELLATION_REASON';
  end if;

  -- ===================== idempotency: an existing pending request wins unchanged =====================
  select ocr.id, ocr.status, ocr.requested_at
    into v_existing_id, v_existing_status, v_existing_requested_at
    from public.order_cancellation_requests ocr
    where ocr.order_id = p_order_id and ocr.status = 'pending';

  if found then
    return query
      select v_existing_id, p_order_id, v_existing_status, true, v_existing_requested_at;
    return;
  end if;

  -- ===================== fresh request =====================
  -- fix: the target alias "ocr" lets RETURNING unambiguously reference the
  -- inserted row's own columns instead of colliding with this function's
  -- identically-named "requested_at" output column.
  insert into public.order_cancellation_requests as ocr (order_id, requested_by, status, reason)
    values (p_order_id, v_caller, 'pending', v_reason)
    returning ocr.id, ocr.requested_at into v_new_id, v_new_requested_at;

  -- ===================== notification: seller receives the new cancellation request =====================
  select s.owner_id into v_shop_owner_id
    from public.shops s
    where s.id = v_order_shop_id;

  insert into public.notifications (recipient_id, type, actor_id, order_id, dedupe_key)
  select v_shop_owner_id, 'order_cancellation_requested', v_caller, p_order_id, v_new_id::text
  where not exists (
    select 1 from public.profiles p where p.id = v_shop_owner_id and p.deleted_at is not null
  )
  on conflict on constraint notifications_recipient_type_dedupe_key do nothing;

  return query
    select v_new_id, p_order_id, 'pending'::public.cancellation_request_status_enum, false, v_new_requested_at;
end;
$$;

-- ============================================================
-- resolve_order_cancellation (+ order_cancellation_rejected / order_cancelled)
-- ============================================================
create or replace function public.resolve_order_cancellation(p_request_id uuid, p_confirm boolean, p_review_note text)
returns table (request_id uuid, order_id uuid, request_status public.cancellation_request_status_enum, order_status public.order_status_enum, was_already_resolved boolean, reviewed_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;

  v_routed_order_id uuid;
  v_order_id uuid;
  v_order_status public.order_status_enum;
  v_order_shop_id uuid;
  v_order_buyer_id uuid;
  v_shop_owner_id uuid;

  v_request_order_id uuid;
  v_request_status public.cancellation_request_status_enum;
  v_reviewed_by uuid;
  v_reviewed_at timestamptz;

  v_normalized_note text;
  v_from_status public.order_status_enum;

  v_listing_ids uuid[] := '{}';
  v_agg_qtys integer[] := '{}';
  v_new_reserved integer[] := '{}';
  v_new_available integer[] := '{}';
  v_old_status public.listing_status_enum[] := '{}';

  v_listing_id uuid;
  v_agg_qty integer;
  v_stock_qty integer;
  v_reserved_qty integer;
  v_listing_status public.listing_status_enum;

  i integer;
begin
  -- ===================== authentication =====================
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'Authentication required.' using detail = 'NOT_AUTHENTICATED';
  end if;

  -- ===================== request-id -> order routing (unlocked, informational only) =====================
  select ocr.order_id into v_routed_order_id
    from public.order_cancellation_requests ocr
    where ocr.id = p_request_id;

  if not found then
    raise exception 'Cancellation request not found.' using detail = 'REQUEST_NOT_FOUND';
  end if;

  -- ===================== lock order row (universal serialization point) =====================
  select o.status, o.shop_id, o.buyer_id
    into v_order_status, v_order_shop_id, v_order_buyer_id
    from public.orders o
    where o.id = v_routed_order_id
    for update;

  if not found then
    raise exception 'Cancellation request not found.' using detail = 'REQUEST_NOT_FOUND';
  end if;

  -- ===================== lock request row and revalidate against the locked order =====================
  select ocr.order_id, ocr.status, ocr.reviewed_by, ocr.reviewed_at
    into v_request_order_id, v_request_status, v_reviewed_by, v_reviewed_at
    from public.order_cancellation_requests ocr
    where ocr.id = p_request_id
    for update;

  if not found or v_request_order_id is distinct from v_routed_order_id then
    raise exception 'Cancellation request not found.' using detail = 'REQUEST_NOT_FOUND';
  end if;

  v_order_id := v_routed_order_id;

  -- ===================== authorization: caller must own the order's shop =====================
  select s.owner_id into v_shop_owner_id
    from public.shops s
    where s.id = v_order_shop_id;

  if v_shop_owner_id is distinct from v_caller then
    raise exception 'You do not have permission to act on this request.' using detail = 'NOT_ORDER_SELLER';
  end if;

  v_normalized_note := nullif(btrim(p_review_note), '');

  -- ===================== resolved-request idempotency =====================
  if v_request_status = 'confirmed' then
    if p_confirm then
      return query
        select p_request_id, v_order_id, v_request_status, v_order_status, true, v_reviewed_at;
      return;
    else
      raise exception 'This cancellation request has already been resolved.' using detail = 'REQUEST_ALREADY_RESOLVED';
    end if;
  elsif v_request_status = 'rejected' then
    if not p_confirm then
      return query
        select p_request_id, v_order_id, v_request_status, v_order_status, true, v_reviewed_at;
      return;
    else
      raise exception 'This cancellation request has already been resolved.' using detail = 'REQUEST_ALREADY_RESOLVED';
    end if;
  end if;

  -- ===================== request still pending: order must still be eligible =====================
  if v_order_status not in ('accepted', 'ready') then
    raise exception 'Order is not in a state this cancellation request can be resolved against.' using detail = 'ORDER_NOT_CANCELLABLE';
  end if;

  -- ===================== reject path =====================
  if not p_confirm then
    if v_normalized_note is null then
      raise exception 'A review note is required to reject a cancellation request.' using detail = 'INVALID_REVIEW_NOTE';
    end if;

    update public.order_cancellation_requests
      set status = 'rejected',
          reviewed_by = v_caller,
          reviewed_at = now(),
          review_note = v_normalized_note
      where id = p_request_id;

    -- ===================== notification: buyer receives the rejection =====================
    insert into public.notifications (recipient_id, type, actor_id, order_id, dedupe_key)
    select v_order_buyer_id, 'order_cancellation_rejected', v_caller, v_order_id, p_request_id::text || ':rejected'
    where not exists (
      select 1 from public.profiles p where p.id = v_order_buyer_id and p.deleted_at is not null
    )
    on conflict on constraint notifications_recipient_type_dedupe_key do nothing;

    return query
      select p_request_id, v_order_id, 'rejected'::public.cancellation_request_status_enum, v_order_status, false, now();
    return;
  end if;

  -- ===================== confirm path =====================
  v_from_status := v_order_status;

  -- fix: alias "oi" makes the order_id filter unambiguous against this
  -- function's own "order_id" output column. Their locked, stable
  -- status/quantity values back the reservation check below.
  perform 1 from public.order_items oi where oi.order_id = v_order_id order by oi.id for update;

  -- fix: alias "ir" makes the order_id filter unambiguous, same as above.
  perform 1 from public.inventory_reservations ir where ir.order_id = v_order_id and ir.status = 'active' order by ir.id for update;

  -- reservation/item consistency guard: ownership is already structurally guaranteed by
  -- inventory_reservations_order_item_ownership_fkey; only status and quantity need checking here
  if exists (
    select 1
    from public.inventory_reservations ir
    join public.order_items oi on oi.id = ir.order_item_id
    where ir.order_id = v_order_id
      and ir.status = 'active'
      and (oi.status <> 'accepted' or ir.quantity <> oi.quantity)
  ) then
    raise exception 'Reservation state is inconsistent with order items.' using detail = 'RESERVATION_STATE_INVALID';
  end if;

  -- aggregate release quantity per listing
  for v_listing_id, v_agg_qty in
    select ir.listing_id, sum(ir.quantity)::integer
      from public.inventory_reservations ir
      where ir.order_id = v_order_id and ir.status = 'active'
      group by ir.listing_id
      order by ir.listing_id
  loop
    v_listing_ids := v_listing_ids || v_listing_id;
    v_agg_qtys := v_agg_qtys || v_agg_qty;
  end loop;

  -- lock affected listings in deterministic order, validate, compute resulting values
  for i in 1 .. coalesce(array_length(v_listing_ids, 1), 0) loop
    select l.stock_quantity, l.reserved_quantity, l.status
      into v_stock_qty, v_reserved_qty, v_listing_status
      from public.listings l
      where l.id = v_listing_ids[i]
      for update;

    if v_reserved_qty < v_agg_qtys[i] then
      raise exception 'Listing reserved quantity is insufficient to release.' using detail = 'RESERVATION_STATE_INVALID';
    end if;

    v_new_reserved := v_new_reserved || (v_reserved_qty - v_agg_qtys[i]);
    v_new_available := v_new_available || (v_stock_qty - (v_reserved_qty - v_agg_qtys[i]));
    v_old_status := v_old_status || v_listing_status;
  end loop;

  -- release reservations (the ledger is authoritative, updated before the cached aggregate)
  -- fix: alias "ir" makes the order_id filter unambiguous; the SET target
  -- list stays bare (Postgres does not accept alias-qualified SET targets,
  -- and a bare SET target is never ambiguous regardless of alias presence).
  update public.inventory_reservations ir
    set status = 'released',
        resolved_at = now()
    where ir.order_id = v_order_id and ir.status = 'active';

  -- update the cached listing aggregates and reopen visibility only where safe
  for i in 1 .. coalesce(array_length(v_listing_ids, 1), 0) loop
    update public.listings
      set reserved_quantity = v_new_reserved[i],
          status = case
            when v_old_status[i] = 'reserved' and v_new_available[i] > 0
              then 'available'::public.listing_status_enum
            else status
          end
      where id = v_listing_ids[i];
  end loop;

  -- parent order cancellation: status + lifecycle timestamp together, nothing else touched
  update public.orders
    set status = 'cancelled',
        cancelled_at = now()
    where id = v_order_id;

  -- request resolution
  update public.order_cancellation_requests
    set status = 'confirmed',
        reviewed_by = v_caller,
        reviewed_at = now(),
        review_note = v_normalized_note
    where id = p_request_id;

  -- exactly one parent history row
  insert into public.order_status_history (order_id, from_status, to_status, changed_by, note)
    values (v_order_id, v_from_status, 'cancelled', v_caller, null);

  -- ===================== notification: buyer receives confirmed cancellation =====================
  insert into public.notifications (recipient_id, type, actor_id, order_id, dedupe_key)
  select v_order_buyer_id, 'order_cancelled', v_caller, v_order_id, v_order_id::text || ':cancelled'
  where not exists (
    select 1 from public.profiles p where p.id = v_order_buyer_id and p.deleted_at is not null
  )
  on conflict on constraint notifications_recipient_type_dedupe_key do nothing;

  return query
    select p_request_id, v_order_id, 'confirmed'::public.cancellation_request_status_enum, 'cancelled'::public.order_status_enum, false, now();
end;
$$;

-- ============================================================
-- expire_pending_orders (+ order_expired, actor NULL)
-- ============================================================
create or replace function public.expire_pending_orders(p_limit integer default 100)
returns table (order_id uuid, expired_at timestamptz, anomaly boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz;
  r record;
  v_has_active_reservation boolean;
begin
  -- ===================== batch-limit validation (before any work) =====================
  if p_limit is null or p_limit < 1 or p_limit > 1000 then
    raise exception 'Batch limit must be between 1 and 1000.' using detail = 'INVALID_BATCH_LIMIT';
  end if;

  v_now := now();

  -- ===================== select + lock overdue pending orders, oldest first =====================
  for r in
    select o.id, o.buyer_id
      from public.orders o
      where o.status = 'pending'
        and o.created_at <= v_now - interval '72 hours'
      order by o.created_at, o.id
      for update skip locked
      limit p_limit
  loop
    -- ===================== active-reservation anomaly check (defensive corruption detector) =====================
    select exists (
      select 1
      from public.inventory_reservations ir
      where ir.order_id = r.id and ir.status = 'active'
    ) into v_has_active_reservation;

    if v_has_active_reservation then
      order_id := r.id;
      expired_at := null;
      anomaly := true;
      return next;
      continue;
    end if;

    -- ===================== normal expiry: status + lifecycle timestamp together, nothing else touched =====================
    update public.orders as o
      set status = 'expired',
          expired_at = v_now
      where o.id = r.id;

    -- ===================== exactly one parent history row, system transition =====================
    insert into public.order_status_history (order_id, from_status, to_status, changed_by, note)
      values (r.id, 'pending', 'expired', null, null);

    -- ===================== notification: buyer receives expiry event; no actor (system/batch) =====================
    insert into public.notifications (recipient_id, type, actor_id, order_id, dedupe_key)
    select r.buyer_id, 'order_expired', null, r.id, r.id::text || ':expired'
    where not exists (
      select 1 from public.profiles p where p.id = r.buyer_id and p.deleted_at is not null
    )
    on conflict on constraint notifications_recipient_type_dedupe_key do nothing;

    order_id := r.id;
    expired_at := v_now;
    anomaly := false;
    return next;
  end loop;

  return;
end;
$$;

-- ============================================================
-- send_message (+ new_message, muted-recipient suppression)
-- ============================================================
create or replace function public.send_message(p_conversation_id uuid, p_body text)
returns table (message_id uuid, conversation_id uuid, message_created_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_caller_deleted_at timestamptz;
  v_initiator_id uuid;
  v_shop_id uuid;
  v_shop_owner_id uuid;
  v_recipient_id uuid;
  v_body text;
  v_now timestamptz;
  v_message_id uuid;
begin
  -- ===================== authentication =====================
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'Authentication required.' using detail = 'NOT_AUTHENTICATED';
  end if;

  -- ===================== caller eligibility (anonymized/deleted account) =====================
  select p.deleted_at into v_caller_deleted_at
    from public.profiles p
    where p.id = v_caller;

  if v_caller_deleted_at is not null then
    raise exception 'Your account cannot send messages.' using detail = 'INTERACTION_BLOCKED';
  end if;

  -- ===================== lock conversation row (universal serialization point) =====================
  select c.initiator_id, c.shop_id
    into v_initiator_id, v_shop_id
    from public.conversations c
    where c.id = p_conversation_id
    for update;

  if not found then
    raise exception 'Conversation not found.' using detail = 'CONVERSATION_NOT_FOUND';
  end if;

  select s.owner_id into v_shop_owner_id
    from public.shops s
    where s.id = v_shop_id;

  -- ===================== participation (enforced here explicitly; SECURITY DEFINER bypasses RLS) =====================
  if v_caller = v_initiator_id then
    v_recipient_id := v_shop_owner_id;
  elsif v_caller = v_shop_owner_id then
    v_recipient_id := v_initiator_id;
  else
    raise exception 'You are not a participant in this conversation.' using detail = 'NOT_CONVERSATION_PARTICIPANT';
  end if;

  -- ===================== admin restrictions, re-checked fresh, role-based not caller-based =====================
  if exists (
    select 1
    from public.user_restrictions ur
    where ur.user_id = v_initiator_id
      and ur.lifted_at is null
      and ur.restriction_type in ('buyer_restricted', 'account_suspended')
  ) then
    raise exception 'This conversation is not able to receive new messages right now.' using detail = 'INTERACTION_BLOCKED';
  end if;

  if exists (
    select 1
    from public.user_restrictions ur
    where ur.user_id = v_shop_owner_id
      and ur.lifted_at is null
      and ur.restriction_type in ('seller_suspended', 'account_suspended')
  ) then
    raise exception 'This conversation is not able to receive new messages right now.' using detail = 'INTERACTION_BLOCKED';
  end if;

  -- ===================== peer blocking, re-checked fresh (both directions) =====================
  if exists (
    select 1
    from public.user_blocks ub
    where (ub.blocker_id = v_initiator_id and ub.blocked_id = v_shop_owner_id)
       or (ub.blocker_id = v_shop_owner_id and ub.blocked_id = v_initiator_id)
  ) then
    raise exception 'You cannot send a message in this conversation.' using detail = 'INTERACTION_BLOCKED';
  end if;

  -- ===================== message normalization =====================
  v_body := regexp_replace(p_body, '^[[:space:]]+|[[:space:]]+$', '', 'g');

  if v_body is null or v_body !~ '[^[:space:]]' then
    raise exception 'Message cannot be empty.' using detail = 'MESSAGE_EMPTY';
  end if;

  if char_length(v_body) > 4000 then
    raise exception 'Message is too long.' using detail = 'MESSAGE_TOO_LONG';
  end if;

  -- ===================== state-row invariant: both rows must already exist (corruption otherwise) =====================
  if not exists (
    select 1 from public.conversation_user_states cus
    where cus.conversation_id = p_conversation_id and cus.user_id = v_caller
  ) or not exists (
    select 1 from public.conversation_user_states cus
    where cus.conversation_id = p_conversation_id and cus.user_id = v_recipient_id
  ) then
    raise exception 'Conversation state is missing or corrupted.' using detail = 'CONVERSATION_STATE_INVALID';
  end if;

  -- ===================== transaction-stable time, captured after all validation =====================
  v_now := now();

  insert into public.messages as m (conversation_id, sender_id, body, created_at)
    values (p_conversation_id, v_caller, v_body, v_now)
    returning m.id into v_message_id;

  update public.conversations as c
    set last_message_at = v_now
    where c.id = p_conversation_id;

  update public.conversation_user_states as cus
    set last_read_at = v_now,
        marked_unread_at = null
    where cus.conversation_id = p_conversation_id and cus.user_id = v_caller;

  update public.conversation_user_states as cus
    set archived_at = null
    where cus.conversation_id = p_conversation_id and cus.user_id = v_recipient_id;

  -- ===================== notification: recipient only, suppressed if they muted this conversation =====================
  if not exists (
    select 1 from public.conversation_user_states cus
    where cus.conversation_id = p_conversation_id
      and cus.user_id = v_recipient_id
      and cus.muted
  ) then
    insert into public.notifications (recipient_id, type, actor_id, conversation_id, dedupe_key)
    select v_recipient_id, 'new_message', v_caller, p_conversation_id, v_message_id::text
    where not exists (
      select 1 from public.profiles p where p.id = v_recipient_id and p.deleted_at is not null
    )
    on conflict on constraint notifications_recipient_type_dedupe_key do nothing;
  end if;

  return query
    select v_message_id, p_conversation_id, v_now;
end;
$$;

-- ============================================================
-- start_conversation (+ new_message, muted-recipient suppression)
-- ============================================================
create or replace function public.start_conversation(p_shop_id uuid, p_body text, p_listing_id uuid default null)
returns table (conversation_id uuid, message_id uuid, message_created_at timestamptz, conversation_created boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_caller_deleted_at timestamptz;
  v_shop_owner_id uuid;
  v_listing_shop_id uuid;
  v_listing_status public.listing_status_enum;
  v_conversation_type public.conversation_type_enum;
  v_body text;
  v_now timestamptz;
  v_conversation_id uuid;
  v_conversation_created boolean := false;
  v_message_id uuid;
begin
  -- ===================== authentication =====================
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'Authentication required.' using detail = 'NOT_AUTHENTICATED';
  end if;

  -- ===================== caller eligibility (anonymized/deleted account) =====================
  select p.deleted_at into v_caller_deleted_at
    from public.profiles p
    where p.id = v_caller;

  if v_caller_deleted_at is not null then
    raise exception 'Your account cannot start new conversations.' using detail = 'INTERACTION_BLOCKED';
  end if;

  -- ===================== shop lookup + self-message =====================
  select s.owner_id
    into v_shop_owner_id
    from public.shops s
    where s.id = p_shop_id;

  if not found then
    raise exception 'Shop not found.' using detail = 'SHOP_NOT_FOUND';
  end if;

  if v_shop_owner_id = v_caller then
    raise exception 'You cannot message your own shop.' using detail = 'CANNOT_MESSAGE_OWN_SHOP';
  end if;

  -- ===================== listing identity (always validated) + conversation type =====================
  if p_listing_id is not null then
    select l.shop_id, l.status
      into v_listing_shop_id, v_listing_status
      from public.listings l
      where l.id = p_listing_id;

    if not found or v_listing_shop_id <> p_shop_id then
      raise exception 'Listing not found.' using detail = 'LISTING_NOT_FOUND';
    end if;

    v_conversation_type := 'listing_inquiry';
  else
    v_conversation_type := 'general_shop';
  end if;

  -- ===================== admin restrictions (role-based, active only) =====================
  if exists (
    select 1
    from public.user_restrictions ur
    where ur.user_id = v_caller
      and ur.lifted_at is null
      and ur.restriction_type in ('buyer_restricted', 'account_suspended')
  ) then
    raise exception 'You are not able to start new conversations right now.' using detail = 'INTERACTION_BLOCKED';
  end if;

  if exists (
    select 1
    from public.user_restrictions ur
    where ur.user_id = v_shop_owner_id
      and ur.lifted_at is null
      and ur.restriction_type in ('seller_suspended', 'account_suspended')
  ) then
    raise exception 'This seller cannot be messaged right now.' using detail = 'INTERACTION_BLOCKED';
  end if;

  -- ===================== peer blocking (both directions) =====================
  if exists (
    select 1
    from public.user_blocks ub
    where (ub.blocker_id = v_caller and ub.blocked_id = v_shop_owner_id)
       or (ub.blocker_id = v_shop_owner_id and ub.blocked_id = v_caller)
  ) then
    raise exception 'You cannot message this seller.' using detail = 'INTERACTION_BLOCKED';
  end if;

  -- ===================== message normalization =====================
  v_body := regexp_replace(p_body, '^[[:space:]]+|[[:space:]]+$', '', 'g');

  if v_body is null or v_body !~ '[^[:space:]]' then
    raise exception 'Message cannot be empty.' using detail = 'MESSAGE_EMPTY';
  end if;

  if char_length(v_body) > 4000 then
    raise exception 'Message is too long.' using detail = 'MESSAGE_TOO_LONG';
  end if;

  -- ===================== transaction-stable time, captured after all validation =====================
  v_now := now();

  -- ===================== race-safe find existing logical conversation =====================
  if v_conversation_type = 'listing_inquiry' then
    select c.id into v_conversation_id
      from public.conversations c
      where c.initiator_id = v_caller and c.listing_id = p_listing_id
      for update;
  else
    select c.id into v_conversation_id
      from public.conversations c
      where c.initiator_id = v_caller and c.shop_id = p_shop_id and c.listing_id is null
      for update;
  end if;

  -- ===================== fresh creation path only =====================
  if v_conversation_id is null then
    if v_conversation_type = 'listing_inquiry' and v_listing_status not in ('available', 'reserved') then
      raise exception 'This listing cannot be messaged about right now.' using detail = 'LISTING_NOT_MESSAGEABLE';
    end if;

    begin
      insert into public.conversations as c (conversation_type, initiator_id, shop_id, listing_id, last_message_at)
        values (v_conversation_type, v_caller, p_shop_id, p_listing_id, v_now)
        returning c.id into v_conversation_id;

      v_conversation_created := true;

      insert into public.conversation_user_states (conversation_id, user_id, last_read_at)
        values (v_conversation_id, v_caller, v_now);

      insert into public.conversation_user_states (conversation_id, user_id)
        values (v_conversation_id, v_shop_owner_id);
    exception
      when unique_violation then
        -- lost the create race to a concurrent call; reuse the row it created
        v_conversation_created := false;

        if v_conversation_type = 'listing_inquiry' then
          select c.id into v_conversation_id
            from public.conversations c
            where c.initiator_id = v_caller and c.listing_id = p_listing_id
            for update;
        else
          select c.id into v_conversation_id
            from public.conversations c
            where c.initiator_id = v_caller and c.shop_id = p_shop_id and c.listing_id is null
            for update;
        end if;
    end;
  end if;

  -- ===================== state-row invariant for EXISTING conversations only (fresh creation already =====================
  -- ===================== established the invariant atomically two statements above, so it is not =====================
  -- ===================== redundantly re-checked here) -- covers both the found-immediately path and =====================
  -- ===================== the create-race-loss re-select path, since both leave v_conversation_created = false =====================
  if not v_conversation_created then
    if not exists (
      select 1 from public.conversation_user_states cus
      where cus.conversation_id = v_conversation_id and cus.user_id = v_caller
    ) or not exists (
      select 1 from public.conversation_user_states cus
      where cus.conversation_id = v_conversation_id and cus.user_id = v_shop_owner_id
    ) then
      raise exception 'Conversation state is missing or corrupted.' using detail = 'CONVERSATION_STATE_INVALID';
    end if;
  end if;

  -- ===================== insert the message (always a fresh row, every call) =====================
  insert into public.messages as m (conversation_id, sender_id, body, created_at)
    values (v_conversation_id, v_caller, v_body, v_now)
    returning m.id into v_message_id;

  update public.conversations as c
    set last_message_at = v_now
    where c.id = v_conversation_id;

  update public.conversation_user_states as cus
    set last_read_at = v_now,
        marked_unread_at = null
    where cus.conversation_id = v_conversation_id and cus.user_id = v_caller;

  update public.conversation_user_states as cus
    set archived_at = null
    where cus.conversation_id = v_conversation_id and cus.user_id <> v_caller;

  -- ===================== notification: shop owner only, suppressed if they muted this conversation =====================
  if not exists (
    select 1 from public.conversation_user_states cus
    where cus.conversation_id = v_conversation_id
      and cus.user_id = v_shop_owner_id
      and cus.muted
  ) then
    insert into public.notifications (recipient_id, type, actor_id, conversation_id, dedupe_key)
    select v_shop_owner_id, 'new_message', v_caller, v_conversation_id, v_message_id::text
    where not exists (
      select 1 from public.profiles p where p.id = v_shop_owner_id and p.deleted_at is not null
    )
    on conflict on constraint notifications_recipient_type_dedupe_key do nothing;
  end if;

  return query
    select v_conversation_id, v_message_id, v_now, v_conversation_created;
end;
$$;

-- ============================================================
-- create_review (+ new_review)
-- ============================================================
create or replace function public.create_review(p_order_id uuid, p_rating integer, p_body text default null, p_image_paths text[] default '{}'::text[])
returns table (review_id uuid, created_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_caller_deleted_at timestamptz;
  v_order_buyer_id uuid;
  v_order_shop_id uuid;
  v_order_status public.order_status_enum;
  v_order_completed_at timestamptz;
  v_shop_owner_id uuid;
  v_body text;
  v_image_count integer;
  v_path text;
  v_now timestamptz;
  v_review_id uuid;
  v_created_at timestamptz;
begin
  -- ===================== authentication =====================
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'Authentication required.' using detail = 'NOT_AUTHENTICATED';
  end if;

  -- ===================== caller eligibility (deleted account) =====================
  select p.deleted_at into v_caller_deleted_at
    from public.profiles p
    where p.id = v_caller;

  if v_caller_deleted_at is not null then
    raise exception 'Your account cannot create reviews.' using detail = 'INTERACTION_BLOCKED';
  end if;

  -- ===================== lock order row (universal serialization point) =====================
  select o.buyer_id, o.shop_id, o.status, o.completed_at
    into v_order_buyer_id, v_order_shop_id, v_order_status, v_order_completed_at
    from public.orders o
    where o.id = p_order_id
    for update;

  if not found then
    raise exception 'Order not found.' using detail = 'ORDER_NOT_FOUND';
  end if;

  if v_order_buyer_id <> v_caller then
    raise exception 'You are not the buyer of this order.' using detail = 'NOT_ORDER_BUYER';
  end if;

  if v_order_status <> 'completed' or v_order_completed_at is null then
    raise exception 'This order is not eligible for review.' using detail = 'ORDER_NOT_REVIEWABLE';
  end if;

  -- ===================== one review per order (pre-check; UNIQUE(order_id) is the final guard) =====================
  if exists (select 1 from public.reviews r where r.order_id = p_order_id) then
    raise exception 'A review already exists for this order.' using detail = 'REVIEW_ALREADY_EXISTS';
  end if;

  -- ===================== derive current shop owner (not trusted from client) =====================
  select s.owner_id into v_shop_owner_id
    from public.shops s
    where s.id = v_order_shop_id;

  -- ===================== peer blocking, both directions -- NEW review only =====================
  if exists (
    select 1 from public.user_blocks ub
    where (ub.blocker_id = v_caller and ub.blocked_id = v_shop_owner_id)
       or (ub.blocker_id = v_shop_owner_id and ub.blocked_id = v_caller)
  ) then
    raise exception 'You cannot review this seller.' using detail = 'INTERACTION_BLOCKED';
  end if;

  -- ===================== admin restrictions -- buyer only; seller suspension does not suppress this =====================
  if exists (
    select 1 from public.user_restrictions ur
    where ur.user_id = v_caller
      and ur.lifted_at is null
      and ur.restriction_type in ('buyer_restricted', 'account_suspended')
  ) then
    raise exception 'You are not able to create reviews right now.' using detail = 'INTERACTION_BLOCKED';
  end if;

  -- ===================== rating validation (explicit; not solely relying on the CHECK) =====================
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'Rating must be between 1 and 5.' using detail = 'RATING_INVALID';
  end if;

  -- ===================== body normalization (optional; whitespace-only collapses to NULL) =====================
  v_body := nullif(regexp_replace(p_body, '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');

  if v_body is not null and char_length(v_body) > 1000 then
    raise exception 'Review text is too long.' using detail = 'REVIEW_BODY_TOO_LONG';
  end if;

  -- ===================== image path validation (0..2, complete ordered set) =====================
  v_image_count := coalesce(array_length(p_image_paths, 1), 0);

  if v_image_count > 2 then
    raise exception 'A review may have at most 2 images.' using detail = 'TOO_MANY_REVIEW_IMAGES';
  end if;

  if v_image_count > 0 then
    foreach v_path in array p_image_paths loop
      if v_path is null or v_path !~ '[^[:space:]]' then
        raise exception 'One or more review image paths are invalid.' using detail = 'REVIEW_IMAGE_PATH_INVALID';
      end if;
    end loop;
  end if;

  -- ===================== transaction-stable time, captured after all validation =====================
  v_now := now();

  -- ===================== insert the review (race-safe: order lock already serializes; UNIQUE is the final guard) =====================
  begin
    insert into public.reviews as r (order_id, buyer_id, shop_id, rating, body, created_at, updated_at)
      values (p_order_id, v_caller, v_order_shop_id, p_rating, v_body, v_now, v_now)
      returning r.id, r.created_at into v_review_id, v_created_at;
  exception
    when unique_violation then
      raise exception 'A review already exists for this order.' using detail = 'REVIEW_ALREADY_EXISTS';
  end;

  -- ===================== insert image rows, preserving array order as sort_order 0/1 =====================
  if v_image_count > 0 then
    for i in 1..v_image_count loop
      insert into public.review_images (review_id, storage_path, sort_order)
        values (v_review_id, p_image_paths[i], i - 1);
    end loop;
  end if;

  -- ===================== notification: seller receives the new review =====================
  insert into public.notifications (recipient_id, type, actor_id, review_id, dedupe_key)
  select v_shop_owner_id, 'new_review', v_caller, v_review_id, v_review_id::text
  where not exists (
    select 1 from public.profiles p where p.id = v_shop_owner_id and p.deleted_at is not null
  )
  on conflict on constraint notifications_recipient_type_dedupe_key do nothing;

  return query
    select v_review_id, v_created_at;
end;
$$;

-- ============================================================
-- upsert_review_reply (+ review_reply, first reply only)
-- ============================================================
create or replace function public.upsert_review_reply(p_review_id uuid, p_body text)
returns table (review_id uuid, reply_created_at timestamptz, reply_updated_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_caller_deleted_at timestamptz;
  v_review_buyer_id uuid;
  v_review_shop_id uuid;
  v_existing_reply_created_at timestamptz;
  v_shop_owner_id uuid;
  v_body text;
  v_now timestamptz;
  v_reply_created_at timestamptz;
  v_reply_updated_at timestamptz;
begin
  -- ===================== authentication =====================
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'Authentication required.' using detail = 'NOT_AUTHENTICATED';
  end if;

  -- ===================== caller eligibility (deleted account) =====================
  select p.deleted_at into v_caller_deleted_at
    from public.profiles p
    where p.id = v_caller;

  if v_caller_deleted_at is not null then
    raise exception 'Your account cannot reply to reviews.' using detail = 'INTERACTION_BLOCKED';
  end if;

  -- ===================== lock review row (universal serialization point) =====================
  select r.buyer_id, r.shop_id, r.reply_created_at
    into v_review_buyer_id, v_review_shop_id, v_existing_reply_created_at
    from public.reviews r
    where r.id = p_review_id
    for update;

  if not found then
    raise exception 'Review not found.' using detail = 'REVIEW_NOT_FOUND';
  end if;

  -- ===================== caller must be the shop's current owner =====================
  select s.owner_id into v_shop_owner_id
    from public.shops s
    where s.id = v_review_shop_id;

  if v_shop_owner_id is null or v_shop_owner_id <> v_caller then
    raise exception 'You are not the seller for this review.' using detail = 'NOT_REVIEW_SELLER';
  end if;

  -- ===================== peer blocking, both directions -- applies to first reply AND every edit =====================
  if exists (
    select 1 from public.user_blocks ub
    where (ub.blocker_id = v_caller and ub.blocked_id = v_review_buyer_id)
       or (ub.blocker_id = v_review_buyer_id and ub.blocked_id = v_caller)
  ) then
    raise exception 'You cannot reply to this review.' using detail = 'INTERACTION_BLOCKED';
  end if;

  -- ===================== seller admin restrictions -- applies to first reply AND every edit =====================
  if exists (
    select 1 from public.user_restrictions ur
    where ur.user_id = v_caller
      and ur.lifted_at is null
      and ur.restriction_type in ('seller_suspended', 'account_suspended')
  ) then
    raise exception 'You are not able to reply to reviews right now.' using detail = 'INTERACTION_BLOCKED';
  end if;

  -- ===================== body normalization (required, non-blank) =====================
  v_body := nullif(regexp_replace(p_body, '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');

  if v_body is null then
    raise exception 'Reply cannot be empty.' using detail = 'REPLY_EMPTY';
  end if;

  if char_length(v_body) > 1000 then
    raise exception 'Reply is too long.' using detail = 'REPLY_TOO_LONG';
  end if;

  -- ===================== transaction-stable time =====================
  v_now := now();

  if v_existing_reply_created_at is null then
    -- ===================== first reply: reply_created_at fixed now, reply_updated_at stays NULL =====================
    update public.reviews as r
      set reply_body = v_body,
          reply_created_at = v_now,
          reply_updated_at = null
      where r.id = p_review_id
      returning r.reply_created_at, r.reply_updated_at into v_reply_created_at, v_reply_updated_at;

    -- ===================== notification: buyer receives the first reply only, never an edit =====================
    insert into public.notifications (recipient_id, type, actor_id, review_id, dedupe_key)
    select v_review_buyer_id, 'review_reply', v_caller, p_review_id, p_review_id::text || ':reply'
    where not exists (
      select 1 from public.profiles p where p.id = v_review_buyer_id and p.deleted_at is not null
    )
    on conflict on constraint notifications_recipient_type_dedupe_key do nothing;
  else
    -- ===================== edit: 7-day window anchored to the existing reply_created_at =====================
    if v_now >= v_existing_reply_created_at + interval '7 days' then
      raise exception 'The reply edit window has closed.' using detail = 'REPLY_EDIT_WINDOW_CLOSED';
    end if;

    update public.reviews as r
      set reply_body = v_body,
          reply_updated_at = v_now
      where r.id = p_review_id
      returning r.reply_created_at, r.reply_updated_at into v_reply_created_at, v_reply_updated_at;
  end if;

  return query
    select p_review_id, v_reply_created_at, v_reply_updated_at;
end;
$$;

comment on function public.get_my_notifications(integer, timestamptz, uuid) is
  'Keyset-paginated (created_at DESC, id DESC), owner-scoped notification feed with UI-safe actor/order/conversation-listing projection. Actor identity masked to NULL for a soft-deleted actor. conversation_listing_title is NULL whenever the linked listing is not in (available, reserved, sold, archived), or its shop owner has an active seller_suspended/account_suspended restriction -- a suspended seller''s listings are canonically hidden from public marketplace surfaces, and this projection must not become an alternate disclosure path. Suppressing the title never suppresses the notification row itself.';
