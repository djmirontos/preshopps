import Link from "next/link";
import Image from "next/image";
import { Package } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { FavoriteButton } from "@/components/marketplace/FavoriteButton";

export type ListingCondition = "like_new" | "very_good" | "good" | "fair";

export type ListingCardData = {
  id: string;
  /** Canonical public route for this listing (PRD §37.2: /item/{slug}). */
  href: string;
  title: string;
  priceCents: number;
  originalPriceCents?: number;
  isNegotiable?: boolean;
  listingType: "preloved" | "brand_new";
  /** Only meaningful for preloved listings. */
  condition?: ListingCondition;
  locationLabel: string;
  postedLabel?: string;
  shopName: string;
  /** Feed queries already exclude reserved/sold; this is for contexts
   * (e.g. shop page, "you may also like") where showing the state matters. */
  status?: "reserved" | "sold";
  /** Public cover image URL. Absent (no image yet, or none returned) falls
   * back to the neutral placeholder. */
  imageUrl?: string;
};

const CONDITION_LABELS: Record<ListingCondition, string> = {
  like_new: "Like New",
  very_good: "Very Good",
  good: "Good",
  fair: "Fair",
};

function formatPriceFromCents(cents: number): string {
  if (cents === 0) return "Free";
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

/**
 * One card component reused for both the mobile rail and the desktop grid
 * (sizing comes entirely from the parent ListingRail / container width).
 * Image ratio is fixed 4:5. No Add to Cart, no rating, no view count, no
 * fulfillment icons — kept deliberately short per the approved card spec.
 */
export function ListingCard({ listing }: { listing: ListingCardData }) {
  const {
    href,
    title,
    priceCents,
    originalPriceCents,
    isNegotiable,
    listingType,
    condition,
    locationLabel,
    postedLabel,
    shopName,
    status,
    imageUrl,
  } = listing;

  // Brand New already communicates condition on its own — never print
  // "Brand New · Brand New".
  const typeLabel =
    listingType === "brand_new"
      ? "Brand New"
      : condition
        ? `Pre-loved · ${CONDITION_LABELS[condition]}`
        : "Pre-loved";

  return (
    <div className="relative w-[44%] shrink-0 snap-start sm:w-[30%] lg:w-auto">
      <Link href={href} className="block focus-visible:outline-none">
        <div className="relative aspect-[4/5] w-full overflow-hidden rounded-[14px] bg-divider">
          {imageUrl ? (
            <Image
              src={imageUrl}
              alt={title}
              fill
              sizes="(max-width: 640px) 44vw, (max-width: 1024px) 30vw, 20vw"
              className="object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <Package className="h-8 w-8 text-ink-muted/60" aria-hidden="true" />
            </div>
          )}

          {status && (
            <span className="absolute left-2 top-2">
              <Badge tone="neutral">{status === "reserved" ? "Reserved" : "Sold"}</Badge>
            </span>
          )}
        </div>

        <div className="mt-2 space-y-0.5">
          <p className="text-xs text-ink-secondary">{typeLabel}</p>

          <h3 className="line-clamp-2 text-sm font-medium text-ink lg:text-[15px]">{title}</h3>

          <div className="flex flex-wrap items-baseline gap-x-1.5 pt-0.5">
            <span className="text-base font-bold tabular-nums text-ink lg:text-lg">
              {formatPriceFromCents(priceCents)}
            </span>
            {typeof originalPriceCents === "number" && originalPriceCents > priceCents && (
              <span className="text-xs tabular-nums text-ink-muted line-through">
                {formatPriceFromCents(originalPriceCents)}
              </span>
            )}
            {isNegotiable && <span className="text-xs font-medium text-accent">Negotiable</span>}
          </div>

          <p className="truncate text-xs text-ink-muted">
            {locationLabel}
            {postedLabel ? ` · ${postedLabel}` : ""}
          </p>
          <p className="truncate text-xs text-ink-muted">{shopName}</p>
        </div>
      </Link>

      {/* Sibling of the Link (not nested inside the <a>) so the button
          stays a valid, independently-interactive element. */}
      <div className="absolute right-2 top-2">
        <FavoriteButton label={`Favorite ${title}`} />
      </div>
    </div>
  );
}
