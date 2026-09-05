import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ListingCardData } from "@/components/marketplace/ListingCard";
import { ShopListingsClient } from "@/components/shop/ShopListingsClient";

const listingA: ListingCardData = {
  id: "a",
  href: "/item/a",
  title: "Item A",
  priceCents: 10000,
  listingType: "preloved",
  condition: "good",
  locationLabel: "Tangub City",
  shopName: "Shop A",
};

const listingB: ListingCardData = {
  id: "b",
  href: "/item/b",
  title: "Item B",
  priceCents: 20000,
  listingType: "preloved",
  condition: "good",
  locationLabel: "Tangub City",
  shopName: "Shop A",
};

describe("ShopListingsClient", () => {
  it("renders the server-provided initial results without calling loadMore", () => {
    const loadMore = vi.fn();
    render(
      <ShopListingsClient initialListings={[listingA]} initialHadError={false} initialCursor={null} loadMore={loadMore} />,
    );
    expect(screen.getByText("Item A")).toBeInTheDocument();
    expect(loadMore).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /load more/i })).not.toBeInTheDocument();
  });

  it("shows a plain empty message (never a 404) for a valid shop with zero listings", () => {
    render(<ShopListingsClient initialListings={[]} initialHadError={false} initialCursor={null} loadMore={vi.fn()} />);
    expect(screen.getByText("No listings available right now.")).toBeInTheDocument();
  });

  it("shows an error fallback when the initial fetch failed", () => {
    render(<ShopListingsClient initialListings={[]} initialHadError initialCursor={null} loadMore={vi.fn()} />);
    expect(screen.getByText("Unable to load listings right now.")).toBeInTheDocument();
  });

  it("Load More appends new results using the cursor, without duplicating existing ones", async () => {
    const loadMore = vi.fn().mockResolvedValue({ listings: [listingB], hadError: false, nextCursor: null });
    render(
      <ShopListingsClient
        initialListings={[listingA]}
        initialHadError={false}
        initialCursor={{ createdAt: "2026-01-01T00:00:00Z", id: "a" }}
        loadMore={loadMore}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /load more/i }));

    await waitFor(() => expect(screen.getByText("Item B")).toBeInTheDocument());
    expect(screen.getByText("Item A")).toBeInTheDocument();
    expect(loadMore).toHaveBeenCalledWith({ createdAt: "2026-01-01T00:00:00Z", id: "a" });
  });

  it("hides Load More once the cursor comes back null (last page)", async () => {
    const loadMore = vi.fn().mockResolvedValue({ listings: [listingB], hadError: false, nextCursor: null });
    render(
      <ShopListingsClient initialListings={[listingA]} initialHadError={false} initialCursor={{ id: "a" }} loadMore={loadMore} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /load more/i }));
    await waitFor(() => expect(screen.queryByRole("button", { name: /load more/i })).not.toBeInTheDocument());
  });

  it("shows a load-more error without discarding already-loaded results", async () => {
    const loadMore = vi.fn().mockResolvedValue({ listings: [], hadError: true, nextCursor: null });
    render(
      <ShopListingsClient initialListings={[listingA]} initialHadError={false} initialCursor={{ id: "a" }} loadMore={loadMore} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /load more/i }));
    await waitFor(() => expect(screen.getByText(/unable to load more listings right now/i)).toBeInTheDocument());
    expect(screen.getByText("Item A")).toBeInTheDocument();
  });
});
