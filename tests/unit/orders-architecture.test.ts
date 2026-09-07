import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

function readFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf-8");
}

describe("Buyer Orders reads never trust client-supplied identity", () => {
  it("get-my-orders.ts calls get_my_orders with no buyer/user id argument", () => {
    const source = readFile("lib/orders/get-my-orders.ts");
    expect(source).toMatch(/rpc\(\s*["']get_my_orders["']/);
    expect(source).not.toMatch(/p_buyer_id|p_user_id|buyer_id\s*:/);
  });

  it("get-my-order-detail.ts calls get_my_order_detail with only the public code", () => {
    const source = readFile("lib/orders/get-my-order-detail.ts");
    expect(source).toMatch(/rpc\(\s*["']get_my_order_detail["']/);
    expect(source).not.toMatch(/p_buyer_id|p_user_id|buyer_id\s*:/);
  });

  it("neither order data module ever selects the orders/order_items tables directly", () => {
    for (const file of ["lib/orders/get-my-orders.ts", "lib/orders/get-my-order-detail.ts"]) {
      const source = readFile(file);
      expect(source).not.toMatch(/\.from\(\s*["']orders["']\s*\)/);
      expect(source).not.toMatch(/\.from\(\s*["']order_items["']\s*\)/);
    }
  });
});

describe("no service-role bypass anywhere in the Buyer Orders module", () => {
  it("no orders file references a service-role key", () => {
    const files = [
      "lib/orders/get-my-orders.ts",
      "lib/orders/get-my-order-detail.ts",
      "lib/orders/order-status-copy.ts",
      "lib/orders/format-order-date.ts",
      "components/orders/OrderStatusBadge.tsx",
      "components/orders/OrdersListClient.tsx",
      "app/orders/page.tsx",
      "app/orders/[publicCode]/page.tsx",
    ];
    for (const file of files) {
      const source = readFile(file);
      expect(source.toLowerCase()).not.toContain("service_role");
      expect(source.toLowerCase()).not.toContain("service-role");
    }
  });
});

describe("Buyer Orders migration is scoped to exactly the two new read RPCs", () => {
  it("0042_buyer_orders_read_rpcs migration adds get_my_orders and get_my_order_detail only", () => {
    const source = readFile("supabase/migrations/0042_buyer_orders_read_rpcs.sql");
    expect(source).toMatch(/create (or replace )?function public\.get_my_orders/i);
    expect(source).toMatch(/create (or replace )?function public\.get_my_order_detail/i);
    expect(source).not.toMatch(/create policy|drop policy|alter policy/i);
    expect(source).not.toMatch(/create table|alter table|drop table/i);
    expect(source).not.toMatch(/create type|alter type/i);
    // No existing lifecycle/write RPC is redefined by this migration.
    expect(source).not.toMatch(/create or replace function public\.submit_cart_order/i);
    expect(source).not.toMatch(/create or replace function public\.accept_order_items/i);
    expect(source).not.toMatch(/create or replace function public\.cancel_pending_order/i);
  });

  it("both new RPCs are granted to authenticated only, never anon", () => {
    const source = readFile("supabase/migrations/0042_buyer_orders_read_rpcs.sql");
    expect(source).toMatch(/revoke all on function public\.get_my_orders\([^)]*\) from anon/);
    expect(source).toMatch(/revoke all on function public\.get_my_order_detail\([^)]*\) from anon/);
    expect(source).toMatch(/grant execute on function public\.get_my_orders\([^)]*\) to authenticated/);
    expect(source).toMatch(/grant execute on function public\.get_my_order_detail\([^)]*\) to authenticated/);
  });
});

describe("Buyer Orders navigation matches the locked design", () => {
  it("Orders is not added as a sixth bottom-nav tab -- the canonical 5 tabs stay unchanged", () => {
    const source = readFile("components/layout/MobileBottomNav.tsx");
    expect(source).not.toMatch(/href="\/orders"/);
  });

  it("account page links to both /favorites and /orders", () => {
    const source = readFile("app/account/page.tsx");
    expect(source).toMatch(/href="\/favorites"/);
    expect(source).toMatch(/href="\/orders"/);
  });

  it("OrderReviewSubmit links to /orders from its success confirmation", () => {
    const source = readFile("components/cart/OrderReviewSubmit.tsx");
    expect(source).toMatch(/href="\/orders"/);
  });
});
