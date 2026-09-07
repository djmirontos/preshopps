import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

function readFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf-8");
}

describe("Seller Orders reads never trust client-supplied identity", () => {
  it("get-my-shop.ts reads the shops table with no owner/user id filter (relies on shops_select_owner RLS)", () => {
    const source = readFile("lib/seller/get-my-shop.ts");
    expect(source).toMatch(/\.from\(\s*["']shops["']\s*\)/);
    expect(source).not.toMatch(/owner_id\s*:|p_owner_id|p_user_id/);
  });

  it("get-my-shop-orders.ts calls get_my_shop_orders with no shop/seller/user id argument", () => {
    const source = readFile("lib/seller/get-my-shop-orders.ts");
    expect(source).toMatch(/rpc\(\s*["']get_my_shop_orders["']/);
    expect(source).not.toMatch(/p_shop_id|p_seller_id|p_owner_id|p_user_id|shop_id\s*:/);
  });

  it("get-my-shop-order-detail.ts calls get_my_shop_order_detail with only the public code", () => {
    const source = readFile("lib/seller/get-my-shop-order-detail.ts");
    expect(source).toMatch(/rpc\(\s*["']get_my_shop_order_detail["']/);
    expect(source).not.toMatch(/p_shop_id|p_seller_id|p_owner_id|p_user_id|shop_id\s*:/);
  });

  it("neither seller read module ever selects the orders/order_items tables directly", () => {
    for (const file of ["lib/seller/get-my-shop-orders.ts", "lib/seller/get-my-shop-order-detail.ts"]) {
      const source = readFile(file);
      expect(source).not.toMatch(/\.from\(\s*["']orders["']\s*\)/);
      expect(source).not.toMatch(/\.from\(\s*["']order_items["']\s*\)/);
    }
  });
});

describe("Seller Orders lifecycle actions never trust client-supplied shop/seller/user identity", () => {
  it("seller-order-actions.ts sends only order/item/request ids and user-authored text -- never a shop/seller/user id", () => {
    const source = readFile("lib/seller/seller-order-actions.ts");
    expect(source).not.toMatch(/p_shop_id|p_seller_id|p_owner_id|p_user_id|p_buyer_id/);
    expect(source).toMatch(/rpc\(\s*["']accept_order_items["']/);
    expect(source).toMatch(/rpc\(\s*["']mark_order_ready["']/);
    expect(source).toMatch(/rpc\(\s*["']mark_order_handed_over_or_shipped["']/);
    expect(source).toMatch(/rpc\(\s*["']cancel_accepted_order["']/);
    expect(source).toMatch(/rpc\(\s*["']resolve_order_cancellation["']/);
  });

  it("never calls a buyer-only RPC from the seller module (cancel_pending_order, cancel_order_changes, confirm_order_changes, request_order_cancellation)", () => {
    const source = readFile("lib/seller/seller-order-actions.ts");
    expect(source).not.toMatch(/["']cancel_pending_order["']|["']cancel_order_changes["']|["']confirm_order_changes["']|["']request_order_cancellation["']/);
  });

  it("never calls complete_order or expire_pending_orders -- both are service-role only with no human caller", () => {
    const source = readFile("lib/seller/seller-order-actions.ts");
    expect(source).not.toMatch(/["']complete_order["']|["']expire_pending_orders["']/);
  });
});

describe("no service-role bypass anywhere in the Seller Orders module", () => {
  it("no seller order-management file references a service-role key", () => {
    const files = [
      "lib/seller/get-my-shop.ts",
      "lib/seller/get-my-shop-orders.ts",
      "lib/seller/get-my-shop-order-detail.ts",
      "lib/seller/seller-order-actions.ts",
      "components/seller/ConfirmDialog.tsx",
      "components/seller/SellerOrdersListClient.tsx",
      "components/seller/SellerOrderDetailClient.tsx",
      "app/seller/orders/page.tsx",
      "app/seller/orders/[publicCode]/page.tsx",
    ];
    for (const file of files) {
      const source = readFile(file);
      expect(source.toLowerCase()).not.toContain("service_role");
      expect(source.toLowerCase()).not.toContain("service-role");
    }
  });
});

describe("Seller Orders migration is scoped to exactly the two new read RPCs", () => {
  it("0043_seller_orders_read_rpcs migration adds get_my_shop_orders and get_my_shop_order_detail only", () => {
    const source = readFile("supabase/migrations/0043_seller_orders_read_rpcs.sql");
    expect(source).toMatch(/create (or replace )?function public\.get_my_shop_orders/i);
    expect(source).toMatch(/create (or replace )?function public\.get_my_shop_order_detail/i);
    expect(source).not.toMatch(/create policy|drop policy|alter policy/i);
    expect(source).not.toMatch(/create table|alter table|drop table/i);
    expect(source).not.toMatch(/create type|alter type/i);
    // No existing lifecycle/write RPC is redefined by this migration.
    expect(source).not.toMatch(/create or replace function public\.accept_order_items/i);
    expect(source).not.toMatch(/create or replace function public\.mark_order_ready/i);
    expect(source).not.toMatch(/create or replace function public\.cancel_accepted_order/i);
  });

  it("both new RPCs are granted to authenticated only, never anon", () => {
    const source = readFile("supabase/migrations/0043_seller_orders_read_rpcs.sql");
    expect(source).toMatch(/revoke all on function public\.get_my_shop_orders\([^)]*\) from anon/);
    expect(source).toMatch(/revoke all on function public\.get_my_shop_order_detail\([^)]*\) from anon/);
    expect(source).toMatch(/grant execute on function public\.get_my_shop_orders\([^)]*\) to authenticated/);
    expect(source).toMatch(/grant execute on function public\.get_my_shop_order_detail\([^)]*\) to authenticated/);
  });
});

describe("Seller Orders navigation matches the locked design", () => {
  it("Seller Orders is not added as a sixth bottom-nav tab -- the canonical 5 tabs stay unchanged", () => {
    const source = readFile("components/layout/MobileBottomNav.tsx");
    expect(source).not.toMatch(/href="\/seller\/orders"/);
  });

  it("account page links to /seller/orders", () => {
    const source = readFile("app/account/page.tsx");
    expect(source).toMatch(/href="\/seller\/orders"/);
  });
});
