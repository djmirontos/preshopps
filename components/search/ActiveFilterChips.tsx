import Link from "next/link";
import { X } from "lucide-react";
import {
  buildSearchHref,
  CONDITION_LABELS,
  FULFILLMENT_LABELS,
  LISTING_TYPE_LABELS,
  type SearchFilters,
} from "@/lib/marketplace/search-params";

type Chip = { key: string; label: string; href: string };

type Props = {
  filters: SearchFilters;
  categoryName: string | null;
  locationLabel: string | null;
};

const CLEAR_ALL_UPDATES = {
  category: null,
  type: null,
  condition: null,
  min_price: null,
  max_price: null,
  province: null,
  city: null,
  barangay: null,
  fulfillment: null,
} as const;

function formatPesos(cents: number): string {
  return `₱${Math.round(cents / 100).toLocaleString("en-PH")}`;
}

/** Purely derived from the URL -- server-rendered, no client JS needed.
 * Each chip's × removes only that one filter dimension and preserves
 * every other param; location collapses to a single chip/removal unit
 * (province+city+barangay together) since that's how it's presented. */
export function ActiveFilterChips({ filters, categoryName, locationLabel }: Props) {
  const chips: Chip[] = [];

  if (categoryName) {
    chips.push({ key: "category", label: categoryName, href: buildSearchHref(filters, { category: null }) });
  }
  if (filters.listingType) {
    chips.push({
      key: "type",
      label: LISTING_TYPE_LABELS[filters.listingType],
      href: buildSearchHref(filters, { type: null }),
    });
  }
  if (filters.condition) {
    chips.push({
      key: "condition",
      label: CONDITION_LABELS[filters.condition],
      href: buildSearchHref(filters, { condition: null }),
    });
  }
  if (filters.minPriceCents !== null || filters.maxPriceCents !== null) {
    const { minPriceCents, maxPriceCents } = filters;
    const label =
      minPriceCents !== null && maxPriceCents !== null
        ? `${formatPesos(minPriceCents)}–${formatPesos(maxPriceCents)}`
        : minPriceCents !== null
          ? `From ${formatPesos(minPriceCents)}`
          : `Under ${formatPesos(maxPriceCents!)}`;
    chips.push({ key: "price", label, href: buildSearchHref(filters, { min_price: null, max_price: null }) });
  }
  if (locationLabel) {
    chips.push({
      key: "location",
      label: locationLabel,
      href: buildSearchHref(filters, { province: null, city: null, barangay: null }),
    });
  }
  if (filters.fulfillment) {
    chips.push({
      key: "fulfillment",
      label: FULFILLMENT_LABELS[filters.fulfillment],
      href: buildSearchHref(filters, { fulfillment: null }),
    });
  }

  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {chips.map((chip) => (
        <Link
          key={chip.key}
          href={chip.href}
          className="flex h-8 items-center gap-1 rounded-full border border-border bg-surface px-3 text-xs font-medium text-ink-secondary hover:border-brand-hover hover:text-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          {chip.label}
          <X className="h-3 w-3" aria-hidden="true" />
        </Link>
      ))}
      {chips.length > 1 && (
        <Link
          href={buildSearchHref(filters, CLEAR_ALL_UPDATES)}
          className="flex h-8 items-center rounded-full px-3 text-xs font-medium text-brand-hover hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          Clear all
        </Link>
      )}
    </div>
  );
}
