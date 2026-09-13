import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

function readFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf-8");
}

/** Strips // line comments, /* block comments *\/, and SQL "-- " comments
 * so a static assertion about actual code/SQL can't false-positive on a
 * comment's own prose discussing (by name) the exact pattern being
 * asserted against -- same technique already established in
 * floating-messenger-slice-architecture.test.ts and
 * mobile-conversation-layout-architecture.test.ts. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")
    .replace(/^\s*--.*$/gm, "");
}

const BUY_NOW_FRONTEND_FILES = [
  "components/cart/BuyNowDialog.tsx",
  "components/listing/ListingActions.tsx",
  "components/cart/OrderReviewSubmit.tsx",
  "lib/cart/submit-buy-now-order.ts",
  "lib/cart/build-buy-now-line.ts",
];

const MIGRATION_PATH = "supabase/migrations/0089_buy_now_order_submission.sql";

/**
 * Buy Now (P2 rework) replaces the rejected frontend-only "temporary cart
 * row" approach with a real backend architecture: one shared, non-client-
 * callable canonical order-creation core (create_orders_from_selection)
 * called by both the existing submit_cart_order and the new
 * submit_buy_now_order. This file is the source-level "did we actually
 * share one implementation, and did we actually keep Buy Now structurally
 * independent of the persistent cart" checklist -- behavioral coverage
 * lives in BuyNowDialog.test.tsx, OrderReviewSubmit.test.tsx, and
 * ListingActions.test.tsx.
 */
describe("Buy Now -- migration 0089 exists and touches nothing else", () => {
  it("0089_buy_now_order_submission.sql exists, and no migration newer than it exists yet", () => {
    const migrationFiles = readdirSync(path.join(process.cwd(), "supabase/migrations")).filter((f) => f.endsWith(".sql"));
    expect(migrationFiles).toContain("0089_buy_now_order_submission.sql");
    const newerThan0089 = migrationFiles.filter((f) => f > "0089_buy_now_order_submission.sql");
    expect(newerThan0089).toEqual([]);
    expect(migrationFiles.some((f) => f.startsWith("0086_"))).toBe(false);
  });

  it("creates exactly the three expected functions -- the shared core plus the two public wrappers -- and no new table/enum/RLS policy", () => {
    const source = readFile(MIGRATION_PATH);
    expect(source).toMatch(/create or replace function public\.create_orders_from_selection\(/);
    expect(source).toMatch(/create or replace function public\.submit_cart_order\(/);
    expect(source).toMatch(/create or replace function public\.submit_buy_now_order\(/);
    expect(source).not.toMatch(/create table/i);
    expect(source).not.toMatch(/create type/i);
    expect(source).not.toMatch(/create policy|alter policy|drop policy/i);
  });

  it("does contain the expected revoke/grant statements on functions (privilege management, not RLS policy DDL)", () => {
    const source = readFile(MIGRATION_PATH);
    expect(source).toMatch(/revoke all on function public\.create_orders_from_selection/);
    expect(source).toMatch(/grant execute on function public\.submit_buy_now_order/);
    expect(source).toMatch(/grant execute on function public\.submit_cart_order/);
  });
});

describe("Buy Now -- shared canonical core: one implementation, not two", () => {
  it("submit_cart_order's own function body calls create_orders_from_selection instead of re-implementing eligibility/order creation", () => {
    const source = readFile(MIGRATION_PATH);
    const wrapperStart = source.indexOf("create or replace function public.submit_cart_order(");
    const buyNowStart = source.indexOf("create or replace function public.submit_buy_now_order(");
    const wrapperBody = source.slice(wrapperStart, buyNowStart);
    expect(wrapperBody).toMatch(/select \* from public\.create_orders_from_selection\(/);
    // The genuinely complex, drift-prone rules must NOT be re-typed in the
    // wrapper -- they only ever appear once, inside the core.
    expect(wrapperBody).not.toMatch(/CANNOT_BUY_OWN_LISTING/);
    expect(wrapperBody).not.toMatch(/QUANTITY_UNAVAILABLE/);
    expect(wrapperBody).not.toMatch(/PRICE_CHANGED/);
  });

  it("submit_buy_now_order's own function body also calls create_orders_from_selection, and never re-implements those same rules either", () => {
    const source = readFile(MIGRATION_PATH);
    const buyNowStart = source.indexOf("create or replace function public.submit_buy_now_order(");
    const buyNowBody = source.slice(buyNowStart);
    expect(buyNowBody).toMatch(/select \* from public\.create_orders_from_selection\(/);
    expect(buyNowBody).not.toMatch(/CANNOT_BUY_OWN_LISTING/);
    expect(buyNowBody).not.toMatch(/QUANTITY_UNAVAILABLE/);
    expect(buyNowBody).not.toMatch(/PRICE_CHANGED/);
  });

  it("CANNOT_BUY_OWN_LISTING/QUANTITY_UNAVAILABLE/PRICE_CHANGED each appear exactly once in the migration's actual code (comments aside) -- proof there is only one copy of each rule", () => {
    const source = stripComments(readFile(MIGRATION_PATH));
    for (const code of ["CANNOT_BUY_OWN_LISTING", "QUANTITY_UNAVAILABLE", "PRICE_CHANGED"]) {
      const occurrences = source.split(code).length - 1;
      expect(occurrences).toBe(1);
    }
  });

  it("the core creates exactly one order per shop and never reserves inventory -- no write to inventory_reservations or listings.reserved_quantity/status anywhere in this migration", () => {
    const source = readFile(MIGRATION_PATH);
    expect(source).not.toMatch(/insert into public\.inventory_reservations/);
    expect(source).not.toMatch(/update public\.listings/);
    expect(source).toMatch(/accept_order_items remains the sole reservation point/);
  });
});

describe("Buy Now -- private helper is never client-callable", () => {
  it("create_orders_from_selection's EXECUTE is explicitly revoked from public, anon, authenticated, AND service_role", () => {
    const source = readFile(MIGRATION_PATH);
    for (const role of ["public", "anon", "authenticated", "service_role"]) {
      expect(source).toMatch(
        new RegExp(`revoke all on function public\\.create_orders_from_selection\\(jsonb, jsonb, text\\) from ${role};`),
      );
    }
    // Never granted to any role at all.
    expect(source).not.toMatch(/grant execute on function public\.create_orders_from_selection/);
  });

  it("submit_cart_order and submit_buy_now_order both keep the standard authenticated-only, anon-revoked posture", () => {
    const source = readFile(MIGRATION_PATH);
    expect(source).toMatch(/revoke all on function public\.submit_cart_order\(uuid\[\], jsonb, text\) from anon;/);
    expect(source).toMatch(/grant execute on function public\.submit_cart_order\(uuid\[\], jsonb, text\) to authenticated;/);
    expect(source).toMatch(
      /revoke all on function public\.submit_buy_now_order\(uuid, integer, public\.fulfillment_method_enum, bigint, text\) from anon;/,
    );
    expect(source).toMatch(
      /grant execute on function public\.submit_buy_now_order\(uuid, integer, public\.fulfillment_method_enum, bigint, text\) to authenticated;/,
    );
  });
});

describe("Buy Now -- submit_cart_order's own resolution never disappears (cart ownership/CART_ITEM_NOT_FOUND stays in the wrapper)", () => {
  it("submit_cart_order still validates and resolves p_cart_item_ids against the caller's own cart before calling the shared core", () => {
    const source = readFile(MIGRATION_PATH);
    const wrapperStart = source.indexOf("create or replace function public.submit_cart_order(");
    const buyNowStart = source.indexOf("create or replace function public.submit_buy_now_order(");
    const wrapperBody = source.slice(wrapperStart, buyNowStart);
    expect(wrapperBody).toMatch(/CART_ITEM_NOT_FOUND/);
    expect(wrapperBody).toMatch(/from public\.cart_items ci/);
    expect(wrapperBody).toMatch(/join public\.carts c on c\.id = ci\.cart_id/);
    expect(wrapperBody).toMatch(/where c\.user_id = v_caller_id/);
  });

  it("submit_cart_order still deletes only the submitted cart rows, and only after the shared core call", () => {
    const source = readFile(MIGRATION_PATH);
    const wrapperStart = source.indexOf("create or replace function public.submit_cart_order(");
    const buyNowStart = source.indexOf("create or replace function public.submit_buy_now_order(");
    const wrapperBody = source.slice(wrapperStart, buyNowStart);
    const coreCallIndex = wrapperBody.indexOf("select * from public.create_orders_from_selection(");
    const deleteIndex = wrapperBody.indexOf("delete from public.cart_items ci");
    expect(coreCallIndex).toBeGreaterThan(-1);
    expect(deleteIndex).toBeGreaterThan(coreCallIndex);
    expect(wrapperBody).toMatch(/delete from public\.cart_items ci\s*\n\s*where ci\.id = any\(p_cart_item_ids\)/);
  });
});

describe("Buy Now -- submit_buy_now_order structurally never touches the persistent cart", () => {
  it("submit_buy_now_order's own function body contains zero code references to cart_items or carts (comments and the trailing human-readable `comment on function` metadata aside)", () => {
    const source = stripComments(readFile(MIGRATION_PATH));
    const buyNowStart = source.indexOf("create or replace function public.submit_buy_now_order(");
    const buyNowEnd = source.indexOf("revoke all on function public.submit_buy_now_order");
    expect(buyNowStart).toBeGreaterThan(-1);
    expect(buyNowEnd).toBeGreaterThan(buyNowStart);
    const buyNowBody = source.slice(buyNowStart, buyNowEnd);
    expect(buyNowBody).not.toMatch(/cart_items/);
    expect(buyNowBody).not.toMatch(/\bcarts\b/);
  });

  it("submit_buy_now_order takes exactly one listing_id/quantity/fulfillment_method/expected_price_cents and delegates the rest", () => {
    const source = readFile(MIGRATION_PATH);
    expect(source).toMatch(
      /create or replace function public\.submit_buy_now_order\(\s*p_listing_id uuid,\s*p_quantity integer,\s*p_fulfillment_method public\.fulfillment_method_enum,\s*p_expected_price_cents bigint,\s*p_buyer_note text default null\s*\)/,
    );
  });
});

describe("Buy Now -- price-drift protection is preserved, not bypassed", () => {
  it("the core's price-drift check compares the live current_price against a caller-supplied expected value -- the client-supplied price is never trusted as authoritative", () => {
    const source = readFile(MIGRATION_PATH);
    expect(source).toMatch(/t\.current_price <> t\.expected_price_cents/);
    expect(source).toMatch(/PRICE_CHANGED/);
  });

  it("order_items.price_cents_snapshot is always written from current_price (the live listings price), never from expected_price_cents", () => {
    const source = readFile(MIGRATION_PATH);
    const insertMatch = source.match(/insert into public\.order_items \([\s\S]*?from tmp_submit_items t;/);
    expect(insertMatch).not.toBeNull();
    expect(insertMatch![0]).toMatch(/t\.current_price/);
    expect(insertMatch![0]).not.toMatch(/expected_price_cents/);
  });
});

describe("Buy Now -- frontend reuses OrderReviewSubmit via dependency injection, not a duplicate UI", () => {
  it("BuyNowDialog renders the real OrderReviewSubmit component", () => {
    const source = readFile("components/cart/BuyNowDialog.tsx");
    expect(source).toMatch(/from ["']@\/components\/cart\/OrderReviewSubmit["']/);
    expect(source).toMatch(/<OrderReviewSubmit\b/);
  });

  it("BuyNowDialog never re-implements shop grouping/fulfillment-intersection logic itself", () => {
    const source = readFile("components/cart/BuyNowDialog.tsx");
    expect(source).not.toMatch(/groupSubmittableByShop|intersectMethods|METHOD_ORDER/);
  });

  it("OrderReviewSubmit exposes submit/refreshLines/removeFromCartOnSuccess as optional props, defaulting to the exact pre-existing /cart behavior", () => {
    const source = readFile("components/cart/OrderReviewSubmit.tsx");
    expect(source).toMatch(/submit = submitCartOrder/);
    expect(source).toMatch(/refreshLines = refreshMyCart/);
    expect(source).toMatch(/removeFromCartOnSuccess = true/);
  });

  it("OrderReviewSubmit only calls useCart().removeItem when removeFromCartOnSuccess is true", () => {
    const source = readFile("components/cart/OrderReviewSubmit.tsx");
    expect(source).toMatch(/if \(removeFromCartOnSuccess\) \{\s*\n\s*for \(const listingId of outcome\.submittedListingIds\) removeItem\(listingId\);/);
  });
});

describe("Buy Now -- no cart-mutating RPC anywhere in the Buy Now frontend files", () => {
  it("no Buy Now frontend file's actual CODE references set_cart_item_quantity or remove_cart_item (comments discussing them by name, to document what was deliberately removed, don't count)", () => {
    for (const file of ["components/cart/BuyNowDialog.tsx", "lib/cart/build-buy-now-line.ts", "lib/cart/submit-buy-now-order.ts"]) {
      const source = stripComments(readFile(file));
      expect(source).not.toMatch(/set_cart_item_quantity/);
      expect(source).not.toMatch(/remove_cart_item/);
    }
  });

  it("BuyNowDialog never imports or calls useCart -- it is structurally independent of CartProvider", () => {
    const source = readFile("components/cart/BuyNowDialog.tsx");
    expect(source).not.toMatch(/useCart/);
  });

  it("build-buy-now-line.ts's actual code calls only get_listing_detail, never get_my_cart", () => {
    const source = stripComments(readFile("lib/cart/build-buy-now-line.ts"));
    expect(source).toMatch(/get_listing_detail/);
    expect(source).not.toMatch(/get_my_cart/);
  });

  it("submit-buy-now-order.ts's actual code calls only submit_buy_now_order -- it may still import shared TYPES from submit-cart-order.ts (reuse, not a second copy), but never calls that RPC itself", () => {
    const source = readFile("lib/cart/submit-buy-now-order.ts");
    expect(source).toMatch(/\.rpc\(\s*["']submit_buy_now_order["']/);
    expect(source).not.toMatch(/\.rpc\(\s*["']submit_cart_order["']/);
  });
});

describe("Buy Now -- security/RLS/service-role hygiene across the frontend files", () => {
  it("no Buy Now frontend file references a service-role key or RLS/policy DDL", () => {
    for (const file of BUY_NOW_FRONTEND_FILES) {
      const source = readFile(file);
      expect(source.toLowerCase()).not.toContain("service_role");
      expect(source.toLowerCase()).not.toContain("service-role");
      expect(source).not.toMatch(/create policy|alter policy|drop policy/i);
    }
  });
});

describe("Buy Now -- listing-detail wiring stays minimal", () => {
  it("ListingActions passes publicCode (not listingId) to BuyNowDialog -- get_listing_detail is keyed by public_code", () => {
    const source = readFile("components/listing/ListingActions.tsx");
    expect(source).toMatch(/<BuyNowDialog publicCode=\{publicCode\}/);
  });

  it("Buy Now is gated behind the exact same isOwnListing/isInquiryOnly/isAvailable conditions as Add to Cart -- same JSX branch, not a separately-guarded action", () => {
    const source = readFile("components/listing/ListingActions.tsx");
    const ownListingIndex = source.indexOf("isOwnListing ? (");
    const messageSellerSectionIndex = source.indexOf("Message Seller", ownListingIndex);
    expect(ownListingIndex).toBeGreaterThan(-1);
    expect(messageSellerSectionIndex).toBeGreaterThan(ownListingIndex);

    const block = source.slice(ownListingIndex, messageSellerSectionIndex);
    expect(block).toMatch(/\) : \(/);
    expect(block).toMatch(/AddToCartButton/);
    expect(block).toMatch(/Buy Now/);
  });

  it("app/item/[publicCode]/page.tsx was not touched by this rework -- still invokes ListingActions with the exact same prop list", () => {
    const source = readFile("app/item/[publicCode]/page.tsx");
    expect(source).toMatch(/<ListingActions/);
    expect(source).not.toMatch(/BuyNowDialog|buildBuyNowLine|submitBuyNowOrder/);
  });
});

describe("Buy Now -- guest gating reuses the existing AuthGate convention, not a new one", () => {
  it("the guest Buy Now path renders the existing AuthGate component with the same safe `next` prop already used by Message Seller", () => {
    const source = readFile("components/listing/ListingActions.tsx");
    const jsxBlockIndex = source.indexOf("{isBuyNowGateOpen && (");
    expect(jsxBlockIndex).toBeGreaterThan(-1);
    const block = source.slice(jsxBlockIndex, jsxBlockIndex + 300);
    expect(block).toMatch(/<AuthGate/);
    expect(block).toMatch(/next=\{next\}/);
  });
});

describe("Buy Now -- post-submit terminal-success fix (P2) stayed frontend-only", () => {
  it("no migration newer than 0089 exists -- this fix touched no backend/RPC/schema", () => {
    const migrationFiles = readdirSync(path.join(process.cwd(), "supabase/migrations")).filter((f) => f.endsWith(".sql"));
    const newerThan0089 = migrationFiles.filter((f) => f > "0089_buy_now_order_submission.sql");
    expect(newerThan0089).toEqual([]);
  });

  it("OrderReviewSubmit still calls only submit_cart_order/get_my_cart as its own defaults -- this fix changed when the form renders, not what it submits to", () => {
    const source = stripComments(readFile("components/cart/OrderReviewSubmit.tsx"));
    expect(source).toMatch(/submit = submitCartOrder/);
    expect(source).toMatch(/refreshLines = refreshMyCart/);
    expect(source).not.toMatch(/\.rpc\(/);
  });

  it("a successful result is now a terminal UI state -- showForm depends only on result.kind and handedOffToCaller, never on how many lines remain", () => {
    const source = stripComments(readFile("components/cart/OrderReviewSubmit.tsx"));
    // showForm's own condition must never reintroduce a dependency on
    // lines.length -- the old bug was exactly `!(result?.kind ===
    // "success" && lines.length === 0)`, which only hid the form once the
    // cart happened to empty out. The remaining lines.length === 0 in
    // this file is the unrelated, still-correct top-of-render early
    // return (`if (lines.length === 0 && !result) return null;`), not
    // part of showForm's own condition.
    expect(source).toMatch(/const showForm = result\?\.kind !== "success" && !handedOffToCaller;/);
    expect(source).not.toMatch(/showForm = !\(result/);
    expect(source).not.toMatch(/showForm = result\?\.kind !== "success";\s*\n/);
  });

  it("handleSubmit itself refuses to run again once a success result already exists or has been handed off to onSuccess -- defense in depth beyond the button simply not being rendered", () => {
    const source = stripComments(readFile("components/cart/OrderReviewSubmit.tsx"));
    expect(source).toMatch(/if \(!canSubmit \|\| result\?\.kind === "success" \|\| handedOffToCaller\) return;/);
  });

  it("submit_cart_order and submit_buy_now_order's own SQL definitions are untouched by this fix (0089 is unchanged, no 0090 migration exists)", () => {
    const source = readFile("supabase/migrations/0089_buy_now_order_submission.sql");
    expect(source).toMatch(/create or replace function public\.submit_cart_order\(/);
    expect(source).toMatch(/create or replace function public\.submit_buy_now_order\(/);
  });
});

describe("Buy Now -- post-submit navigation fix (P3): straight to order detail, no intermediate success card", () => {
  it("no migration newer than 0089 exists -- this fix is frontend-only", () => {
    const migrationFiles = readdirSync(path.join(process.cwd(), "supabase/migrations")).filter((f) => f.endsWith(".sql"));
    const newerThan0089 = migrationFiles.filter((f) => f > "0089_buy_now_order_submission.sql");
    expect(newerThan0089).toEqual([]);
  });

  it("OrderReviewSubmit exposes an optional onSuccess callback that defaults to undefined -- /cart's own usage is unaffected unless it opts in", () => {
    const source = stripComments(readFile("components/cart/OrderReviewSubmit.tsx"));
    expect(source).toMatch(/onSuccess\?:\s*\(orders: SubmittedOrder\[\]\) => void;/);
    expect(source).not.toMatch(/onSuccess\s*=\s*[^,}]/); // no default value -- stays undefined unless a caller passes one
  });

  it("onSuccess is only ever invoked from inside the outcome.ok branch -- never on a failed submission", () => {
    const source = stripComments(readFile("components/cart/OrderReviewSubmit.tsx"));
    const okBranchStart = source.indexOf("if (outcome.ok) {");
    const elseIndex = source.indexOf("} else {", okBranchStart);
    expect(okBranchStart).toBeGreaterThan(-1);
    expect(elseIndex).toBeGreaterThan(okBranchStart);
    const okBranch = source.slice(okBranchStart, elseIndex);
    const elseBranch = source.slice(elseIndex, elseIndex + 200);
    expect(okBranch).toMatch(/onSuccess\(outcome\.orders\)/);
    expect(elseBranch).not.toMatch(/onSuccess/);
  });

  it("BuyNowDialog navigates to the exact same canonical buyer order-detail route every other View Order link already uses (/orders/{publicCode}), never the general /orders list", () => {
    const source = readFile("components/cart/BuyNowDialog.tsx");
    expect(source).toMatch(/router\.push\(`\/orders\/\$\{order\.orderPublicCode\}`\)/);
    expect(source).not.toMatch(/router\.push\(["']\/orders["']\)/);
  });

  it("the same /orders/{publicCode} convention is already used elsewhere in the app (OrdersListClient, ReviewFormClient, the review page) -- BuyNowDialog did not invent a second URL format", () => {
    for (const file of [
      "components/orders/OrdersListClient.tsx",
      "components/orders/ReviewFormClient.tsx",
      "app/orders/[publicCode]/review/page.tsx",
    ]) {
      const source = readFile(file);
      expect(source).toMatch(/\/orders\/\$\{[a-zA-Z.]*orderPublicCode\}/);
    }
  });

  it("BuyNowDialog calls onClose as part of handling a successful submission -- the dialog is not left open behind the navigation", () => {
    const source = stripComments(readFile("components/cart/BuyNowDialog.tsx"));
    const handleSuccessStart = source.indexOf("function handleSuccess(");
    expect(handleSuccessStart).toBeGreaterThan(-1);
    const handleSuccessBody = source.slice(handleSuccessStart, handleSuccessStart + 300);
    expect(handleSuccessBody).toMatch(/onClose\(\)/);
    expect(handleSuccessBody).toMatch(/router\.push/);
  });

  it("no setTimeout/artificial delay was introduced anywhere in the Buy Now navigation path", () => {
    for (const file of ["components/cart/BuyNowDialog.tsx", "components/cart/OrderReviewSubmit.tsx"]) {
      const source = readFile(file);
      expect(source).not.toMatch(/setTimeout/);
    }
  });

  it("this fix does not duplicate submission logic -- BuyNowDialog's own submit() still delegates to submitBuyNowOrder, never a second implementation", () => {
    const source = stripComments(readFile("components/cart/BuyNowDialog.tsx"));
    expect(source).toMatch(/return submitBuyNowOrder\(/);
    const directRpcCalls = [...source.matchAll(/\.rpc\(\s*["']([a-z_]+)["']/g)].map((m) => m[1]);
    expect(directRpcCalls).toEqual([]);
  });
});
