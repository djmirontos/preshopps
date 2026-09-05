import Link from "next/link";

type Props = {
  query: string | null;
  clearFiltersHref: string;
};

export function SearchEmptyState({ query, clearFiltersHref }: Props) {
  return (
    <div className="rounded-[14px] border border-dashed border-border bg-surface px-4 py-12 text-center">
      <p className="text-sm font-medium text-ink">No listings match your filters.</p>
      {query && <p className="mt-1 text-sm text-ink-muted">No results for &ldquo;{query}&rdquo;.</p>}
      <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
        <Link
          href={clearFiltersHref}
          className="rounded-[10px] border border-border px-4 py-2 text-sm font-medium text-ink-secondary hover:border-brand-hover hover:text-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          Clear filters
        </Link>
        <Link
          href="/search"
          className="rounded-[10px] bg-brand-hover px-4 py-2 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
        >
          Browse all listings
        </Link>
      </div>
    </div>
  );
}
