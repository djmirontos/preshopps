import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { ListingDetail, ListingDetailResult } from "@/lib/marketplace/listing-detail";

const { getListingDetailMock, notFoundMock } = vi.hoisted(() => ({
  getListingDetailMock: vi.fn<(publicCode: string) => Promise<ListingDetailResult>>(),
  notFoundMock: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("@/lib/marketplace/listing-detail", () => ({
  getListingDetail: getListingDetailMock,
}));

vi.mock("next/navigation", () => ({
  notFound: notFoundMock,
}));

import ItemPage, { generateMetadata } from "@/app/item/[publicCode]/page";

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

describe("ItemPage route parameter", () => {
  it("lives at app/item/[publicCode]/page.tsx, not app/item/[slug]", () => {
    expect(existsSync(path.join(process.cwd(), "app/item/[publicCode]/page.tsx"))).toBe(true);
    expect(existsSync(path.join(process.cwd(), "app/item/[slug]/page.tsx"))).toBe(false);
  });

  it("destructures params.publicCode -- never params.slug -- to resolve the listing", () => {
    const source = readFileSync(path.join(process.cwd(), "app/item/[publicCode]/page.tsx"), "utf-8");
    expect(source).toContain("{ publicCode }");
    expect(source).not.toMatch(/params\.slug|\{\s*slug\s*\}\s*=\s*await params/);
  });
});

describe("ItemPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the listing when found", async () => {
    getListingDetailMock.mockResolvedValue({ status: "found", listing: sampleListing });
    render(await ItemPage(makeParams("PLS-ABC123")));

    expect(screen.getByRole("heading", { level: 1, name: "Nike Air Max 270" })).toBeInTheDocument();
    expect(getListingDetailMock).toHaveBeenCalledWith("PLS-ABC123");
  });

  it("calls notFound() for a nonexistent/hidden listing, indistinguishable from any other hidden case", async () => {
    getListingDetailMock.mockResolvedValue({ status: "not_found" });

    await expect(ItemPage(makeParams("missing"))).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFoundMock).toHaveBeenCalled();
  });

  it("renders a safe error state (not a false 404) when the RPC genuinely fails", async () => {
    getListingDetailMock.mockResolvedValue({ status: "error" });
    render(await ItemPage(makeParams("PLS-ABC123")));

    expect(screen.getByText("Unable to load this listing right now.")).toBeInTheDocument();
    expect(notFoundMock).not.toHaveBeenCalled();
  });

  it("never renders internal error/SQL details on RPC failure", async () => {
    getListingDetailMock.mockResolvedValue({ status: "error" });
    render(await ItemPage(makeParams("PLS-ABC123")));

    expect(screen.queryByText(/postgrest|sql|relation|syntax error/i)).not.toBeInTheDocument();
  });

  it("produces a dynamic <title>-worthy metadata object from the same listing data", async () => {
    getListingDetailMock.mockResolvedValue({ status: "found", listing: sampleListing });
    const metadata = await generateMetadata(makeParams("PLS-ABC123"));
    expect(metadata.title).toBe("Nike Air Max 270 | Preshopps");
    expect(metadata.description).toBe("Worn a few times, still great.");
  });

  it("falls back to generic metadata without leaking anything when not found", async () => {
    getListingDetailMock.mockResolvedValue({ status: "not_found" });
    const metadata = await generateMetadata(makeParams("missing"));
    expect(metadata.title).toBe("Listing | Preshopps");
  });

  it("never renders private seller/order fields such as a raw owner id", async () => {
    getListingDetailMock.mockResolvedValue({ status: "found", listing: sampleListing });
    const { container } = render(await ItemPage(makeParams("PLS-ABC123")));
    expect(container.innerHTML).not.toMatch(/owner_id|reserved_quantity|stock_quantity/i);
  });

  it("does not render a Vehicle/Rental Details block for an ordinary listing", async () => {
    getListingDetailMock.mockResolvedValue({ status: "found", listing: sampleListing });
    render(await ItemPage(makeParams("PLS-ABC123")));
    expect(screen.queryByText("Vehicle Details")).not.toBeInTheDocument();
    expect(screen.queryByText("Rental Details")).not.toBeInTheDocument();
  });

  it("renders the Vehicle Details block for a Cars/Motorcycles listing with vehicle fields", async () => {
    getListingDetailMock.mockResolvedValue({
      status: "found",
      listing: {
        ...sampleListing,
        isInquiryOnly: true,
        vehicleDetails: {
          brand: "Toyota",
          model: "Vios",
          year: 2019,
          mileageKm: 45000,
          transmission: "Manual",
          fuelType: "Gasoline",
          registrationStatus: "registered",
          documentsAvailable: ["OR/CR"],
        },
      },
    });
    render(await ItemPage(makeParams("PLS-CAR")));
    expect(screen.getByText("Vehicle Details")).toBeInTheDocument();
    expect(screen.getByText("Toyota")).toBeInTheDocument();
  });
});
