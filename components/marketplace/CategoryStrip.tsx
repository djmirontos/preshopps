"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ChevronLeft, ChevronRight, LayoutGrid } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { CategoryRef } from "@/lib/marketplace/reference-data";
import { getCategoryImage } from "@/lib/marketplace/category-images";
import { TooltipBubble } from "@/components/ui/Tooltip";

/** Fallback only -- used for a category slug with no image mapping (e.g.
 * a future admin-added category not yet covered by category-images.ts).
 * Every currently-live category has a real image, so this normally never
 * renders. */
const FALLBACK_ICON: LucideIcon = LayoutGrid;

// 1px tolerance for sub-pixel scroll-position rounding across browsers.
const EDGE_TOLERANCE_PX = 1;

/**
 * Below 1024px this is a horizontal-scroll rail arranged in TWO rows
 * (grid-auto-flow: column + grid-rows-2 -- the standard CSS technique for
 * a scrolling multi-row rail): the grid places items column-major, so
 * each scrollable "column" holds one adjacent pair (item N above item
 * N+1), not a first-half/second-half split -- that's what lets this stay
 * a single flat list with plain horizontal scroll/snap instead of
 * needing custom data-chunking logic. At >=1024px it reverts to the
 * existing single-row flex rail, which is where cards can run past the
 * visible width with no obvious way to reach the rest -- left/right
 * arrow buttons are added there (lg: and up only) to smooth-scroll the
 * same rail; the touch-swipe 2-row rail below lg keeps its existing
 * mobile-first behavior untouched, arrows never render there. Backed by
 * live categories (fetched via the public-safe reference-data path, not
 * hardcoded). Each item links to /search?category={slug}. Inquiry-only
 * categories (Cars, Motorcycles, For Rent) get no special visual
 * treatment here -- that distinction belongs to the listing detail page,
 * not this chip.
 */
export function CategoryStrip({ categories }: { categories: CategoryRef[] }) {
  const listRef = useRef<HTMLUListElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  // Optimistic default (rather than false) so the right arrow doesn't
  // flash as disabled for a frame before the real measurement runs --
  // scrollLeft's own initial truth (0) is always correct, so that one
  // starts accurate.
  const [canScrollRight, setCanScrollRight] = useState(true);

  const updateScrollState = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > EDGE_TOLERANCE_PX);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - EDGE_TOLERANCE_PX);
  }, []);

  useEffect(() => {
    updateScrollState();
    const el = listRef.current;
    if (!el) return;

    // Manual scrolling (touch, trackpad, or the smooth click-scroll below)
    // and viewport resize (which can change how many cards fit, and
    // therefore whether either end is reachable) both need to refresh
    // arrow state the same way.
    el.addEventListener("scroll", updateScrollState, { passive: true });
    window.addEventListener("resize", updateScrollState);
    return () => {
      el.removeEventListener("scroll", updateScrollState);
      window.removeEventListener("resize", updateScrollState);
    };
  }, [updateScrollState, categories.length]);

  const scrollByDirection = (direction: 1 | -1) => {
    const el = listRef.current;
    if (!el) return;
    // Scroll by ~80% of the visible width -- a natural "page" step that
    // adapts to whatever width the rail actually has, rather than a
    // fixed pixel amount tuned for one viewport size.
    el.scrollBy({ left: direction * el.clientWidth * 0.8, behavior: "smooth" });
  };

  if (categories.length === 0) return null;

  return (
    <section aria-labelledby="categories-heading" className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
      <h2 id="categories-heading" className="sr-only">
        Browse categories
      </h2>
      <div className="relative">
        <button
          type="button"
          onClick={() => scrollByDirection(-1)}
          disabled={!canScrollLeft}
          aria-label="Scroll categories left"
          className="group absolute left-1 top-1/2 z-10 hidden h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-surface text-ink-secondary shadow-sm transition-opacity duration-150 hover:border-brand hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:pointer-events-none disabled:opacity-0 lg:flex"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          <TooltipBubble label="Scroll left" />
        </button>

        <ul
          ref={listRef}
          className="grid snap-x snap-proximity grid-flow-col grid-rows-2 gap-x-3 gap-y-3 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:flex lg:gap-4"
        >
          {categories.map(({ id, slug, name }) => {
            const imageSrc = getCategoryImage(slug);
            return (
              <li key={id} className="flex w-[84px] shrink-0 snap-start flex-col items-center gap-1.5 lg:w-28">
                <Link
                  href={`/search?category=${slug}`}
                  aria-label={name}
                  className="flex h-[72px] w-[72px] items-center justify-center rounded-2xl border border-border bg-surface p-2 transition-colors duration-150 hover:border-brand hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand lg:h-[88px] lg:w-[88px] lg:p-2.5"
                >
                  {imageSrc ? (
                    <Image
                      src={imageSrc}
                      alt=""
                      width={88}
                      height={88}
                      sizes="(min-width: 1024px) 88px, 72px"
                      className="h-full w-full object-contain"
                    />
                  ) : (
                    <FALLBACK_ICON className="h-5 w-5 text-ink-secondary" aria-hidden="true" />
                  )}
                </Link>
                <span className="w-full text-center text-[11px] leading-tight text-ink-secondary lg:text-xs">
                  {name}
                </span>
              </li>
            );
          })}
        </ul>

        <button
          type="button"
          onClick={() => scrollByDirection(1)}
          disabled={!canScrollRight}
          aria-label="Scroll categories right"
          className="group absolute right-1 top-1/2 z-10 hidden h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-surface text-ink-secondary shadow-sm transition-opacity duration-150 hover:border-brand hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:pointer-events-none disabled:opacity-0 lg:flex"
        >
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
          <TooltipBubble label="Scroll right" />
        </button>
      </div>
    </section>
  );
}
