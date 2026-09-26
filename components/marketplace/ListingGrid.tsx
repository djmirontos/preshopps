import { Children, type ReactNode } from "react";

/**
 * Shared vertical results grid: exactly 2 columns on mobile, 3 from `sm`,
 * 4 from `lg`, 5 from `xl` -- used by /search's paginated "Load More"
 * browsing, favorites, shop listings, and (since the horizontal-scroll
 * ListingRail was retired) the homepage's own Fresh Finds/Pre-loved/Brand
 * New sections. A plain CSS grid, never horizontal scroll -- additional
 * items always appear in further rows as the page scrolls vertically,
 * never require a clipped card or a scrollbar. ListingCard's own width
 * utilities (w-[44%] etc., sized for the retired horizontal rail) are
 * overridden here to fill each grid cell instead -- ListingCard itself is
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
