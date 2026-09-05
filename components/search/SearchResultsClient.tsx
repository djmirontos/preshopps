"use client";

import { useState, useTransition } from "react";
import { ListingCard, type ListingCardData } from "@/components/marketplace/ListingCard";
import { ListingGrid } from "@/components/marketplace/ListingGrid";
import { SectionEmptyState } from "@/components/marketplace/SectionEmptyState";
import { SearchEmptyState } from "@/components/search/SearchEmptyState";
import type { BrowseCursor } from "@/lib/marketplace/search-params";

type LoadMoreResult = {
  listings: ListingCardData[];
  hadError: boolean;
  nextCursor: BrowseCursor | null;
};

type Props = {
  initialListings: ListingCardData[];
  initialHadError: boolean;
  initialCursor: BrowseCursor | null;
  loadMore: (cursor: BrowseCursor) => Promise<LoadMoreResult>;
  query: string | null;
  clearFiltersHref: string;
};

/**
 * Initial results are server-rendered (passed in as props from the RSC
 * page render, already reflecting the current URL filters) -- this client
 * boundary exists only for the "Load More" interaction. `loadMore` is a
 * Server Action closing over the current filters, so pagination never
 * runs the RPC from the browser and never duplicates the initial fetch.
 *
 * The page gives this component a `key` derived from the current filters,
 * so a filter change (a fresh navigation with fresh initial results)
 * remounts it with a clean slate instead of needing an effect to
 * synchronize accumulated state back to the new props.
 */
export function SearchResultsClient({
  initialListings,
  initialHadError,
  initialCursor,
  loadMore,
  query,
  clearFiltersHref,
}: Props) {
  const [listings, setListings] = useState(initialListings);
  const [cursor, setCursor] = useState(initialCursor);
  const [loadMoreFailed, setLoadMoreFailed] = useState(false);
  const [isPending, startTransition] = useTransition();

  if (initialHadError) {
    return <SectionEmptyState message="Unable to load listings right now." />;
  }

  if (listings.length === 0) {
    return <SearchEmptyState query={query} clearFiltersHref={clearFiltersHref} />;
  }

  function handleLoadMore() {
    if (!cursor) return;
    setLoadMoreFailed(false);
    startTransition(async () => {
      const result = await loadMore(cursor);
      if (result.hadError) {
        setLoadMoreFailed(true);
        return;
      }
      setListings((prev) => [...prev, ...result.listings]);
      setCursor(result.nextCursor);
    });
  }

  return (
    <div>
      <ListingGrid>
        {listings.map((listing) => (
          <ListingCard key={listing.id} listing={listing} />
        ))}
      </ListingGrid>

      {cursor && (
        <div className="mt-6 flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={handleLoadMore}
            disabled={isPending}
            className="rounded-[10px] border border-border bg-surface px-5 py-2.5 text-sm font-semibold text-ink hover:border-brand-hover hover:text-brand-hover disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            {isPending ? "Loading…" : "Load more"}
          </button>
          {loadMoreFailed && <p className="text-xs text-danger">Unable to load more listings right now.</p>}
        </div>
      )}
    </div>
  );
}
