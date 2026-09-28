import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { ListingDetail, ListingDetailResult } from "@/lib/marketplace/listing-detail";
import { formatPriceFromCents } from "@/components/marketplace/ListingCard";

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
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/lib/env", () => ({
  getAppUrl: () => "https://preshopps.com",
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

  it("falls back to generic metadata without leaking anything when not found -- no canonical or Open Graph field of any kind", async () => {
    getListingDetailMock.mockResolvedValue({ status: "not_found" });
    const metadata = await generateMetadata(makeParams("missing"));
    expect(metadata.title).toBe("Listing | Preshopps");
    expect(metadata.description).toBeUndefined();
    expect(metadata.alternates).toBeUndefined();
    expect(metadata.openGraph).toBeUndefined();
  });

  describe("generateMetadata -- canonical and Open Graph (PRD §37 / ARCHITECTURE §27)", () => {
    it("emits an absolute canonical URL from the listing's own resolved public code", async () => {
      getListingDetailMock.mockResolvedValue({ status: "found", listing: sampleListing });
      const metadata = await generateMetadata(makeParams("PLS-ABC123"));
      expect(metadata.alternates).toEqual({ canonical: "https://preshopps.com/item/PLS-ABC123" });
    });

    it("Open Graph title/url/type match the canonical values, description reuses the same base as the meta description", async () => {
      getListingDetailMock.mockResolvedValue({ status: "found", listing: sampleListing });
      const metadata = await generateMetadata(makeParams("PLS-ABC123"));
      expect(metadata.openGraph?.title).toBe("Nike Air Max 270 | Preshopps");
      expect(metadata.openGraph?.url).toBe("https://preshopps.com/item/PLS-ABC123");
      // Next's Metadata["openGraph"] union type requires narrowing before
      // a plain property read on `type` compiles -- toMatchObject checks
      // it at runtime without that compile-time narrowing.
      expect(metadata.openGraph).toMatchObject({ type: "website" });
    });

    it("Open Graph description includes price, type/condition, and location ahead of the listing's own description, with no unavailability prefix while available", async () => {
      getListingDetailMock.mockResolvedValue({ status: "found", listing: sampleListing });
      const metadata = await generateMetadata(makeParams("PLS-ABC123"));
      const price = formatPriceFromCents(sampleListing.priceCents);
      expect(metadata.openGraph?.description).toBe(
        `${price} · Pre-loved · Good · Tangub City, Misamis Occidental — Worn a few times, still great.`,
      );
    });

    it("omits the Open Graph image entirely (never a placeholder URL) when the listing has no images", async () => {
      getListingDetailMock.mockResolvedValue({ status: "found", listing: { ...sampleListing, imageUrls: [] } });
      const metadata = await generateMetadata(makeParams("PLS-ABC123"));
      expect(metadata.openGraph?.images).toBeUndefined();
    });

    it("includes the listing's first photo as the Open Graph image when present", async () => {
      getListingDetailMock.mockResolvedValue({
        status: "found",
        listing: { ...sampleListing, imageUrls: ["https://supabase.example/storage/v1/object/public/listings/photo1.jpg", "https://supabase.example/storage/v1/object/public/listings/photo2.jpg"] },
      });
      const metadata = await generateMetadata(makeParams("PLS-ABC123"));
      expect(metadata.openGraph?.images).toEqual([{ url: "https://supabase.example/storage/v1/object/public/listings/photo1.jpg" }]);
    });

    it.each(["sold", "reserved", "archived"] as const)(
      "prefixes the Open Graph description with the real status for a %s listing -- never describing it as currently available",
      async (status) => {
        getListingDetailMock.mockResolvedValue({ status: "found", listing: { ...sampleListing, status } });
        const metadata = await generateMetadata(makeParams("PLS-ABC123"));
        const expectedLabel = status === "sold" ? "Sold" : status === "reserved" ? "Reserved" : "Archived";
        expect(metadata.openGraph?.description).toMatch(new RegExp(`^${expectedLabel} · `));
      },
    );

    it("does not prefix the Open Graph description with any status label while the listing is available", async () => {
      getListingDetailMock.mockResolvedValue({ status: "found", listing: sampleListing });
      const metadata = await generateMetadata(makeParams("PLS-ABC123"));
      expect(metadata.openGraph?.description).not.toMatch(/^(Sold|Reserved|Archived) ·/);
    });
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

  it("renders a compact seller/trust preview linking to the shop, above Fulfillment/Actions", async () => {
    getListingDetailMock.mockResolvedValue({ status: "found", listing: sampleListing });
    render(await ItemPage(makeParams("PLS-ABC123")));

    const previewLinks = screen.getAllByRole("link", { name: /sole traders/i });
    expect(previewLinks[0]).toHaveAttribute("href", "/shop/sole-traders");
  });

  it("shows Trusted Seller in the compact preview when the shop is trusted, hides it otherwise", async () => {
    getListingDetailMock.mockResolvedValue({ status: "found", listing: sampleListing });
    const { rerender } = render(await ItemPage(makeParams("PLS-ABC123")));
    expect(screen.getAllByText("Trusted Seller").length).toBeGreaterThan(0);

    getListingDetailMock.mockResolvedValue({
      status: "found",
      listing: { ...sampleListing, shop: { ...sampleListing.shop, isTrustedSeller: false } },
    });
    rerender(await ItemPage(makeParams("PLS-ABC123")));
    expect(screen.queryByText("Trusted Seller")).not.toBeInTheDocument();
  });

  it("shows rating/review count in the compact preview only when reviews exist", async () => {
    getListingDetailMock.mockResolvedValue({ status: "found", listing: sampleListing });
    render(await ItemPage(makeParams("PLS-ABC123")));
    expect(screen.getAllByText(/4\.7.*3 reviews/).length).toBeGreaterThan(0);
  });

  it("omits the rating line in the compact preview when there are no reviews yet", async () => {
    getListingDetailMock.mockResolvedValue({
      status: "found",
      listing: { ...sampleListing, reviewCount: 0, averageRating: null },
    });
    render(await ItemPage(makeParams("PLS-ABC123")));
    // The compact preview's rating line ("4.7 · 3 reviews") is gone; the
    // full seller card's own "No reviews yet" fallback further down is
    // untouched and expected to still render.
    expect(screen.queryByText(/^\d\.\d\s·\s\d+\s?reviews?$/)).not.toBeInTheDocument();
    expect(screen.getByText("No reviews yet")).toBeInTheDocument();
  });

  it("still renders the full seller card (Messenger, member since) further down the page", async () => {
    getListingDetailMock.mockResolvedValue({
      status: "found",
      listing: { ...sampleListing, shop: { ...sampleListing.shop, messengerLink: "https://m.me/soletraders" } },
    });
    render(await ItemPage(makeParams("PLS-ABC123")));

    expect(screen.getByRole("heading", { name: "Seller" })).toBeInTheDocument();
    expect(screen.getByText(/member since/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /contact on messenger/i })).toHaveAttribute(
      "href",
      "https://m.me/soletraders",
    );
  });

  it("opening and closing the photo lightbox does not affect the surrounding Add to Cart action (guest)", async () => {
    getListingDetailMock.mockResolvedValue({
      status: "found",
      listing: { ...sampleListing, imageUrls: ["https://example.supabase.co/a.webp"] },
    });
    render(await ItemPage(makeParams("PLS-ABC123")));

    fireEvent.click(screen.getByRole("button", { name: /view full-size photo/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close photo viewer" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add to Cart" })).not.toBeDisabled();
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
