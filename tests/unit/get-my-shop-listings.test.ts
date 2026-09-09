import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock, createClientMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  createClientMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: createClientMock,
}));

createClientMock.mockResolvedValue({ rpc: rpcMock });

import { getMyShopListings } from "@/lib/seller/get-my-shop-listings";

function row(overrides: Record<string, unknown> = {}) {
  return {
    listing_id: "listing-1",
    public_code: "PSL-ABC12345",
    slug: "nike-air-max-270",
    title: "Nike Air Max 270",
    status: "available",
    price_cents: 199900,
    stock_quantity: 3,
    reserved_quantity: 0,
    available_quantity: 3,
    cover_image_path: "listing-images/u1/listing-1/a.jpg",
    category_id: 2,
    listing_type: "preloved",
    condition: "good",
    created_at: "2026-01-05T00:00:00.000Z",
    updated_at: "2026-01-05T00:00:00.000Z",
    published_at: "2026-01-05T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  rpcMock.mockReset();
});

describe("getMyShopListings", () => {
  it("calls get_my_shop_listings with limit, null status, and null cursor on the unfiltered first page", async () => {
    rpcMock.mockResolvedValue({ data: [row()], error: null });
    await getMyShopListings(20);
    expect(rpcMock).toHaveBeenCalledWith("get_my_shop_listings", {
      p_status: null,
      p_limit: 20,
      p_before_created_at: null,
      p_before_id: null,
    });
  });

  it("passes the status filter through unchanged", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    await getMyShopListings(20, "paused");
    expect(rpcMock).toHaveBeenCalledWith("get_my_shop_listings", {
      p_status: "paused",
      p_limit: 20,
      p_before_created_at: null,
      p_before_id: null,
    });
  });

  it("passes the cursor through on subsequent pages", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    await getMyShopListings(20, "available", { createdAt: "2026-01-01T00:00:00.000Z", id: "listing-5" });
    expect(rpcMock).toHaveBeenCalledWith("get_my_shop_listings", {
      p_status: "available",
      p_limit: 20,
      p_before_created_at: "2026-01-01T00:00:00.000Z",
      p_before_id: "listing-5",
    });
  });

  it("maps rows to MyShopListingSummary, including quantities and the cover image path", async () => {
    rpcMock.mockResolvedValue({ data: [row()], error: null });
    const result = await getMyShopListings(20);
    expect(result.hadError).toBe(false);
    expect(result.listings).toEqual([
      {
        listingId: "listing-1",
        publicCode: "PSL-ABC12345",
        slug: "nike-air-max-270",
        title: "Nike Air Max 270",
        status: "available",
        priceCents: 199900,
        stockQuantity: 3,
        reservedQuantity: 0,
        availableQuantity: 3,
        coverImagePath: "listing-images/u1/listing-1/a.jpg",
        categoryId: 2,
        listingType: "preloved",
        condition: "good",
        createdAt: "2026-01-05T00:00:00.000Z",
        updatedAt: "2026-01-05T00:00:00.000Z",
        publishedAt: "2026-01-05T00:00:00.000Z",
      },
    ]);
  });

  it("maps a title-only Draft's null fields cleanly, without crashing", async () => {
    rpcMock.mockResolvedValue({
      data: [
        row({
          status: "draft",
          price_cents: null,
          cover_image_path: null,
          category_id: null,
          listing_type: null,
          condition: null,
          published_at: null,
        }),
      ],
      error: null,
    });
    const result = await getMyShopListings(20, "draft");
    expect(result.listings[0]).toEqual(
      expect.objectContaining({
        status: "draft",
        priceCents: null,
        coverImagePath: null,
        categoryId: null,
        listingType: null,
        condition: null,
        publishedAt: null,
      }),
    );
  });

  it("returns a nextCursor derived from the last row when a full page is returned", async () => {
    rpcMock.mockResolvedValue({
      data: [row({ listing_id: "l1", created_at: "2026-01-05T00:00:00.000Z" }), row({ listing_id: "l2", created_at: "2026-01-04T00:00:00.000Z" })],
      error: null,
    });
    const result = await getMyShopListings(2);
    expect(result.nextCursor).toEqual({ createdAt: "2026-01-04T00:00:00.000Z", id: "l2" });
  });

  it("returns nextCursor: null when fewer rows than the limit come back (last page)", async () => {
    rpcMock.mockResolvedValue({ data: [row()], error: null });
    const result = await getMyShopListings(20);
    expect(result.nextCursor).toBeNull();
  });

  it("returns hadError true, empty listings, on an RPC error", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    const result = await getMyShopListings(20);
    expect(result).toEqual({ listings: [], hadError: true, nextCursor: null });
  });

  it("returns hadError true when the RPC throws", async () => {
    rpcMock.mockRejectedValue(new Error("network down"));
    const result = await getMyShopListings(20);
    expect(result).toEqual({ listings: [], hadError: true, nextCursor: null });
  });

  it("returns an empty list (not an error) when the caller has no shop, or none match the filter", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    const result = await getMyShopListings(20, "sold");
    expect(result).toEqual({ listings: [], hadError: false, nextCursor: null });
  });
});
