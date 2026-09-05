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
  getListingDetail,
  mapDetailRowToListingDetail,
  type GetListingDetailRow,
} from "@/lib/marketplace/listing-detail";

const sampleRow: GetListingDetailRow = {
  listing_id: "11111111-1111-1111-1111-111111111111",
  public_code: "PLS-ABC123",
  slug: "test-item-abc123",
  title: "Test Item",
  description: "A great item.\nSecond line.",
  listing_type: "preloved",
  condition: "good",
  known_flaws: null,
  brand: null,
  price_cents: 10000,
  original_price_cents: null,
  is_negotiable: false,
  status: "available",
  available_quantity: 1,
  meetup_note: null,
  published_at: "2026-01-01T00:00:00Z",
  created_at: "2026-01-01T00:00:00Z",
  category_id: 1,
  category_name: "Women",
  is_inquiry_only: false,
  province_name: "Misamis Occidental",
  city_name: "Tangub City",
  barangay_name: "Barra",
  image_paths: [],
  fulfillment_methods: ["meetup"],
  shop_id: "22222222-2222-2222-2222-222222222222",
  shop_slug: "test-shop",
  shop_name: "Test Shop",
  shop_description: null,
  shop_logo_storage_path: null,
  shop_messenger_link: null,
  shop_status: "active",
  shop_is_trusted_seller: false,
  shop_member_since: "2025-01-01T00:00:00Z",
  review_count: 0,
  average_rating: null,
  vehicle_brand: null,
  vehicle_model: null,
  vehicle_year: null,
  vehicle_mileage_km: null,
  vehicle_transmission: null,
  vehicle_fuel_type: null,
  vehicle_registration_status: null,
  vehicle_documents_available: null,
  rental_price_cents: null,
  rental_period: null,
  rental_security_deposit_cents: null,
  rental_terms: null,
  rental_minimum_rental_period: null,
  rental_capacity: null,
  rental_whats_included: null,
  rental_rules_restrictions: null,
  rental_availability: null,
};

describe("getListingDetail", () => {
  beforeEach(() => {
    rpcMock.mockReset();
  });

  it("calls exactly the get_listing_detail RPC with p_public_code", async () => {
    rpcMock.mockResolvedValue({ data: [sampleRow], error: null });
    await getListingDetail("PLS-ABC123");

    expect(rpcMock).toHaveBeenCalledTimes(1);
    const [fnName, args] = rpcMock.mock.calls[0];
    expect(fnName).toBe("get_listing_detail");
    expect(args).toEqual({ p_public_code: "PLS-ABC123" });
  });

  it("only ever calls get_listing_detail -- never a raw listings query or service role", () => {
    const source = readFileSync(path.join(process.cwd(), "lib/marketplace/listing-detail.ts"), "utf-8");
    expect(source).toContain('rpc("get_listing_detail"');
    expect(source).not.toMatch(/\.from\(\s*["']listings["']\s*\)/);
    expect(source).not.toMatch(/service_role/i);
    expect(source).not.toMatch(/SUPABASE_SERVICE_ROLE/);
  });

  it("maps a found row to status=found with the DTO populated", async () => {
    rpcMock.mockResolvedValue({ data: [sampleRow], error: null });
    const result = await getListingDetail("PLS-ABC123");

    expect(result.status).toBe("found");
    if (result.status !== "found") throw new Error("expected found");
    expect(result.listing).toMatchObject({
      id: sampleRow.listing_id,
      publicCode: "PLS-ABC123",
      title: "Test Item",
      priceCents: 10000,
      listingType: "preloved",
      condition: "good",
      status: "available",
      locationLabel: "Barra, Tangub City, Misamis Occidental",
    });
  });

  it("returns status=not_found when the RPC signals LISTING_NOT_FOUND, without leaking the reason", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "Listing not found.", details: "LISTING_NOT_FOUND" },
    });
    const result = await getListingDetail("does-not-exist");
    expect(result).toEqual({ status: "not_found" });
  });

  it("treats every LISTING_NOT_FOUND case identically regardless of the underlying reason", async () => {
    for (const message of ["Listing not found.", "Listing not found (draft).", "Listing not found (suspended)."]) {
      rpcMock.mockResolvedValueOnce({ data: null, error: { message, details: "LISTING_NOT_FOUND" } });
      const result = await getListingDetail("x");
      expect(result).toEqual({ status: "not_found" });
    }
  });

  it("returns status=not_found when zero rows come back without an error", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    const result = await getListingDetail("PLS-ABC123");
    expect(result).toEqual({ status: "not_found" });
  });

  it("returns status=error (never a false not_found) for a genuine Postgrest error", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "connection reset", details: "" } });
    const result = await getListingDetail("PLS-ABC123");
    expect(result).toEqual({ status: "error" });
  });

  it("returns status=error when the RPC call throws", async () => {
    rpcMock.mockRejectedValue(new Error("network down"));
    const result = await getListingDetail("PLS-ABC123");
    expect(result).toEqual({ status: "error" });
  });
});

describe("mapDetailRowToListingDetail", () => {
  it("handles null optional fields safely", () => {
    const listing = mapDetailRowToListingDetail(sampleRow);
    expect(listing.originalPriceCents).toBeUndefined();
    expect(listing.knownFlaws).toBeNull();
    expect(listing.meetupNote).toBeNull();
    expect(listing.shop.messengerLink).toBeNull();
    expect(listing.averageRating).toBeNull();
  });

  it("omits condition for brand_new listings even though the DB condition value is 'brand_new'", () => {
    const listing = mapDetailRowToListingDetail({ ...sampleRow, listing_type: "brand_new", condition: "brand_new" });
    expect(listing.condition).toBeUndefined();
  });

  it("composes province/city/barangay location safely, omitting a missing level", () => {
    const full = mapDetailRowToListingDetail(sampleRow);
    expect(full.locationLabel).toBe("Barra, Tangub City, Misamis Occidental");

    const noBarangay = mapDetailRowToListingDetail({ ...sampleRow, barangay_name: null });
    expect(noBarangay.locationLabel).toBe("Tangub City, Misamis Occidental");
  });

  it("leaves imageUrls empty when no image paths are returned", () => {
    const listing = mapDetailRowToListingDetail(sampleRow);
    expect(listing.imageUrls).toEqual([]);
  });

  it("builds public storage URLs for every returned image path", () => {
    const listing = mapDetailRowToListingDetail({
      ...sampleRow,
      image_paths: ["listing-images/a.webp", "listing-images/b.webp"],
    });
    expect(listing.imageUrls).toEqual([
      "https://example.supabase.co/storage/v1/object/public/listing-images/a.webp",
      "https://example.supabase.co/storage/v1/object/public/listing-images/b.webp",
    ]);
  });

  it("never exposes internal/private fields (stock/reserved quantities, owner id) in the DTO", () => {
    const listing = mapDetailRowToListingDetail(sampleRow);
    const serialized = JSON.stringify(listing);
    expect(serialized).not.toMatch(/stock_quantity|reserved_quantity|owner_id/i);
  });

  it("maps vehicle_* fields to vehicleDetails when at least one is present", () => {
    const listing = mapDetailRowToListingDetail({
      ...sampleRow,
      vehicle_brand: "Toyota",
      vehicle_model: "Vios",
      vehicle_year: 2019,
      vehicle_mileage_km: 45000,
      vehicle_transmission: "Manual",
      vehicle_fuel_type: "Gasoline",
      vehicle_registration_status: "registered",
      vehicle_documents_available: ["OR/CR"],
    });
    expect(listing.vehicleDetails).toEqual({
      brand: "Toyota",
      model: "Vios",
      year: 2019,
      mileageKm: 45000,
      transmission: "Manual",
      fuelType: "Gasoline",
      registrationStatus: "registered",
      documentsAvailable: ["OR/CR"],
    });
  });

  it("leaves vehicleDetails null for an ordinary listing (all vehicle_* fields null)", () => {
    const listing = mapDetailRowToListingDetail(sampleRow);
    expect(listing.vehicleDetails).toBeNull();
  });

  it("maps rental_* fields to rentalDetails when at least one is present", () => {
    const listing = mapDetailRowToListingDetail({
      ...sampleRow,
      rental_price_cents: 50000,
      rental_period: "daily",
      rental_security_deposit_cents: 100000,
      rental_availability: "available",
    });
    expect(listing.rentalDetails).toMatchObject({
      priceCents: 50000,
      period: "daily",
      securityDepositCents: 100000,
      availability: "available",
    });
  });

  it("leaves rentalDetails null for an ordinary listing (all rental_* fields null)", () => {
    const listing = mapDetailRowToListingDetail(sampleRow);
    expect(listing.rentalDetails).toBeNull();
  });

  it("treats a lone non-null vehicle field as enough to build the block (null fields stay null within it)", () => {
    const listing = mapDetailRowToListingDetail({ ...sampleRow, vehicle_brand: "Toyota" });
    expect(listing.vehicleDetails).toEqual({
      brand: "Toyota",
      model: null,
      year: null,
      mileageKm: null,
      transmission: null,
      fuelType: null,
      registrationStatus: null,
      documentsAvailable: [],
    });
  });
});

describe("next.config.ts image allowlist", () => {
  it("remains unchanged by this task (exact Supabase Storage host/path only)", () => {
    const source = readFileSync(path.join(process.cwd(), "next.config.ts"), "utf-8");
    expect(source).toContain("ylhfbqcyxjmxrbpkxtgu.supabase.co");
    expect(source).toContain("/storage/v1/object/public/**");
    expect(source).not.toContain('hostname: "*"');
  });
});
