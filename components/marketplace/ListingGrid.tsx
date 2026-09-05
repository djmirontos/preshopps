import { Children, type ReactNode } from "react";

/**
 * Vertical results grid for /search -- unlike the homepage's horizontal
 * scroll-snap ListingRail, this is a plain responsive CSS grid meant for
 * paginated "Load More" browsing. ListingCard's own width utilities
 * (w-[44%] etc.) are sized for a horizontal rail, so each card is wrapped
 * here and forced to fill its grid cell instead -- ListingCard itself is
 * untouched.
 */
export function ListingGrid({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 lg:grid-cols-4 lg:gap-x-4 xl:grid-cols-5">
      {Children.map(children, (child) => (
        <div className="[&>div]:!w-full">{child}</div>
      ))}
    </div>
  );
}
