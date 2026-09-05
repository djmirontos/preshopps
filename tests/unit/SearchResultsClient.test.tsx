import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ListingCardData } from "@/components/marketplace/ListingCard";
import { SearchResultsClient } from "@/components/search/SearchResultsClient";

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
  shopName: "Shop B",
};

describe("SearchResultsClient", () => {
  it("renders the server-provided initial results without calling loadMore", () => {
    const loadMore = vi.fn();
    render(
      <SearchResultsClient
        initialListings={[listingA]}
        initialHadError={false}
        initialCursor={null}
        loadMore={loadMore}
        query={null}
        clearFiltersHref="/search"
      />,
    );

    expect(screen.getByText("Item A")).toBeInTheDocument();
    expect(loadMore).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /load more/i })).not.toBeInTheDocument();
  });

  it("shows the search empty state (not the homepage empty state) when there are zero results", () => {
    render(
      <SearchResultsClient
        initialListings={[]}
        initialHadError={false}
        initialCursor={null}
        loadMore={vi.fn()}
        query="galaxy fold"
        clearFiltersHref="/search?q=galaxy+fold"
      />,
    );

    expect(screen.getByText("No listings match your filters.")).toBeInTheDocument();
    expect(screen.getByText(/galaxy fold/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /clear filters/i })).toHaveAttribute(
      "href",
      "/search?q=galaxy+fold",
    );
  });

  it("shows the RPC error fallback when the initial fetch failed", () => {
    render(
      <SearchResultsClient
        initialListings={[]}
        initialHadError
        initialCursor={null}
        loadMore={vi.fn()}
        query={null}
        clearFiltersHref="/search"
      />,
    );
    expect(screen.getByText("Unable to load listings right now.")).toBeInTheDocument();
  });

  it("Load More appends new results using the cursor, without duplicating existing ones, and preserves filters via the closed-over loadMore action", async () => {
    const loadMore = vi.fn().mockResolvedValue({
      listings: [listingB],
      hadError: false,
      nextCursor: null,
    });

    render(
      <SearchResultsClient
        initialListings={[listingA]}
        initialHadError={false}
        initialCursor={{ createdAt: "2026-01-01T00:00:00Z", id: "a" }}
        loadMore={loadMore}
        query={null}
        clearFiltersHref="/search"
      />,
    );

    const button = screen.getByRole("button", { name: /load more/i });
    fireEvent.click(button);

    await waitFor(() => expect(screen.getByText("Item B")).toBeInTheDocument());
    expect(screen.getByText("Item A")).toBeInTheDocument();
    expect(loadMore).toHaveBeenCalledTimes(1);
    expect(loadMore).toHaveBeenCalledWith({ createdAt: "2026-01-01T00:00:00Z", id: "a" });
  });

  it("hides the Load More button once the cursor comes back null (fewer than limit rows)", async () => {
    const loadMore = vi.fn().mockResolvedValue({ listings: [listingB], hadError: false, nextCursor: null });

    render(
      <SearchResultsClient
        initialListings={[listingA]}
        initialHadError={false}
        initialCursor={{ id: "a" }}
        loadMore={loadMore}
        query={null}
        clearFiltersHref="/search"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /load more/i }));

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /load more/i })).not.toBeInTheDocument(),
    );
  });

  it("shows a load-more error message without discarding already-loaded results", async () => {
    const loadMore = vi.fn().mockResolvedValue({ listings: [], hadError: true, nextCursor: null });

    render(
      <SearchResultsClient
        initialListings={[listingA]}
        initialHadError={false}
        initialCursor={{ id: "a" }}
        loadMore={loadMore}
        query={null}
        clearFiltersHref="/search"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /load more/i }));

    await waitFor(() =>
      expect(screen.getByText(/unable to load more listings right now/i)).toBeInTheDocument(),
    );
    expect(screen.getByText("Item A")).toBeInTheDocument();
  });
});
