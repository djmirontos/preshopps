import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { AuthUser } from "@/lib/auth/session";
import type { GetMyListingResult, MyListing } from "@/lib/seller/get-my-listing";
import type { CategoryRef, LocationRef } from "@/lib/marketplace/reference-data";

const {
  getAuthUserMock,
  getMyListingMock,
  getCategoriesMock,
  getProvincesMock,
  getCitiesForProvinceMock,
  getBarangaysForCityMock,
  redirectMock,
  notFoundMock,
  pushMock,
  publishListingMock,
  acceptSellerPoliciesMock,
} = vi.hoisted(() => ({
  getAuthUserMock: vi.fn<() => Promise<AuthUser | null>>(),
  getMyListingMock: vi.fn<(listingId: string) => Promise<GetMyListingResult>>(),
  getCategoriesMock: vi.fn<() => Promise<CategoryRef[]>>(),
  getProvincesMock: vi.fn<() => Promise<LocationRef[]>>(),
  getCitiesForProvinceMock: vi.fn<(provinceId: number) => Promise<LocationRef[]>>(),
  getBarangaysForCityMock: vi.fn<(cityId: number) => Promise<LocationRef[]>>(),
  redirectMock: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  notFoundMock: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  pushMock: vi.fn(),
  publishListingMock: vi.fn(),
  acceptSellerPoliciesMock: vi.fn(),
}));

vi.mock("@/lib/seller/listing-actions", async () => {
  const actual = await vi.importActual<typeof import("@/lib/seller/listing-actions")>("@/lib/seller/listing-actions");
  return {
    ...actual,
    publishListing: publishListingMock,
    acceptSellerPolicies: acceptSellerPoliciesMock,
  };
});

vi.mock("@/lib/auth/session", () => ({
  getAuthUser: getAuthUserMock,
}));

vi.mock("@/lib/seller/get-my-listing", () => ({
  getMyListing: getMyListingMock,
}));

vi.mock("@/lib/marketplace/reference-data", () => ({
  getCategories: getCategoriesMock,
  getProvinces: getProvincesMock,
  getCitiesForProvince: getCitiesForProvinceMock,
  getBarangaysForCity: getBarangaysForCityMock,
}));

vi.mock("@/lib/marketplace/listing-image-url", () => ({
  getListingImageUrl: (path: string | null) => (path ? `https://example.supabase.co/storage/v1/object/public/${path}` : undefined),
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
  notFound: notFoundMock,
  useRouter: () => ({ push: pushMock }),
}));

import SellListingEditPage from "@/app/sell/[listingId]/edit/page";

function sampleListing(overrides: Partial<MyListing> = {}): MyListing {
  return {
    listingId: "listing-1",
    publicCode: "PSL-ABC123",
    slug: "nike-air-max-270",
    status: "draft",
    title: "Nike Air Max 270",
    description: null,
    categoryId: null,
    listingType: null,
    condition: null,
    priceCents: null,
    originalPriceCents: null,
    isNegotiable: false,
    brand: null,
    knownFlaws: null,
    stockQuantity: 1,
    provinceId: null,
    cityId: null,
    barangayId: null,
    meetupNote: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    publishedAt: null,
    fulfillmentMethods: [],
    images: [],
    vehicleDetails: null,
    rentalDetails: null,
    ...overrides,
  };
}

function params(listingId = "listing-1") {
  return Promise.resolve({ listingId });
}

describe("SellListingEditPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCategoriesMock.mockResolvedValue([{ id: 1, slug: "women", name: "Women" }]);
    getProvincesMock.mockResolvedValue([{ id: 1, name: "Misamis Occidental" }]);
    getCitiesForProvinceMock.mockResolvedValue([{ id: 10, name: "Tangub City" }]);
    getBarangaysForCityMock.mockResolvedValue([{ id: 100, name: "Barangay Uno" }]);
  });

  it("redirects a guest to sign-in with the listing-specific next path", async () => {
    getAuthUserMock.mockResolvedValue(null);
    await expect(SellListingEditPage({ params: params("listing-1") })).rejects.toThrow(
      "NEXT_REDIRECT:/sign-in?next=%2Fsell%2Flisting-1%2Fedit",
    );
    expect(getMyListingMock).not.toHaveBeenCalled();
  });

  it("calls the safe not-found path for a listing that doesn't exist or isn't owned by the caller", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: "seller@example.com" });
    getMyListingMock.mockResolvedValue({ status: "not_found" });

    await expect(SellListingEditPage({ params: params("listing-1") })).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("shows a generic message on an unexpected read error, without crashing", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: "seller@example.com" });
    getMyListingMock.mockResolvedValue({ status: "error" });

    render(await SellListingEditPage({ params: params("listing-1") }));

    expect(screen.getByText(/unable to load this listing/i)).toBeInTheDocument();
  });

  it("loads the form for a Draft listing, prefilled from get_my_listing", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: "seller@example.com" });
    getMyListingMock.mockResolvedValue({ status: "found", listing: sampleListing() });

    render(await SellListingEditPage({ params: params("listing-1") }));

    expect(screen.getByRole("heading", { level: 1, name: "Edit Draft" })).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toHaveValue("Nike Air Max 270");
    expect(screen.getByRole("button", { name: "Save Draft" })).toBeInTheDocument();
  });

  it("renders the images picker showing the listing's existing photos", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: "seller@example.com" });
    getMyListingMock.mockResolvedValue({
      status: "found",
      listing: sampleListing({
        images: [{ id: "img-1", storagePath: "listing-images/u1/listing-1/a.jpg", position: 0, isReferenceImage: false }],
      }),
    });

    render(await SellListingEditPage({ params: params("listing-1") }));

    expect(screen.getByText("1 of 8 photos")).toBeInTheDocument();
    expect(screen.getByText("Cover")).toBeInTheDocument();
  });

  it("renders the images picker in a zero-photo state for a listing with no images yet", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: "seller@example.com" });
    getMyListingMock.mockResolvedValue({ status: "found", listing: sampleListing({ images: [] }) });

    render(await SellListingEditPage({ params: params("listing-1") }));

    expect(screen.getByText("0 of 8 photos")).toBeInTheDocument();
  });

  it("prefills an incomplete Draft's blank/null fields as empty, without crashing", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: "seller@example.com" });
    getMyListingMock.mockResolvedValue({ status: "found", listing: sampleListing() });

    render(await SellListingEditPage({ params: params("listing-1") }));

    expect(screen.getByLabelText(/description/i)).toHaveValue("");
    expect(screen.getByLabelText(/^price \(optional\)/i)).toHaveValue("");
    expect(screen.getByLabelText(/brand/i)).toHaveValue("");
    expect(screen.getByLabelText(/^category/i)).toHaveValue("");
  });

  it("displays a stored price in pesos, converted from cents", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: "seller@example.com" });
    getMyListingMock.mockResolvedValue({ status: "found", listing: sampleListing({ priceCents: 1999, originalPriceCents: 2500 }) });

    render(await SellListingEditPage({ params: params("listing-1") }));

    expect(screen.getByLabelText(/^price \(optional\)/i)).toHaveValue("19.99");
    expect(screen.getByLabelText(/original price/i)).toHaveValue("25.00");
  });

  it("displays a stored ₱0 price as 0.00, not blank", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: "seller@example.com" });
    getMyListingMock.mockResolvedValue({ status: "found", listing: sampleListing({ priceCents: 0 }) });

    render(await SellListingEditPage({ params: params("listing-1") }));

    expect(screen.getByLabelText(/^price \(optional\)/i)).toHaveValue("0.00");
  });

  it("loads city/barangay reference options for the listing's stored location", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: "seller@example.com" });
    getMyListingMock.mockResolvedValue({
      status: "found",
      listing: sampleListing({ provinceId: 1, cityId: 10, barangayId: 100 }),
    });

    render(await SellListingEditPage({ params: params("listing-1") }));

    expect(getCitiesForProvinceMock).toHaveBeenCalledWith(1);
    expect(getBarangaysForCityMock).toHaveBeenCalledWith(10);
    expect(screen.getByLabelText("Province")).toHaveValue("1");
    expect(screen.getByLabelText("City / Municipality")).toHaveValue("10");
  });

  it("does not fetch barangays when the listing has no barangay set", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: "seller@example.com" });
    getMyListingMock.mockResolvedValue({
      status: "found",
      listing: sampleListing({ provinceId: 1, cityId: 10, barangayId: null }),
    });

    render(await SellListingEditPage({ params: params("listing-1") }));

    expect(getBarangaysForCityMock).not.toHaveBeenCalled();
  });

  it("shows a not-editable state, with a link to the public listing, for a non-draft listing", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: "seller@example.com" });
    getMyListingMock.mockResolvedValue({ status: "found", listing: sampleListing({ status: "available" }) });

    render(await SellListingEditPage({ params: params("listing-1") }));

    expect(screen.getByRole("heading", { level: 1, name: /isn.t editable here/i })).toBeInTheDocument();
    expect(screen.queryByLabelText("Title")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View listing" })).toHaveAttribute("href", "/item/PSL-ABC123");
  });

  it("never fetches reference data (categories/provinces) for a non-draft listing", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: "seller@example.com" });
    getMyListingMock.mockResolvedValue({ status: "found", listing: sampleListing({ status: "paused" }) });

    render(await SellListingEditPage({ params: params("listing-1") }));

    expect(getCategoriesMock).not.toHaveBeenCalled();
  });

  it("exactly one h1 renders for the editable case", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: "seller@example.com" });
    getMyListingMock.mockResolvedValue({ status: "found", listing: sampleListing() });

    render(await SellListingEditPage({ params: params("listing-1") }));
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  describe("Publish", () => {
    it("shows the Publish action alongside Save Draft for a Draft listing", async () => {
      getAuthUserMock.mockResolvedValue({ id: "u1", email: "seller@example.com" });
      getMyListingMock.mockResolvedValue({ status: "found", listing: sampleListing() });

      render(await SellListingEditPage({ params: params("listing-1") }));

      expect(screen.getByRole("button", { name: "Save Draft" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Publish Listing" })).toBeInTheDocument();
    });

    it("never shows Publish for a non-draft listing (only the not-editable state renders)", async () => {
      getAuthUserMock.mockResolvedValue({ id: "u1", email: "seller@example.com" });
      getMyListingMock.mockResolvedValue({ status: "found", listing: sampleListing({ status: "available" }) });

      render(await SellListingEditPage({ params: params("listing-1") }));

      expect(screen.queryByRole("button", { name: "Publish Listing" })).not.toBeInTheDocument();
    });

    it("clicking Publish on the real page wiring calls publish_listing and navigates to the public listing on success", async () => {
      getAuthUserMock.mockResolvedValue({ id: "u1", email: "seller@example.com" });
      getMyListingMock.mockResolvedValue({ status: "found", listing: sampleListing() });
      publishListingMock.mockResolvedValue({
        ok: true,
        listingId: "listing-1",
        publicCode: "PSL-ABC123",
        slug: "nike-air-max-270",
        status: "available",
        publishedAt: "now",
      });

      render(await SellListingEditPage({ params: params("listing-1") }));
      fireEvent.click(screen.getByRole("button", { name: "Publish Listing" }));

      await waitFor(() => expect(publishListingMock).toHaveBeenCalledWith("listing-1"));
      await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/item/PSL-ABC123"));
    });

    it("disables Publish with a clear message while the seller has unsaved Draft changes", async () => {
      getAuthUserMock.mockResolvedValue({ id: "u1", email: "seller@example.com" });
      getMyListingMock.mockResolvedValue({ status: "found", listing: sampleListing() });

      render(await SellListingEditPage({ params: params("listing-1") }));

      fireEvent.change(screen.getByLabelText(/brand/i), { target: { value: "Adidas" } });

      expect(screen.getByRole("button", { name: "Publish Listing" })).toBeDisabled();
      expect(screen.getByText(/save your draft changes before publishing/i)).toBeInTheDocument();
      expect(publishListingMock).not.toHaveBeenCalled();
    });

    it("opens the seller-policy consent dialog reactively when publish_listing reports SELLER_POLICIES_NOT_ACCEPTED", async () => {
      getAuthUserMock.mockResolvedValue({ id: "u1", email: "seller@example.com" });
      getMyListingMock.mockResolvedValue({ status: "found", listing: sampleListing() });
      publishListingMock.mockResolvedValue({ ok: false, code: "SELLER_POLICIES_NOT_ACCEPTED" });

      render(await SellListingEditPage({ params: params("listing-1") }));
      fireEvent.click(screen.getByRole("button", { name: "Publish Listing" }));

      expect(await screen.findByRole("dialog")).toBeInTheDocument();
      expect(acceptSellerPoliciesMock).not.toHaveBeenCalled();
    });
  });
});
