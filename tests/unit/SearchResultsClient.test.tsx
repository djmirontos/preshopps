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
        hasActiveFilters={false}
        clearFiltersHref="/search"
      />,
    );

    expect(screen.getByText("Item A")).toBeInTheDocument();
    expect(loadMore).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /load more/i })).not.toBeInTheDocument();
  });

  it("shows the query-specific empty state (not the generic filters message) for a text-only query", () => {
    render(
      <SearchResultsClient
        initialListings={[]}
        initialHadError={false}
        initialCursor={null}
        loadMore={vi.fn()}
        query="galaxy fold"
        hasActiveFilters={false}
        clearFiltersHref="/search?q=galaxy+fold"
      />,
    );

    expect(screen.getByText("No results for “galaxy fold”.")).toBeInTheDocument();
    expect(screen.queryByText("No listings match your filters.")).not.toBeInTheDocument();
    // Nothing to clear when the query is the only thing set -- "Clear
    // filters" would be a no-op, so it's hidden.
    expect(screen.queryByRole("link", { name: /clear filters/i })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /browse all listings/i })).toBeInTheDocument();
  });

  it("shows the generic filters-empty state (with the query named as a secondary line) when a real filter is also active", () => {
    render(
      <SearchResultsClient
        initialListings={[]}
        initialHadError={false}
        initialCursor={null}
        loadMore={vi.fn()}
        query="galaxy fold"
        hasActiveFilters
        clearFiltersHref="/search?q=galaxy+fold&category=electronics"
      />,
    );

    expect(screen.getByText("No listings match your filters.")).toBeInTheDocument();
    expect(screen.getByText(/galaxy fold/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /clear filters/i })).toHaveAttribute(
      "href",
      "/search?q=galaxy+fold&category=electronics",
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
        hasActiveFilters={false}
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
        hasActiveFilters={false}
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
        hasActiveFilters={false}
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
        hasActiveFilters={false}
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
