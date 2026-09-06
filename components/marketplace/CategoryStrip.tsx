import Image from "next/image";
import Link from "next/link";
import { LayoutGrid } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { CategoryRef } from "@/lib/marketplace/reference-data";
import { getCategoryImage } from "@/lib/marketplace/category-images";

/** Fallback only -- used for a category slug with no image mapping (e.g.
 * a future admin-added category not yet covered by category-images.ts).
 * Every currently-live category has a real image, so this normally never
 * renders. */
const FALLBACK_ICON: LucideIcon = LayoutGrid;

/**
 * Below 1024px this is a horizontal-scroll rail arranged in TWO rows
 * (grid-auto-flow: column + grid-rows-2 -- the standard CSS technique for
 * a scrolling multi-row rail): the grid places items column-major, so
 * each scrollable "column" holds one adjacent pair (item N above item
 * N+1), not a first-half/second-half split -- that's what lets this stay
 * a single flat list with plain horizontal scroll/snap instead of
 * needing custom data-chunking logic. At >=1024px it reverts to the
 * existing single-row flex rail. Backed by live categories (fetched via
 * the public-safe reference-data path, not hardcoded). Each item links
 * to /search?category={slug}. Inquiry-only categories (Cars, Motorcycles,
 * For Rent) get no special visual treatment here -- that distinction
 * belongs to the listing detail page, not this chip.
 */
export function CategoryStrip({ categories }: { categories: CategoryRef[] }) {
  if (categories.length === 0) return null;

  return (
    <section aria-labelledby="categories-heading" className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
      <h2 id="categories-heading" className="sr-only">
        Browse categories
      </h2>
      <ul className="grid snap-x snap-proximity grid-flow-col grid-rows-2 gap-x-3 gap-y-3 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:flex lg:gap-4">
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
    </section>
  );
}
