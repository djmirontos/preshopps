"use client";

import { useState } from "react";
import type { SearchFilters } from "@/lib/marketplace/search-params";

type PriceUpdates = { min_price: string | null; max_price: string | null };

const INPUT_CLASS =
  "h-11 w-full min-w-0 rounded-[10px] border border-border bg-surface px-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand";

function centsToPesosInput(cents: number | null): string {
  return cents === null ? "" : String(Math.round(cents / 100));
}

/**
 * Price is the one control that doesn't apply on every keystroke -- typing
 * a digit at a time shouldn't trigger a navigation per keystroke. Local
 * text state here is exactly the "UI filters before URL synchronization"
 * exception (ARCHITECTURE.md S6): it's committed to the URL on blur or
 * Enter, never read back from anywhere else.
 *
 * The parent remounts this component (via a `key` derived from the
 * committed min/max) whenever the URL's price actually changes, so state
 * resets on commit without an effect synchronizing props back into state.
 */
export function PriceRangeFields({
  filters,
  onApply,
}: {
  filters: SearchFilters;
  onApply: (updates: PriceUpdates) => void;
}) {
  const [min, setMin] = useState(centsToPesosInput(filters.minPriceCents));
  const [max, setMax] = useState(centsToPesosInput(filters.maxPriceCents));

  function apply() {
    onApply({ min_price: min.trim() || null, max_price: max.trim() || null });
  }

  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        inputMode="numeric"
        min={0}
        aria-label="Minimum price"
        placeholder="Min"
        value={min}
        onChange={(event) => setMin(event.target.value)}
        onBlur={apply}
        onKeyDown={(event) => event.key === "Enter" && apply()}
        className={INPUT_CLASS}
      />
      <span className="shrink-0 text-ink-muted" aria-hidden="true">
        –
      </span>
      <input
        type="number"
        inputMode="numeric"
        min={0}
        aria-label="Maximum price"
        placeholder="Max"
        value={max}
        onChange={(event) => setMax(event.target.value)}
        onBlur={apply}
        onKeyDown={(event) => event.key === "Enter" && apply()}
        className={INPUT_CLASS}
      />
    </div>
  );
}
