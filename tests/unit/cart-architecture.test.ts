import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

function readFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf-8");
}

describe("cart data is supplied efficiently (no N+1 per-card fetch)", () => {
  it("resolves the caller's cart quantities exactly once, at the root layout", () => {
    const source = readFile("app/layout.tsx");
    const occurrences = source.match(/getMyCartQuantities\(\)/g) ?? [];
    expect(occurrences.length).toBe(1);
    expect(source).toContain("CartProvider");
  });

  it("the root layout's cart seed and the /cart page share one get_my_cart() call via React cache()", () => {
    const source = readFile("lib/cart/get-my-cart.ts");
    expect(source).toMatch(/export const getMyCartRows = cache\(/);
    expect(source).toMatch(/rpc\(\s*["']get_my_cart["']\s*\)/);
    // Only one call site invokes the RPC itself -- both getMyCartQuantities
    // and getMyCart call the shared cached wrapper, never the RPC directly.
    const rpcCallSites = source.match(/supabase\.rpc\(/g) ?? [];
    expect(rpcCallSites.length).toBe(1);
  });

  it("ListingCard never imports a cart-mutation client or RPC -- Add to Cart lives only on the listing detail page", () => {
    const source = readFile("components/marketplace/ListingCard.tsx");
    expect(source).not.toContain("AddToCartButton");
    expect(source).not.toMatch(/rpc\(\s*["']set_cart_item_quantity["']/);
  });

  it("guest cart hydration is bounded by cart size, not catalog size -- one get_listing_detail call per distinct guest cart line, in parallel", () => {
    const source = readFile("lib/cart/hydrate-guest-cart-client.ts");
    expect(source).toMatch(/Promise\.all\(/);
    expect(source).toMatch(/rpc\(\s*["']get_listing_detail["']/);
  });
});

describe("cart mutations never trust client-supplied identity", () => {
  it("AddToCartButton never passes a user/owner id to set_cart_item_quantity", () => {
    const source = readFile("components/cart/AddToCartButton.tsx");
    expect(source).toMatch(/rpc\(\s*["']set_cart_item_quantity["']/);
    expect(source).not.toMatch(/user_id\s*:/);
    expect(source).not.toMatch(/p_user_id/);
  });

  it("AuthenticatedCartClient never passes a user/owner id to set_cart_item_quantity or remove_cart_item", () => {
    const source = readFile("components/cart/AuthenticatedCartClient.tsx");
    expect(source).toMatch(/rpc\(\s*["']set_cart_item_quantity["']/);
    expect(source).toMatch(/rpc\(\s*["']remove_cart_item["']/);
    expect(source).not.toMatch(/user_id\s*:/);
    expect(source).not.toMatch(/p_user_id/);
  });

  it("merge-guest-cart-on-auth never passes a user id -- the caller is identified server-side via auth.uid()", () => {
    const source = readFile("lib/cart/merge-guest-cart-on-auth.ts");
    expect(source).toMatch(/rpc\(\s*["']merge_guest_cart["']/);
    expect(source).not.toMatch(/user_id\s*:/);
  });
});

describe("no service-role bypass anywhere in the cart module", () => {
  it("no cart file references a service-role key", () => {
    const cartFiles = [
      "lib/cart/get-my-cart.ts",
      "lib/cart/guest-cart-storage.ts",
      "lib/cart/merge-guest-cart-on-auth.ts",
      "lib/cart/hydrate-guest-cart-client.ts",
      "components/cart/CartProvider.tsx",
      "components/cart/AddToCartButton.tsx",
      "components/cart/AuthenticatedCartClient.tsx",
      "components/cart/GuestCartClient.tsx",
      "components/cart/CartIconLink.tsx",
      "app/cart/page.tsx",
    ];
    for (const file of cartFiles) {
      const source = readFile(file);
      expect(source.toLowerCase()).not.toContain("service_role");
      expect(source.toLowerCase()).not.toContain("service-role");
    }
  });
});

describe("cart architecture matches the locked design", () => {
  it("no migration was added -- the cart module reuses the existing 0037/0038 backend only", () => {
    // Cart RPC names appear only as call sites in application code, never
    // redefined -- this is a structural sanity check, not a DB assertion.
    const providerSource = readFile("components/cart/CartProvider.tsx");
    expect(providerSource).not.toMatch(/create (or replace )?function/i);
  });

  it("Cart is not added as a sixth bottom-nav tab -- the canonical 5 tabs stay unchanged", () => {
    const source = readFile("components/layout/MobileBottomNav.tsx");
    expect(source).not.toMatch(/CartIconLink/);
    expect(source).not.toMatch(/href="\/cart"/);
  });
});
