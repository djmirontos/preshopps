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

import { searchListings } from "@/lib/marketplace/search-listings";
import type { BrowseListingRow } from "@/lib/marketplace/browse-listings";
import type { ResolvedSearchFilters } from "@/lib/marketplace/search-params";

const baseFilters: ResolvedSearchFilters = {
  q: null,
  categoryId: null,
  listingType: null,
  condition: null,
  minPriceCents: null,
  maxPriceCents: null,
  provinceId: null,
  cityId: null,
  barangayId: null,
  fulfillment: null,
  sort: "newest",
};

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
    shop_id: "22222222-2222-2222-2222-222222222222",
    shop_slug: "test-shop",
    shop_name: "Test Shop",
    shop_logo_storage_path: null,
    shop_status: "active",
    is_trusted_seller: false,
    ...overrides,
  };
}

describe("searchListings", () => {
  beforeEach(() => {
    rpcMock.mockReset();
  });

  it("returns a first page with no cursor sent", async () => {
    rpcMock.mockResolvedValue({ data: [makeRow({})], error: null });
    const result = await searchListings(baseFilters, 20);

    expect(result.hadError).toBe(false);
    expect(result.listings).toHaveLength(1);
    const [, args] = rpcMock.mock.calls[0];
    expect(args.p_before_created_at).toBeNull();
    expect(args.p_before_price_cents).toBeNull();
    expect(args.p_before_id).toBeNull();
  });

  it("computes a nextCursor from the last row when a full page is returned (newest sort)", async () => {
    const rows = [
      makeRow({ listing_id: "a", created_at: "2026-01-02T00:00:00Z" }),
      makeRow({ listing_id: "b", created_at: "2026-01-01T00:00:00Z" }),
    ];
    rpcMock.mockResolvedValue({ data: rows, error: null });

    const result = await searchListings(baseFilters, 2);
    expect(result.nextCursor).toEqual({ createdAt: "2026-01-01T00:00:00Z", id: "b" });
  });

  it("computes a nextCursor keyed on price for price_low/price_high sorts", async () => {
    const rows = [makeRow({ listing_id: "a", price_cents: 500 })];
    rpcMock.mockResolvedValue({ data: rows, error: null });

    const result = await searchListings({ ...baseFilters, sort: "price_low" }, 1);
    expect(result.nextCursor).toEqual({ priceCents: 500, id: "a" });
  });

  it("returns nextCursor=null when fewer rows than the limit come back (last page)", async () => {
    rpcMock.mockResolvedValue({ data: [makeRow({})], error: null });
    const result = await searchListings(baseFilters, 20);
    expect(result.nextCursor).toBeNull();
  });

  it("passes the given cursor through to the RPC call (load-more preserves the same filters)", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    const filters: ResolvedSearchFilters = { ...baseFilters, categoryId: 7, sort: "newest" };
    await searchListings(filters, 20, { createdAt: "2026-01-01T00:00:00Z", id: "xyz" });

    const [fnName, args] = rpcMock.mock.calls[0];
    expect(fnName).toBe("browse_listings");
    expect(args.p_category_id).toBe(7);
    expect(args.p_before_created_at).toBe("2026-01-01T00:00:00Z");
    expect(args.p_before_id).toBe("xyz");
  });

  it("returns hadError=true without throwing when the RPC returns a Postgrest error", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    const result = await searchListings(baseFilters, 20);
    expect(result.hadError).toBe(true);
    expect(result.listings).toEqual([]);
    expect(result.nextCursor).toBeNull();
  });

  it("returns hadError=true when the RPC call throws", async () => {
    rpcMock.mockRejectedValue(new Error("network down"));
    const result = await searchListings(baseFilters, 20);
    expect(result.hadError).toBe(true);
  });

  it("only ever calls the browse_listings RPC, never a raw table query or an OFFSET", () => {
    const source = readFileSync(path.join(process.cwd(), "lib/marketplace/search-listings.ts"), "utf-8");
    expect(source).toContain('rpc("browse_listings"');
    expect(source).not.toMatch(/\.from\(\s*["']listings["']\s*\)/);
    expect(source).not.toMatch(/\boffset\b/i);
  });

  it("never uses a service-role client", () => {
    const source = readFileSync(path.join(process.cwd(), "lib/marketplace/search-listings.ts"), "utf-8");
    expect(source).not.toMatch(/service_role/i);
    expect(source).not.toMatch(/SUPABASE_SERVICE_ROLE/);
  });
});
