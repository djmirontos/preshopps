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

import { getShopDetail, mapShopDetailRow, type GetShopDetailRow } from "@/lib/marketplace/shop-detail";

const sampleRow: GetShopDetailRow = {
  shop_id: "22222222-2222-2222-2222-222222222222",
  requested_slug: "annes-closet",
  current_slug: "annes-closet",
  is_current_slug: true,
  name: "Anne's Closet",
  description: "Quality pre-loved fashion finds.",
  logo_storage_path: null,
  messenger_link: null,
  shop_status: "active",
  is_trusted_seller: false,
  member_since: "2025-01-01T00:00:00Z",
  province_name: "Misamis Occidental",
  city_name: "Tangub City",
  barangay_name: "Barra",
  review_count: 0,
  average_rating: null,
  completed_order_count: 0,
  active_listing_count: 0,
  featured_listing_id: null,
};

describe("getShopDetail", () => {
  beforeEach(() => {
    rpcMock.mockReset();
  });

  it("calls exactly get_shop_detail with p_slug", async () => {
    rpcMock.mockResolvedValue({ data: [sampleRow], error: null });
    await getShopDetail("annes-closet");

    expect(rpcMock).toHaveBeenCalledTimes(1);
    const [fnName, args] = rpcMock.mock.calls[0];
    expect(fnName).toBe("get_shop_detail");
    expect(args).toEqual({ p_slug: "annes-closet" });
  });

  it("only ever calls get_shop_detail -- never a raw shops/listings/profiles/reviews query or service role", () => {
    const source = readFileSync(path.join(process.cwd(), "lib/marketplace/shop-detail.ts"), "utf-8");
    expect(source).toContain('rpc("get_shop_detail"');
    expect(source).not.toMatch(/\.from\(\s*["'](shops|listings|profiles|reviews|orders)["']\s*\)/);
    expect(source).not.toMatch(/service_role/i);
    expect(source).not.toMatch(/SUPABASE_SERVICE_ROLE/);
  });

  it("maps a found row to status=found with the DTO populated", async () => {
    rpcMock.mockResolvedValue({ data: [sampleRow], error: null });
    const result = await getShopDetail("annes-closet");

    expect(result.status).toBe("found");
    if (result.status !== "found") throw new Error("expected found");
    expect(result.shop).toMatchObject({
      id: sampleRow.shop_id,
      slug: "annes-closet",
      name: "Anne's Closet",
      status: "active",
      locationLabel: "Barra, Tangub City, Misamis Occidental",
    });
  });

  it("handles null optional fields safely", async () => {
    rpcMock.mockResolvedValue({ data: [sampleRow], error: null });
    const result = await getShopDetail("annes-closet");
    if (result.status !== "found") throw new Error("expected found");

    expect(result.shop.description).toBe("Quality pre-loved fashion finds.");
    expect(result.shop.logoUrl).toBeUndefined();
    expect(result.shop.messengerLink).toBeNull();
    expect(result.shop.averageRating).toBeNull();
    expect(result.shop.featuredListingId).toBeNull();
  });

  it("returns isCurrentSlug=true when the requested slug matches the current slug", async () => {
    rpcMock.mockResolvedValue({ data: [sampleRow], error: null });
    const result = await getShopDetail("annes-closet");
    if (result.status !== "found") throw new Error("expected found");
    expect(result.isCurrentSlug).toBe(true);
  });

  it("returns isCurrentSlug=false and the canonical slug when an old slug is requested", async () => {
    rpcMock.mockResolvedValue({
      data: [{ ...sampleRow, requested_slug: "old-shop-name", current_slug: "annes-closet", is_current_slug: false }],
      error: null,
    });
    const result = await getShopDetail("old-shop-name");
    if (result.status !== "found") throw new Error("expected found");
    expect(result.isCurrentSlug).toBe(false);
    expect(result.shop.slug).toBe("annes-closet");
  });

  it("returns status=not_found when the RPC signals SHOP_NOT_FOUND, without leaking the reason", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "Shop not found.", details: "SHOP_NOT_FOUND" },
    });
    const result = await getShopDetail("does-not-exist");
    expect(result).toEqual({ status: "not_found" });
  });

  it("treats a suspended-seller shop identically to a nonexistent slug", async () => {
    for (const message of ["Shop not found.", "Shop not found (suspended)."]) {
      rpcMock.mockResolvedValueOnce({ data: null, error: { message, details: "SHOP_NOT_FOUND" } });
      const result = await getShopDetail("x");
      expect(result).toEqual({ status: "not_found" });
    }
  });

  it("returns status=not_found when zero rows come back without an error", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    const result = await getShopDetail("annes-closet");
    expect(result).toEqual({ status: "not_found" });
  });

  it("returns status=error (never a false not_found) for a genuine Postgrest error", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "connection reset", details: "" } });
    const result = await getShopDetail("annes-closet");
    expect(result).toEqual({ status: "error" });
  });

  it("returns status=error when the RPC call throws", async () => {
    rpcMock.mockRejectedValue(new Error("network down"));
    const result = await getShopDetail("annes-closet");
    expect(result).toEqual({ status: "error" });
  });

  it("never exposes internal/private fields (owner id) in the DTO", () => {
    const shop = mapShopDetailRow(sampleRow);
    expect(JSON.stringify(shop)).not.toMatch(/owner_id/i);
  });
});
