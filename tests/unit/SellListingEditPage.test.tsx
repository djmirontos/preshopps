import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { AuthUser } from "@/lib/auth/session";
import type { GetMyListingResult, MyListing } from "@/lib/seller/get-my-listing";
import type { GetPublishedListingEditStateResult, PublishedListingEditState } from "@/lib/seller/published-listing-actions";
import type { CategoryRef, LocationRef } from "@/lib/marketplace/reference-data";

const {
  getAuthUserMock,
  getMyListingMock,
  getPublishedListingEditStateMock,
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
  getPublishedListingEditStateMock: vi.fn<(listingId: string) => Promise<GetPublishedListingEditStateResult>>(),
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

// page.tsx uses the server-safe loader, never the browser wrapper -- see
// published-listing-edit-state-boundary-architecture.test.ts for the static
// proof of this. Mocking only this path (and not published-listing-actions)
// means these tests would fail loudly if page.tsx ever regressed back to
// importing getPublishedListingEditState from the browser module.
vi.mock("@/lib/seller/get-published-listing-edit-state", () => ({
  getPublishedListingEditState: getPublishedListingEditStateMock,
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

function samplePublishedListing(overrides: Partial<PublishedListingEditState> = {}): PublishedListingEditState {
  return {
    listingId: "listing-1",
    publicCode: "PSL-ABC123",
    slug: "nike-air-max-270",
    status: "available",
    title: "Nike Air Max 270",
    description: "Worn twice.",
    categoryId: 1,
    listingType: "preloved",
    condition: "good",
    priceCents: 150000,
    originalPriceCents: null,
    isNegotiable: false,
    brand: "Nike",
    knownFlaws: null,
    stockQuantity: 5,
    provinceId: 1,
    cityId: 10,
    barangayId: 100,
    meetupNote: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-05T00:00:00.000Z",
    publishedAt: "2026-01-02T00:00:00.000Z",
    fulfillmentMethods: ["meetup"],
    images: [],
    vehicleDetails: null,
    rentalDetails: null,
    revision: "1",
    availableQuantity: 5,
    reservedQuantity: 0,
    coverImageId: null,
    quantityEditable: true,
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

  describe("Draft", () => {
    it("loads the form for a Draft listing, prefilled from get_my_listing", async () => {
      getAuthUserMock.mockResolvedValue({ id: "u1", email: "seller@example.com" });
      getMyListingMock.mockResolvedValue({ status: "found", listing: sampleListing() });

      render(await SellListingEditPage({ params: params("listing-1") }));

      expect(screen.getByRole("heading", { level: 1, name: "Edit Draft" })).toBeInTheDocument();
      expect(screen.getByLabelText("Title")).toHaveValue("Nike Air Max 270");
      expect(screen.getByRole("button", { name: "Save Draft" })).toBeInTheDocument();
    });

    it("never calls the published-edit loader for a Draft listing", async () => {
      getAuthUserMock.mockResolvedValue({ id: "u1", email: "seller@example.com" });
      getMyListingMock.mockResolvedValue({ status: "found", listing: sampleListing() });

      render(await SellListingEditPage({ params: params("listing-1") }));

      expect(getPublishedListingEditStateMock).not.toHaveBeenCalled();
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

  describe("Available/Paused (real published editor)", () => {
    it.each(["available", "paused"] as const)("routes %s through getPublishedListingEditState, not the draft loader path", async (status) => {
      getAuthUserMock.mockResolvedValue({ id: "u1", email: "seller@example.com" });
      getMyListingMock.mockResolvedValue({ status: "found", listing: sampleListing({ status }) });
      getPublishedListingEditStateMock.mockResolvedValue({ status: "found", listing: samplePublishedListing({ status }) });

      render(await SellListingEditPage({ params: params("listing-1") }));

      expect(getPublishedListingEditStateMock).toHaveBeenCalledWith("listing-1");
    });

    it.each(["available", "paused"] as const)("renders the real published editor for %s, not the Draft form", async (status) => {
      getAuthUserMock.mockResolvedValue({ id: "u1", email: "seller@example.com" });
      getMyListingMock.mockResolvedValue({ status: "found", listing: sampleListing({ status }) });
      getPublishedListingEditStateMock.mockResolvedValue({ status: "found", listing: samplePublishedListing({ status }) });

      render(await SellListingEditPage({ params: params("listing-1") }));

      expect(screen.getByRole("heading", { level: 1, name: "Edit Listing" })).toBeInTheDocument();
      expect(screen.getByLabelText("Title")).toHaveValue("Nike Air Max 270");
      expect(screen.getByRole("button", { name: "Save changes" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Save Draft" })).not.toBeInTheDocument();
    });

    it.each(["available", "paused"] as const)("never shows a Publish button for %s", async (status) => {
      getAuthUserMock.mockResolvedValue({ id: "u1", email: "seller@example.com" });
      getMyListingMock.mockResolvedValue({ status: "found", listing: sampleListing({ status }) });
      getPublishedListingEditStateMock.mockResolvedValue({ status: "found", listing: samplePublishedListing({ status }) });

      render(await SellListingEditPage({ params: params("listing-1") }));

      expect(screen.queryByRole("button", { name: "Publish Listing" })).not.toBeInTheDocument();
    });

    it("renders category/type/condition as a read-only summary, never an editable control", async () => {
      getAuthUserMock.mockResolvedValue({ id: "u1", email: "seller@example.com" });
      getMyListingMock.mockResolvedValue({ status: "found", listing: sampleListing({ status: "available" }) });
      getPublishedListingEditStateMock.mockResolvedValue({ status: "found", listing: samplePublishedListing() });

      render(await SellListingEditPage({ params: params("listing-1") }));

      expect(screen.getByText("Women")).toBeInTheDocument();
      expect(screen.getByText("Pre-loved")).toBeInTheDocument();
      expect(screen.getByText("Good")).toBeInTheDocument();
      expect(screen.queryByLabelText(/^category/i)).not.toBeInTheDocument();
      expect(screen.queryByLabelText(/listing type/i)).not.toBeInTheDocument();
      expect(screen.queryByLabelText(/^condition/i)).not.toBeInTheDocument();
    });

    it("fetches Draft-style reference data (categories/provinces/location) for the real editor", async () => {
      getAuthUserMock.mockResolvedValue({ id: "u1", email: "seller@example.com" });
      getMyListingMock.mockResolvedValue({ status: "found", listing: sampleListing({ status: "available", provinceId: 1, cityId: 10 }) });
      getPublishedListingEditStateMock.mockResolvedValue({ status: "found", listing: samplePublishedListing() });

      render(await SellListingEditPage({ params: params("listing-1") }));

      expect(getCategoriesMock).toHaveBeenCalled();
      expect(getProvincesMock).toHaveBeenCalled();
      expect(getCitiesForProvinceMock).toHaveBeenCalledWith(1);
    });

    it("renders the editor from the published loader's own title/status, not the earlier get_my_listing read", async () => {
      getAuthUserMock.mockResolvedValue({ id: "u1", email: "seller@example.com" });
      getMyListingMock.mockResolvedValue({ status: "found", listing: sampleListing({ status: "available", title: "Stale Title" }) });
      getPublishedListingEditStateMock.mockResolvedValue({
        status: "found",
        listing: samplePublishedListing({ title: "Fresh Published Title" }),
      });

      render(await SellListingEditPage({ params: params("listing-1") }));

      expect(screen.getByLabelText("Title")).toHaveValue("Fresh Published Title");
      expect(screen.queryByDisplayValue("Stale Title")).not.toBeInTheDocument();
    });

    it("does not render the raw revision value anywhere in the editor UI", async () => {
      getAuthUserMock.mockResolvedValue({ id: "u1", email: "seller@example.com" });
      getMyListingMock.mockResolvedValue({ status: "found", listing: sampleListing({ status: "available" }) });
      getPublishedListingEditStateMock.mockResolvedValue({
        status: "found",
        listing: samplePublishedListing({ revision: "9007199254740993" }),
      });

      const { container } = render(await SellListingEditPage({ params: params("listing-1") }));

      // Proves the wrapper's response (including a bigint-range revision)
      // reached the render without crashing or needing to be displayed --
      // revision is tracked internally and only ever round-tripped back to
      // updatePublishedListing, never shown in the UI.
      expect(getPublishedListingEditStateMock).toHaveBeenCalledWith("listing-1");
      expect(container.textContent).not.toContain("9007199254740993");
    });
  });

  describe("Reserved/Sold/Archived (read-only)", () => {
    it.each(["reserved", "sold", "archived"] as const)("renders a read-only not-editable state for %s", async (status) => {
      getAuthUserMock.mockResolvedValue({ id: "u1", email: "seller@example.com" });
      getMyListingMock.mockResolvedValue({ status: "found", listing: sampleListing({ status }) });

      render(await SellListingEditPage({ params: params("listing-1") }));

      expect(screen.getByRole("heading", { level: 1, name: /isn.t editable right now/i })).toBeInTheDocument();
      expect(screen.getByText("Nike Air Max 270")).toBeInTheDocument();
    });

    it.each(["reserved", "sold", "archived"] as const)("never calls the published-edit loader for %s", async (status) => {
      getAuthUserMock.mockResolvedValue({ id: "u1", email: "seller@example.com" });
      getMyListingMock.mockResolvedValue({ status: "found", listing: sampleListing({ status }) });

      render(await SellListingEditPage({ params: params("listing-1") }));

      expect(getPublishedListingEditStateMock).not.toHaveBeenCalled();
    });

    it.each(["reserved", "sold", "archived"] as const)("shows no form and no Publish button for %s", async (status) => {
      getAuthUserMock.mockResolvedValue({ id: "u1", email: "seller@example.com" });
      getMyListingMock.mockResolvedValue({ status: "found", listing: sampleListing({ status }) });

      render(await SellListingEditPage({ params: params("listing-1") }));

      expect(screen.queryByLabelText("Title")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Publish Listing" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Save Draft" })).not.toBeInTheDocument();
    });

    it.each(["reserved", "sold", "archived"] as const)(
      "offers navigation back to the seller's listings and to the public listing for %s (publicly viewable per get_listing_detail/canViewPublicly)",
      async (status) => {
        getAuthUserMock.mockResolvedValue({ id: "u1", email: "seller@example.com" });
        getMyListingMock.mockResolvedValue({ status: "found", listing: sampleListing({ status }) });

        render(await SellListingEditPage({ params: params("listing-1") }));

        expect(screen.getByRole("link", { name: "Back to my listings" })).toHaveAttribute("href", "/sell");
        expect(screen.getByRole("link", { name: "View listing" })).toHaveAttribute("href", "/item/PSL-ABC123");
      },
    );

    it("shows a specific reservation explanation for Reserved, distinct from Sold/Archived's generic copy", async () => {
      getAuthUserMock.mockResolvedValue({ id: "u1", email: "seller@example.com" });
      getMyListingMock.mockResolvedValue({ status: "found", listing: sampleListing({ status: "reserved" }) });

      render(await SellListingEditPage({ params: params("listing-1") }));

      expect(screen.getByText(/reserved by an active order/i)).toBeInTheDocument();
    });

    it("never fetches Draft reference data for a read-only status", async () => {
      getAuthUserMock.mockResolvedValue({ id: "u1", email: "seller@example.com" });
      getMyListingMock.mockResolvedValue({ status: "found", listing: sampleListing({ status: "archived" }) });

      render(await SellListingEditPage({ params: params("listing-1") }));

      expect(getCategoriesMock).not.toHaveBeenCalled();
    });
  });

  describe("published-edit loader privacy/error outcomes", () => {
    it("falls back to the read-only state (not a crash or a generic error) when the published loader reports LISTING_NOT_EDITABLE, and still offers View listing for the (publicly viewable) available status", async () => {
      // Race: status moved out of Available/Paused between the two reads.
      getAuthUserMock.mockResolvedValue({ id: "u1", email: "seller@example.com" });
      getMyListingMock.mockResolvedValue({ status: "found", listing: sampleListing({ status: "available" }) });
      getPublishedListingEditStateMock.mockResolvedValue({ status: "not_editable" });

      render(await SellListingEditPage({ params: params("listing-1") }));

      expect(screen.getByRole("heading", { level: 1, name: /isn.t editable right now/i })).toBeInTheDocument();
      expect(screen.getByText("Nike Air Max 270")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "View listing" })).toHaveAttribute("href", "/item/PSL-ABC123");
    });

    it("falls back to the read-only state for the same LISTING_NOT_EDITABLE race on a Paused listing, but does not offer View listing (Paused is not publicly viewable per get_listing_detail/canViewPublicly)", async () => {
      getAuthUserMock.mockResolvedValue({ id: "u1", email: "seller@example.com" });
      getMyListingMock.mockResolvedValue({ status: "found", listing: sampleListing({ status: "paused" }) });
      getPublishedListingEditStateMock.mockResolvedValue({ status: "not_editable" });

      render(await SellListingEditPage({ params: params("listing-1") }));

      expect(screen.getByRole("heading", { level: 1, name: /isn.t editable right now/i })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Back to my listings" })).toHaveAttribute("href", "/sell");
      expect(screen.queryByRole("link", { name: "View listing" })).not.toBeInTheDocument();
    });

    it("shows the generic unable-to-load message for not_found from the published loader, without a 404 and without leaking ownership info", async () => {
      getAuthUserMock.mockResolvedValue({ id: "u1", email: "seller@example.com" });
      getMyListingMock.mockResolvedValue({ status: "found", listing: sampleListing({ status: "available" }) });
      getPublishedListingEditStateMock.mockResolvedValue({ status: "not_found" });

      render(await SellListingEditPage({ params: params("listing-1") }));

      expect(screen.getByText(/unable to load this listing/i)).toBeInTheDocument();
      expect(notFoundMock).not.toHaveBeenCalled();
    });

    it("shows the generic unable-to-load message for not_authenticated from the published loader", async () => {
      getAuthUserMock.mockResolvedValue({ id: "u1", email: "seller@example.com" });
      getMyListingMock.mockResolvedValue({ status: "found", listing: sampleListing({ status: "paused" }) });
      getPublishedListingEditStateMock.mockResolvedValue({ status: "not_authenticated" });

      render(await SellListingEditPage({ params: params("listing-1") }));

      expect(screen.getByText(/unable to load this listing/i)).toBeInTheDocument();
    });

    it("shows the generic unable-to-load message for interaction_blocked from the published loader", async () => {
      getAuthUserMock.mockResolvedValue({ id: "u1", email: "seller@example.com" });
      getMyListingMock.mockResolvedValue({ status: "found", listing: sampleListing({ status: "available" }) });
      getPublishedListingEditStateMock.mockResolvedValue({ status: "interaction_blocked" });

      render(await SellListingEditPage({ params: params("listing-1") }));

      expect(screen.getByText(/unable to load this listing/i)).toBeInTheDocument();
    });

    it("shows the generic unable-to-load message, without crashing, for an unexpected published-loader failure", async () => {
      getAuthUserMock.mockResolvedValue({ id: "u1", email: "seller@example.com" });
      getMyListingMock.mockResolvedValue({ status: "found", listing: sampleListing({ status: "available" }) });
      getPublishedListingEditStateMock.mockResolvedValue({ status: "error" });

      render(await SellListingEditPage({ params: params("listing-1") }));

      expect(screen.getByText(/unable to load this listing/i)).toBeInTheDocument();
    });
  });
});
