import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

function readFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf-8");
}

describe("Buyer Order Actions never trust client-supplied identity", () => {
  it("buyer-order-actions.ts sends no shop/seller/user id to any RPC -- only order/request ids and buyer-authored reason text", () => {
    const source = readFile("lib/orders/buyer-order-actions.ts");
    expect(source).not.toMatch(/p_shop_id|p_seller_id|p_owner_id|p_user_id|p_buyer_id/);
  });

  it("calls exactly the five expected buyer lifecycle RPCs", () => {
    const source = readFile("lib/orders/buyer-order-actions.ts");
    expect(source).toMatch(/rpc\(\s*["']cancel_pending_order["']/);
    expect(source).toMatch(/rpc\(\s*["']cancel_order_changes["']/);
    expect(source).toMatch(/rpc\(\s*["']confirm_order_changes["']/);
    expect(source).toMatch(/rpc\(\s*["']request_order_cancellation["']/);
    expect(source).toMatch(/rpc\(\s*["']confirm_order_received["']/);
  });

  it("never calls a seller-only RPC from the buyer module", () => {
    const source = readFile("lib/orders/buyer-order-actions.ts");
    expect(source).not.toMatch(
      /["']accept_order_items["']|["']mark_order_ready["']|["']mark_order_handed_over_or_shipped["']|["']cancel_accepted_order["']|["']resolve_order_cancellation["']/,
    );
  });

  it("never calls complete_order directly -- completion is reached only through confirm_order_received (0044)", () => {
    const source = readFile("lib/orders/buyer-order-actions.ts");
    expect(source).not.toMatch(/["']complete_order["']/);
  });

  it("never selects the orders/order_items tables directly", () => {
    const source = readFile("lib/orders/buyer-order-actions.ts");
    expect(source).not.toMatch(/\.from\(\s*["']orders["']\s*\)/);
    expect(source).not.toMatch(/\.from\(\s*["']order_items["']\s*\)/);
  });
});

describe("no service-role bypass anywhere in the Buyer Order Actions module", () => {
  it("no buyer-order-action file references a service-role key", () => {
    const files = [
      "lib/orders/buyer-order-actions.ts",
      "lib/orders/get-my-order-detail.ts",
      "lib/orders/order-status-copy.ts",
      "components/orders/BuyerOrderActionsClient.tsx",
      "app/orders/[publicCode]/page.tsx",
    ];
    for (const file of files) {
      const source = readFile(file);
      expect(source.toLowerCase()).not.toContain("service_role");
      expect(source.toLowerCase()).not.toContain("service-role");
    }
  });
});

describe("Buyer Order Actions does not build out-of-scope modules", () => {
  it("does not reference messaging, review-feature, or disputes-UI concepts", () => {
    // Substring checks for bare "review"/"message"/"dispute" would false-positive
    // on legitimate, unrelated text already in this module ("reviewed this
    // order", "seller review", ERROR_MESSAGES/errorMessage identifiers) --
    // these patterns target the actual out-of-scope features instead.
    const files = ["components/orders/BuyerOrderActionsClient.tsx", "app/orders/[publicCode]/page.tsx"];
    for (const file of files) {
      const source = readFile(file);
      expect(source).not.toMatch(/leave a review|star rating|review_id|reviews table|verified review/i);
      expect(source).not.toMatch(/dispute_status|open a dispute|disputes table/i);
      expect(source).not.toMatch(/conversation|inbox|send a message|messages table/i);
    }
  });

  it("exposes no separate Complete action -- confirm receipt is the buyer's only terminal action", () => {
    const source = readFile("components/orders/BuyerOrderActionsClient.tsx");
    expect(source).not.toMatch(/complete order|mark completed/i);
  });
});

describe("cancel_order_changes/confirm_order_changes are wired, not deferred", () => {
  it("changes_pending is a reachable state (Seller Order Management's partial acceptance produces it), so these RPCs are exposed rather than treated as dead controls", () => {
    const source = readFile("lib/orders/order-status-copy.ts");
    // getAllowedBuyerActions must return both actions for changes_pending.
    expect(source).toMatch(/case "changes_pending":\s*\n\s*return \["confirm_changes", "cancel_changes"\]/);
  });
});

describe("Buyer Order Actions migration is scoped to exactly one extended read RPC", () => {
  it("0045_buyer_order_detail_cancellation_request replaces get_my_order_detail only, no other function/table/policy", () => {
    const source = readFile("supabase/migrations/0045_buyer_order_detail_cancellation_request.sql");
    expect(source).toMatch(/drop function if exists public\.get_my_order_detail/i);
    expect(source).toMatch(/create function public\.get_my_order_detail/i);
    expect(source).not.toMatch(/create policy|drop policy|alter policy/i);
    expect(source).not.toMatch(/create table|alter table|drop table/i);
    expect(source).not.toMatch(/create type|alter type/i);
    expect(source).not.toMatch(/create or replace function public\.(cancel_pending_order|request_order_cancellation|confirm_order_received|cancel_order_changes|confirm_order_changes)/i);
  });

  it("get_my_order_detail's grants remain authenticated-only, never anon", () => {
    const source = readFile("supabase/migrations/0045_buyer_order_detail_cancellation_request.sql");
    expect(source).toMatch(/revoke all on function public\.get_my_order_detail\(text\) from anon/i);
    expect(source).toMatch(/grant execute on function public\.get_my_order_detail\(text\) to authenticated/i);
  });
});
