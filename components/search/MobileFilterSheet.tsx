"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import { FilterControls } from "@/components/search/FilterControls";
import { buildSearchHref, countActiveFilters, type SearchFilters } from "@/lib/marketplace/search-params";
import type { CategoryRef, LocationRef } from "@/lib/marketplace/reference-data";

type Props = {
  filters: SearchFilters;
  categories: CategoryRef[];
  provinces: LocationRef[];
  cities: LocationRef[];
  barangays: LocationRef[];
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

/**
 * Custom accessible sheet (role=dialog, focus trap, Escape-to-close)
 * instead of installing shadcn's Sheet primitive or relying on
 * <dialog>/showModal -- the latter isn't reliably implemented in the
 * jsdom test environment this project's unit tests run under, and a
 * shadcn init would pull in class-variance-authority/Radix beyond what
 * one sheet needs. No new dependency added.
 */
export function MobileFilterSheet({ filters, categories, provinces, cities, barangays }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const activeCount = countActiveFilters(filters);

  useEffect(() => {
    if (!isOpen) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;

      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    panelRef.current?.focus();
    const trigger = triggerRef.current;

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      trigger?.focus();
    };
  }, [isOpen]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setIsOpen(true)}
        className="flex h-10 items-center gap-1.5 rounded-[10px] border border-border bg-surface px-3 text-sm font-medium text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
      >
        <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
        Filters
        {activeCount > 0 && (
          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-hover px-1 text-[11px] font-semibold text-white">
            {activeCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setIsOpen(false)} aria-hidden="true" />
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label="Filters"
            tabIndex={-1}
            className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-2xl bg-surface p-4 focus:outline-none"
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-semibold text-ink">Filters</h2>
              <button
                type="button"
                aria-label="Close filters"
                onClick={() => setIsOpen(false)}
                className="flex h-10 w-10 items-center justify-center rounded-full text-ink-secondary hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>

            <FilterControls
              filters={filters}
              categories={categories}
              provinces={provinces}
              cities={cities}
              barangays={barangays}
            />

            <div className="mt-6 flex items-center gap-3">
              <Link
                href={buildSearchHref(filters, CLEAR_ALL_UPDATES)}
                onClick={() => setIsOpen(false)}
                className="flex-1 rounded-[10px] border border-border px-4 py-2.5 text-center text-sm font-medium text-ink-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                Clear all
              </Link>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="flex-1 rounded-[10px] bg-brand-hover px-4 py-2.5 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
              >
                Show results
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
