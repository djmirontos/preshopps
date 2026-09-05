import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const rpcMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ rpc: rpcMock })),
}));

vi.mock("@/lib/supabase/env", () => ({
  getSupabaseEnv: () => ({ url: "https://example.supabase.co", anonKey: "test-anon-key" }),
}));

import { getShopListings } from "@/lib/marketplace/shop-listings";
import type { BrowseListingRow } from "@/lib/marketplace/browse-listings";

const shopId = "22222222-2222-2222-2222-222222222222";

function makeRow(overrides: Partial<BrowseListingRow>): BrowseListingRow {
  return {
    listing_id: "11111111-1111-1111-1111-111111111111",
    public_code: "PLS-ABC123",
    slug: "test-item-abc123",
    title: "Test Item",
    price_cents: 10000,
    original_price_cents: null,
    is_negotiable: false,
    listing_type: "preloved",
    condition: "good",
    status: "available",
    is_inquiry_only: false,
    created_at: "2026-01-01T00:00:00Z",
    category_id: 1,
    category_name: "Women",
    province_name: "Misamis Occidental",
    city_name: "Tangub City",
    barangay_name: null,
    cover_image_storage_path: null,
    shop_id: shopId,
    shop_slug: "test-shop",
    shop_name: "Test Shop",
    shop_logo_storage_path: null,
    shop_status: "active",
    is_trusted_seller: false,
    ...overrides,
  };
}

describe("getShopListings", () => {
  beforeEach(() => {
    rpcMock.mockReset();
  });

  it("calls browse_listings with p_shop_id and newest sort", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    await getShopListings(shopId, 20);

    expect(rpcMock).toHaveBeenCalledTimes(1);
    const [fnName, args] = rpcMock.mock.calls[0];
    expect(fnName).toBe("browse_listings");
    expect(args.p_shop_id).toBe(shopId);
    expect(args.p_sort).toBe("newest");
    expect(args.p_limit).toBe(20);
  });

  it("only ever calls browse_listings -- never a raw listings query, OFFSET, or service role", () => {
    const source = readFileSync(path.join(process.cwd(), "lib/marketplace/shop-listings.ts"), "utf-8");
    expect(source).toContain('rpc("browse_listings"');
    expect(source).not.toMatch(/\.from\(\s*["']listings["']\s*\)/);
    expect(source).not.toMatch(/\boffset\b/i);
    expect(source).not.toMatch(/service_role/i);
  });

  it("maps a populated result and preserves a Reserved listing's status for the card badge", async () => {
    rpcMock.mockResolvedValue({ data: [makeRow({ status: "reserved" })], error: null });
    const result = await getShopListings(shopId, 20);
    expect(result.listings[0].status).toBe("reserved");
  });

  it("computes a nextCursor from the last row when a full page is returned", async () => {
    const rows = [
      makeRow({ listing_id: "a", created_at: "2026-01-02T00:00:00Z" }),
      makeRow({ listing_id: "b", created_at: "2026-01-01T00:00:00Z" }),
    ];
    rpcMock.mockResolvedValue({ data: rows, error: null });
    const result = await getShopListings(shopId, 2);
    expect(result.nextCursor).toEqual({ createdAt: "2026-01-01T00:00:00Z", id: "b" });
  });

  it("returns nextCursor=null when fewer rows than the limit come back (last page)", async () => {
    rpcMock.mockResolvedValue({ data: [makeRow({})], error: null });
    const result = await getShopListings(shopId, 20);
    expect(result.nextCursor).toBeNull();
  });

  it("passes the cursor through on load-more, preserving the same shop id", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    await getShopListings(shopId, 20, { createdAt: "2026-01-01T00:00:00Z", id: "xyz" });

    const [, args] = rpcMock.mock.calls[0];
    expect(args.p_shop_id).toBe(shopId);
    expect(args.p_before_created_at).toBe("2026-01-01T00:00:00Z");
    expect(args.p_before_id).toBe("xyz");
  });

  it("returns hadError=true without throwing on a genuine RPC error", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    const result = await getShopListings(shopId, 20);
    expect(result).toEqual({ listings: [], hadError: true, nextCursor: null });
  });

  it("returns hadError=true when the RPC call throws", async () => {
    rpcMock.mockRejectedValue(new Error("network down"));
    const result = await getShopListings(shopId, 20);
    expect(result.hadError).toBe(true);
  });
});
