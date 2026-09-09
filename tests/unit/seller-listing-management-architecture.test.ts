import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

function readFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf-8");
}

const MIGRATION_PATH = "supabase/migrations/0064_seller_listing_management_rpcs.sql";

function getFunctionBody(source: string, fnName: string): string {
  const start = source.indexOf(`create or replace function public.${fnName}(`);
  const bodyStart = source.indexOf("begin\n", start);
  const bodyEnd = source.indexOf("end;\n$$;", bodyStart);
  return source.slice(bodyStart, bodyEnd);
}

describe("0064 is scoped to get_my_shop_listings + update_listing_status only", () => {
  const source = readFile(MIGRATION_PATH);

  it("creates exactly these two functions -- no schema/enum/policy change, no existing function touched", () => {
    expect(source).toMatch(/create or replace function public\.get_my_shop_listings\s*\(/);
    expect(source).toMatch(/create or replace function public\.update_listing_status\s*\(/);
    expect(source).not.toMatch(/create table|alter table|drop table/i);
    expect(source).not.toMatch(/create type|alter type/i);
    expect(source).not.toMatch(/create policy|alter policy|drop policy|create index|drop index/i);
    expect(source).not.toMatch(/create or replace function public\.(create|update)_listing\(/i);
    expect(source).not.toMatch(/create or replace function public\.publish_listing/i);
    expect(source).not.toMatch(/create or replace function public\.accept_order_items/i);
    expect(source).not.toMatch(/create or replace function public\.complete_order/i);
    expect(source).not.toMatch(/create or replace function public\.cancel_accepted_order/i);
  });

  it("both functions are SECURITY DEFINER with an empty search_path, granted to authenticated only", () => {
    expect(source).toMatch(/security definer/i);
    expect(source).toMatch(/set search_path = ''/);
    expect(source).toMatch(
      /revoke all on function public\.get_my_shop_listings\(public\.listing_status_enum, integer, timestamptz, uuid\) from public/i,
    );
    expect(source).toMatch(
      /revoke all on function public\.get_my_shop_listings\(public\.listing_status_enum, integer, timestamptz, uuid\) from anon/i,
    );
    expect(source).toMatch(
      /grant execute on function public\.get_my_shop_listings\(public\.listing_status_enum, integer, timestamptz, uuid\) to authenticated/i,
    );
    expect(source).toMatch(/revoke all on function public\.update_listing_status\(uuid, public\.listing_status_enum\) from public/i);
    expect(source).toMatch(/revoke all on function public\.update_listing_status\(uuid, public\.listing_status_enum\) from anon/i);
    expect(source).toMatch(/grant execute on function public\.update_listing_status\(uuid, public\.listing_status_enum\) to authenticated/i);
    expect(source).not.toMatch(/to anon;/);
  });

  it("neither function accepts a client-supplied owner/shop/user id", () => {
    const listSignature = source.slice(
      source.indexOf("create or replace function public.get_my_shop_listings("),
      source.indexOf("returns table", source.indexOf("create or replace function public.get_my_shop_listings(")),
    );
    const statusSignature = source.slice(
      source.indexOf("create or replace function public.update_listing_status("),
      source.indexOf("returns table", source.indexOf("create or replace function public.update_listing_status(")),
    );
    expect(listSignature).not.toMatch(/p_user_id|p_shop_id|p_owner_id/);
    expect(statusSignature).not.toMatch(/p_user_id|p_shop_id|p_owner_id/);
    expect(statusSignature).toMatch(/p_listing_id uuid/);
    expect(statusSignature).toMatch(/p_status public\.listing_status_enum/);
  });
});

describe("0064 get_my_shop_listings", () => {
  const source = readFile(MIGRATION_PATH);
  const body = getFunctionBody(source, "get_my_shop_listings");

  it("requires auth.uid() (NOT_AUTHENTICATED)", () => {
    expect(body).toMatch(/v_caller := auth\.uid\(\);/);
    expect(body).toMatch(/'Authentication required\.' using detail = 'NOT_AUTHENTICATED'/);
  });

  it("returns an empty set (not an error) when the caller has no shop yet", () => {
    const shopBlock = body.slice(body.indexOf("caller's own shop"), body.indexOf("pagination validation"));
    expect(shopBlock).toMatch(/if not found then\s*\n\s*return;\s*\n\s*end if;/);
  });

  it("validates the limit (clamped [1, 50]) and requires cursor values together, same as get_my_shop_orders", () => {
    expect(body).toMatch(/if p_limit is null or p_limit < 1 or p_limit > 50 then/);
    expect(body).toMatch(/'Limit must be between 1 and 50\.' using detail = 'LIMIT_INVALID'/);
    expect(body).toMatch(/if \(p_before_created_at is null\) <> \(p_before_id is null\) then/);
    expect(body).toMatch(/'Cursor values must be supplied together\.' using detail = 'CURSOR_INVALID'/);
  });

  it("filters by shop_id and only applies the status filter when p_status is supplied", () => {
    expect(body).toMatch(/where l\.shop_id = v_shop_id/);
    expect(body).toMatch(/and \(p_status is null or l\.status = p_status\)/);
  });

  it("orders newest-first by (created_at, id) DESC with a keyset cursor, never OFFSET", () => {
    expect(body).toMatch(/order by l\.created_at desc, l\.id desc/);
    expect(body).toMatch(/\(l\.created_at, l\.id\) < \(p_before_created_at, p_before_id\)/);
    expect(body).not.toMatch(/\boffset\b/i);
  });

  it("resolves the cover image via listings.cover_image_id, the same trusted join every public card projection uses", () => {
    expect(body).toMatch(/left join public\.listing_images img on img\.id = l\.cover_image_id/);
    expect(body).toMatch(/img\.storage_path as cover_image_path/);
  });

  it("never references orders/order_items/inventory_reservations -- a pure listings read", () => {
    expect(body).not.toMatch(/\bpublic\.orders\b/);
    expect(body).not.toMatch(/\bpublic\.order_items\b/);
    expect(body).not.toMatch(/\bpublic\.inventory_reservations\b/);
  });

  it("never resolves category/type/condition to a display name -- returns the raw ids/enums only", () => {
    expect(body).not.toMatch(/from public\.categories/);
  });
});

describe("0064 update_listing_status", () => {
  const source = readFile(MIGRATION_PATH);
  const body = getFunctionBody(source, "update_listing_status");

  it("requires auth.uid() and an existing shop (raises, does not silently no-op)", () => {
    expect(body).toMatch(/'Authentication required\.' using detail = 'NOT_AUTHENTICATED'/);
    expect(body).toMatch(/'Create your shop first\.' using detail = 'SHOP_NOT_FOUND'/);
  });

  it("blocks seller_suspended/account_suspended, same pattern as publish_listing", () => {
    const restrictionBlock = body.slice(body.indexOf("seller admin restrictions"), body.indexOf("structural input validation"));
    expect(restrictionBlock).toMatch(/restriction_type in \('seller_suspended', 'account_suspended'\)/);
    expect(restrictionBlock).toMatch(/INTERACTION_BLOCKED/);
  });

  it("rejects 'draft' and 'reserved' as a target status unconditionally, before even locking the listing", () => {
    const inputCheckIndex = body.indexOf("structural input validation");
    const lockIndex = body.indexOf("lock the listing row");
    expect(inputCheckIndex).toBeGreaterThan(-1);
    expect(lockIndex).toBeGreaterThan(inputCheckIndex);
    expect(body).toMatch(/if p_status is null or p_status not in \('available', 'paused', 'sold', 'archived'\) then/);
    expect(body).toMatch(/'That status cannot be set directly\.' using detail = 'TARGET_STATUS_NOT_ALLOWED'/);
  });

  it("distinguishes listing-not-found from not-your-listing", () => {
    expect(body).toMatch(/'Listing not found\.' using detail = 'LISTING_NOT_FOUND'/);
    expect(body).toMatch(/if v_listing_shop_id <> v_shop_id then\s*\n\s*raise exception 'You do not have permission to manage this listing\.' using detail = 'NOT_LISTING_OWNER';/);
  });

  it("locks the listing row FOR UPDATE as the universal serialization point", () => {
    expect(body).toMatch(/from public\.listings l\s*\n\s*where l\.id = p_listing_id\s*\n\s*for update;/);
  });

  it("is idempotent: requesting the current status returns success with zero mutation, checked before the reservation guard", () => {
    const idempotencyIndex = body.indexOf("idempotent: requesting the current status");
    const reservationGuardIndex = body.indexOf("active-reservation guard");
    expect(idempotencyIndex).toBeGreaterThan(-1);
    expect(reservationGuardIndex).toBeGreaterThan(idempotencyIndex);
    expect(body).toMatch(/if v_current_status = p_status then\s*\n\s*return query\s*\n\s*select p_listing_id, v_current_status, true, v_updated_at;\s*\n\s*return;/);
  });

  it("blocks every mutation while the listing has any active reservation, not only when status = 'reserved'", () => {
    expect(body).toMatch(/if v_reserved_quantity > 0 then/);
    expect(body).toMatch(/'This listing has an active order reservation and cannot be changed right now\.' using detail = 'LISTING_HAS_ACTIVE_RESERVATION'/);
  });

  it("implements exactly the documented transition matrix -- draft/sold only reach archived, available<->paused, both reach sold", () => {
    expect(body).toMatch(/\(v_current_status = 'draft' and p_status = 'archived'\)/);
    expect(body).toMatch(/\(v_current_status = 'available' and p_status in \('paused', 'sold', 'archived'\)\)/);
    expect(body).toMatch(/\(v_current_status = 'paused' and p_status in \('available', 'sold', 'archived'\)\)/);
    expect(body).toMatch(/\(v_current_status = 'sold' and p_status = 'archived'\)/);
    expect(body).toMatch(/'That status change is not allowed\.' using detail = 'INVALID_STATUS_TRANSITION'/);
  });

  it("never allows a transition out of archived, and never allows sold -> available/paused (no un-archive, no un-sell)", () => {
    expect(body).not.toMatch(/v_current_status = 'archived'/);
    expect(body).not.toMatch(/v_current_status = 'sold' and p_status in \('available', 'paused'\)/);
  });

  it("sets archived_at once, on the archived transition only, and never clears it", () => {
    expect(body).toMatch(/archived_at = case when p_status = 'archived' then now\(\) else l\.archived_at end/);
  });

  it("only ever writes status and archived_at -- never stock_quantity/reserved_quantity/price_cents/published_at", () => {
    const updateBlock = body.slice(body.indexOf("apply: status only"), body.indexOf("return query", body.indexOf("apply: status only")));
    expect(updateBlock).toMatch(/set status = p_status/);
    expect(updateBlock).not.toMatch(/stock_quantity\s*=/);
    expect(updateBlock).not.toMatch(/reserved_quantity\s*=/);
    expect(updateBlock).not.toMatch(/price_cents\s*=/);
    expect(updateBlock).not.toMatch(/published_at\s*=/);
  });

  it("never references orders/order_items directly -- reservation state comes only from the listing's own cached reserved_quantity", () => {
    expect(body).not.toMatch(/\bpublic\.orders\b/);
    expect(body).not.toMatch(/\bpublic\.order_items\b/);
    expect(body).not.toMatch(/\bpublic\.inventory_reservations\b/);
  });
});
