import type { ReactNode } from "react";

/**
 * Shared responsive wrapper for listing sections: a CSS scroll-snap rail
 * on mobile/tablet, a static CSS grid from the desktop breakpoint up.
 * No JS carousel — plain overflow-x-auto + scroll-snap.
 */
export function ListingRail({ children }: { children: ReactNode }) {
  return (
    <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 [-ms-overflow-style:none] [scrollbar-width:none] sm:-mx-6 sm:px-6 lg:mx-0 lg:grid lg:grid-cols-4 lg:gap-4 lg:overflow-visible lg:px-0 xl:grid-cols-5 [&::-webkit-scrollbar]:hidden">
      {children}
    </div>
  );
}
