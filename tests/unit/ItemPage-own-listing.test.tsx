import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ListingDetail, ListingDetailResult } from "@/lib/marketplace/listing-detail";
import type { AuthUser } from "@/lib/auth/session";
import type { MyShop } from "@/lib/seller/get-my-shop";

/**
 * Dedicated file (rather than adding cases to ItemPage.test.tsx) because
 * this scenario needs its own vi.mock overrides for getAuthUser/getMyShop
 * -- vi.mock is hoisted per-file, and every other ItemPage test relies on
 * tests/setup/vitest.setup.ts's file-wide "guest, no shop" defaults.
 */
const { getListingDetailMock, getAuthUserMock, getMyShopMock } = vi.hoisted(() => ({
  getListingDetailMock: vi.fn<(publicCode: string) => Promise<ListingDetailResult>>(),
  getAuthUserMock: vi.fn<() => Promise<AuthUser | null>>(),
  getMyShopMock: vi.fn<() => Promise<MyShop | null>>(),
}));

vi.mock("@/lib/marketplace/listing-detail", () => ({
  getListingDetail: getListingDetailMock,
}));

vi.mock("@/lib/auth/session", () => ({
  getAuthUser: getAuthUserMock,
}));

vi.mock("@/lib/seller/get-my-shop", () => ({
  getMyShop: getMyShopMock,
}));

vi.mock("next/navigation", () => ({
  notFound: vi.fn(),
  useRouter: () => ({ push: vi.fn() }),
}));

import ItemPage from "@/app/item/[publicCode]/page";

const OWNER: AuthUser = { id: "owner-1", email: "seller@example.com" };
const OTHER_BUYER: AuthUser = { id: "buyer-1", email: "buyer@example.com" };
const MY_SHOP: MyShop = { id: "s1", slug: "sole-traders", name: "Sole Traders" };

const sampleListing: ListingDetail = {
  id: "l1",
  publicCode: "PLS-ABC123",
  title: "Nike Air Max 270",
  description: "Worn a few times, still great.",
  knownFlaws: null,
  listingType: "preloved",
  condition: "good",
  priceCents: 320000,
  originalPriceCents: undefined,
  isNegotiable: true,
  status: "available",
  availableQuantity: 1,
  meetupNote: null,
  postedLabel: "2 days ago",
  categoryName: "Shoes",
  isInquiryOnly: false,
  locationLabel: "Tangub City, Misamis Occidental",
  imageUrls: [],
  fulfillmentMethods: ["meetup"],
  shop: {
    id: "s1",
    slug: "sole-traders",
    name: "Sole Traders",
    logoUrl: undefined,
    messengerLink: null,
    isTrustedSeller: true,
    memberSinceLabel: "January 2025",
    locationLabel: "Tangub City, Misamis Occidental",
  },
  reviewCount: 3,
  averageRating: 4.7,
  vehicleDetails: null,
  rentalDetails: null,
};

function makeParams(publicCode: string) {
  return { params: Promise.resolve({ publicCode }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  getListingDetailMock.mockResolvedValue({ status: "found", listing: sampleListing });
});

describe("ItemPage -- own-listing detection (isOwnListing)", () => {
  it("shows a disabled 'Your listing' button, not an active Add to Cart, when the viewer owns the listing's shop", async () => {
    getAuthUserMock.mockResolvedValue(OWNER);
    getMyShopMock.mockResolvedValue(MY_SHOP);

    render(await ItemPage(makeParams("PLS-ABC123")));

    expect(screen.queryByRole("button", { name: "Add to Cart" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Your listing" })).toBeDisabled();
  });

  it("shows no generic cart-failure error just from an owner viewing their own listing", async () => {
    getAuthUserMock.mockResolvedValue(OWNER);
    getMyShopMock.mockResolvedValue(MY_SHOP);

    render(await ItemPage(makeParams("PLS-ABC123")));

    expect(screen.queryByText(/couldn't add/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows a real, active Add to Cart for a different authenticated buyer (their own shop id differs)", async () => {
    getAuthUserMock.mockResolvedValue(OTHER_BUYER);
    getMyShopMock.mockResolvedValue(null);

    render(await ItemPage(makeParams("PLS-ABC123")));

    expect(screen.queryByRole("button", { name: "Your listing" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add to Cart" })).not.toBeDisabled();
  });

  it("shows a real, active Add to Cart for a signed-in seller who owns a DIFFERENT shop", async () => {
    getAuthUserMock.mockResolvedValue(OTHER_BUYER);
    getMyShopMock.mockResolvedValue({ id: "some-other-shop", slug: "other", name: "Other Shop" });

    render(await ItemPage(makeParams("PLS-ABC123")));

    expect(screen.queryByRole("button", { name: "Your listing" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add to Cart" })).not.toBeDisabled();
  });

  it("leaves guest behavior unchanged -- getMyShop is never even consulted, Add to Cart stays active", async () => {
    getAuthUserMock.mockResolvedValue(null);

    render(await ItemPage(makeParams("PLS-ABC123")));

    expect(getMyShopMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Your listing" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add to Cart" })).not.toBeDisabled();
  });
});
