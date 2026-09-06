import Link from "next/link";

type Props = {
  query: string | null;
  hasActiveFilters: boolean;
  clearFiltersHref: string;
};

/**
 * Three distinct states so a genuinely empty marketplace never reads as
 * "your filters found nothing" (the previous copy always said that, even
 * with zero filters/query active):
 *  - no query, no filters: the marketplace itself has no listings yet.
 *  - filters active (with or without a query): the filters excluded
 *    everything -- the query, if any, is named as a secondary line.
 *  - query only (no other filters): the query itself is named as the
 *    heading, since that's the only thing that could have excluded results.
 * "Clear filters" only appears when there's something to clear; "Browse
 * all listings" only appears when the user isn't already looking at the
 * unfiltered marketplace.
 */
export function SearchEmptyState({ query, hasActiveFilters, clearFiltersHref }: Props) {
  const heading =
    !query && !hasActiveFilters
      ? "No listings yet."
      : query && !hasActiveFilters
        ? `No results for “${query}”.`
        : "No listings match your filters.";

  const supportingLine = !query && !hasActiveFilters
    ? "New items will appear here as sellers start listing."
    : hasActiveFilters && query
      ? `No results for “${query}”.`
      : null;

  const showActions = Boolean(query) || hasActiveFilters;

  return (
    <div className="rounded-[14px] border border-border bg-surface px-4 py-10 text-center">
      <p className="text-sm font-medium text-ink">{heading}</p>
      {supportingLine && <p className="mt-1 text-sm text-ink-muted">{supportingLine}</p>}
      {showActions && (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
          {hasActiveFilters && (
            <Link
              href={clearFiltersHref}
              className="rounded-[10px] border border-border px-4 py-2 text-sm font-medium text-ink-secondary hover:border-brand-hover hover:text-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              Clear filters
            </Link>
          )}
          <Link
            href="/search"
            className="rounded-[10px] bg-brand-hover px-4 py-2 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
          >
            Browse all listings
          </Link>
        </div>
      )}
    </div>
  );
}
