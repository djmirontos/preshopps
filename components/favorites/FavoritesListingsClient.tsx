"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { ListingCard, type ListingCardData } from "@/components/marketplace/ListingCard";
import { ListingGrid } from "@/components/marketplace/ListingGrid";
import { SectionEmptyState } from "@/components/marketplace/SectionEmptyState";
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
};

/**
 * Same server-rendered-first-page + Load More shape as ShopListingsClient/
 * SearchResultsClient. The empty state here is favorites-specific copy
 * ("No favorites yet.") rather than the generic SectionEmptyState message,
 * since this page's zero-state has its own approved wording and a link
 * back to browsing.
 */
export function FavoritesListingsClient({ initialListings, initialHadError, initialCursor, loadMore }: Props) {
  const [listings, setListings] = useState(initialListings);
  const [cursor, setCursor] = useState(initialCursor);
  const [loadMoreFailed, setLoadMoreFailed] = useState(false);
  const [isPending, startTransition] = useTransition();

  if (initialHadError) {
    return <SectionEmptyState message="Unable to load your favorites right now." />;
  }

  if (listings.length === 0) {
    return (
      <div className="rounded-[14px] border border-border bg-canvas px-4 py-10 text-center">
        <p className="text-sm font-medium text-ink">No favorites yet.</p>
        <p className="mt-1 text-sm text-ink-muted">Items you save will appear here.</p>
        <Link
          href="/search"
          className="mt-4 inline-flex h-10 items-center rounded-[10px] bg-brand-action px-4 text-sm font-semibold text-brand-action-text hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
        >
          Browse listings
        </Link>
      </div>
    );
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
            className="rounded-[10px] border border-border bg-surface px-5 py-2.5 text-sm font-semibold text-ink hover:border-brand-link hover:text-brand-link disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            {isPending ? "Loading…" : "Load more"}
          </button>
          {loadMoreFailed && <p className="text-xs text-danger">Unable to load more favorites right now.</p>}
        </div>
      )}
    </div>
  );
}
