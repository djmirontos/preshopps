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

import {
  getHomepageMarketplaceData,
  mapBrowseRowToListingCard,
  type BrowseListingRow,
} from "@/lib/marketplace/browse-listings";

const sampleRow: BrowseListingRow = {
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
  created_at: new Date().toISOString(),
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
};

describe("getHomepageMarketplaceData", () => {
  beforeEach(() => {
    rpcMock.mockReset();
  });

  it("only ever calls the browse_listings RPC (never a raw table query)", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    await getHomepageMarketplaceData();

    expect(rpcMock).toHaveBeenCalledTimes(3);
    for (const [fnName] of rpcMock.mock.calls) {
      expect(fnName).toBe("browse_listings");
    }
  });

  it("fetches Fresh Finds with no type filter and a homepage-sized limit", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    await getHomepageMarketplaceData();

    const freshFindsCall = rpcMock.mock.calls.find(([, args]) => !("p_listing_type" in args));
    expect(freshFindsCall).toBeTruthy();
    expect(freshFindsCall![1]).toMatchObject({ p_sort: "newest", p_limit: 10 });
  });

  it("fetches Pre-loved with p_listing_type = preloved", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    await getHomepageMarketplaceData();

    const call = rpcMock.mock.calls.find(([, args]) => args.p_listing_type === "preloved");
    expect(call).toBeTruthy();
    expect(call![1]).toMatchObject({ p_sort: "newest", p_limit: 5 });
  });

  it("fetches Brand New with p_listing_type = brand_new", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    await getHomepageMarketplaceData();

    const call = rpcMock.mock.calls.find(([, args]) => args.p_listing_type === "brand_new");
    expect(call).toBeTruthy();
    expect(call![1]).toMatchObject({ p_sort: "newest", p_limit: 5 });
  });

  it("uses newest-first semantics for all three calls", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    await getHomepageMarketplaceData();

    for (const [, args] of rpcMock.mock.calls) {
      expect(args.p_sort).toBe("newest");
    }
  });

  it("maps a populated row through to ListingCardData", async () => {
    rpcMock.mockResolvedValue({ data: [sampleRow], error: null });
    const { freshFinds } = await getHomepageMarketplaceData();

    expect(freshFinds.hadError).toBe(false);
    expect(freshFinds.listings[0]).toMatchObject({
      id: sampleRow.listing_id,
      href: "/item/PLS-ABC123",
      title: "Test Item",
      priceCents: 10000,
      listingType: "preloved",
      condition: "good",
      locationLabel: "Tangub City",
      shopName: "Test Shop",
    });
  });

  it("returns hadError=true and empty listings when the RPC returns a Postgrest error, without throwing", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    const { freshFinds } = await getHomepageMarketplaceData();

    expect(freshFinds.hadError).toBe(true);
    expect(freshFinds.listings).toEqual([]);
  });

  it("returns hadError=true when the RPC call throws", async () => {
    rpcMock.mockRejectedValue(new Error("network down"));
    const { freshFinds } = await getHomepageMarketplaceData();

    expect(freshFinds.hadError).toBe(true);
    expect(freshFinds.listings).toEqual([]);
  });

  it("returns hadError=false with an empty array for genuinely zero rows", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    const { freshFinds } = await getHomepageMarketplaceData();

    expect(freshFinds.hadError).toBe(false);
    expect(freshFinds.listings).toEqual([]);
  });

  it("does not inspect any Next.js internal exception digest/string", () => {
    const source = readFileSync(
      path.join(process.cwd(), "lib/marketplace/browse-listings.ts"),
      "utf-8",
    );
    expect(source).not.toMatch(/DYNAMIC_SERVER_USAGE/);
    expect(source).not.toMatch(/NEXT_REDIRECT/);
    expect(source).not.toMatch(/NEXT_NOT_FOUND/);
    expect(source).not.toMatch(/\.digest\b/);
  });
});

describe("mapBrowseRowToListingCard", () => {
  it("omits condition for brand_new listings even though the DB condition value is 'brand_new'", () => {
    const card = mapBrowseRowToListingCard({
      ...sampleRow,
      listing_type: "brand_new",
      condition: "brand_new",
    });
    expect(card.condition).toBeUndefined();
  });

  it("passes a valid condition through for pre-loved listings", () => {
    const card = mapBrowseRowToListingCard({ ...sampleRow, condition: "very_good" });
    expect(card.condition).toBe("very_good");
  });

  it("leaves imageUrl undefined when no storage path is returned", () => {
    const card = mapBrowseRowToListingCard(sampleRow);
    expect(card.imageUrl).toBeUndefined();
  });

  it("builds a public storage URL from the project host when a path is present", () => {
    const card = mapBrowseRowToListingCard({
      ...sampleRow,
      cover_image_storage_path: "listing-images/shop/listing/a.webp",
    });
    expect(card.imageUrl).toBe(
      "https://example.supabase.co/storage/v1/object/public/listing-images/shop/listing/a.webp",
    );
  });

  it("maps original_price_cents null to undefined", () => {
    const card = mapBrowseRowToListingCard(sampleRow);
    expect(card.originalPriceCents).toBeUndefined();
  });

  it("builds the item href from public_code, never from the non-unique slug", () => {
    const card = mapBrowseRowToListingCard({
      ...sampleRow,
      public_code: "PLS-XYZ789",
      slug: "totally-different-slug",
    });
    expect(card.href).toBe("/item/PLS-XYZ789");
  });

  it("maps a reserved row's status through so shop-scoped browsing can show the Reserved badge", () => {
    const card = mapBrowseRowToListingCard({ ...sampleRow, status: "reserved" });
    expect(card.status).toBe("reserved");
  });

  it("leaves status undefined for an available row (global/search feeds never need a badge)", () => {
    const card = mapBrowseRowToListingCard({ ...sampleRow, status: "available" });
    expect(card.status).toBeUndefined();
  });
});
