"use client";

import { useRouter } from "next/navigation";
import { buildSearchHref, SORT_LABELS, type SearchFilters } from "@/lib/marketplace/search-params";

export function SortSelect({ filters }: { filters: SearchFilters }) {
  const router = useRouter();

  return (
    <select
      aria-label="Sort by"
      value={filters.sort}
      onChange={(event) => {
        const value = event.target.value;
        router.push(buildSearchHref(filters, { sort: value === "newest" ? null : value }), {
          scroll: false,
        });
      }}
      className="h-10 shrink-0 rounded-[10px] border border-border bg-surface px-2.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
    >
      {(Object.entries(SORT_LABELS) as Array<[keyof typeof SORT_LABELS, string]>).map(([value, label]) => (
        <option key={value} value={value}>
          {label}
        </option>
      ))}
    </select>
  );
}
