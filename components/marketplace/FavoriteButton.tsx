"use client";

import { useState } from "react";
import { Heart } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * Visual-only favorite toggle. Purely local/presentational state — no
 * persistence, no auth gate yet. Kept as its own small client component so
 * the ListingCard/homepage around it stays server-rendered.
 */
export function FavoriteButton({ label }: { label: string }) {
  const [isFavorited, setIsFavorited] = useState(false);

  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={isFavorited}
      onClick={(event) => {
        event.preventDefault();
        setIsFavorited((value) => !value);
      }}
      className="flex h-11 w-11 items-center justify-center rounded-full bg-white/85 text-ink-secondary shadow-sm backdrop-blur-sm transition-colors duration-150 hover:text-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
    >
      <Heart
        className={cn("h-4 w-4", isFavorited && "fill-brand-hover text-brand-hover")}
        aria-hidden="true"
      />
    </button>
  );
}
