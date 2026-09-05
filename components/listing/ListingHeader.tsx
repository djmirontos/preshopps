import { MapPin } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { formatPriceFromCents, type ListingCondition } from "@/components/marketplace/ListingCard";
import { CONDITION_LABELS } from "@/lib/marketplace/search-params";
import type { ListingStatus } from "@/lib/marketplace/listing-detail";

type Props = {
  title: string;
  listingType: "preloved" | "brand_new";
  condition: ListingCondition | undefined;
  priceCents: number;
  originalPriceCents: number | undefined;
  isNegotiable: boolean;
  status: ListingStatus;
  locationLabel: string;
  availableQuantity: number;
};

const STATUS_LABELS: Partial<Record<ListingStatus, string>> = {
  reserved: "Reserved",
  sold: "Sold",
  archived: "Archived",
};

/**
 * Title, type/condition, price, status, and location -- the top info
 * block shared by mobile (stacked) and the desktop right-hand panel.
 * Status uses a text badge (never color alone) so Reserved/Sold/Archived
 * is never conveyed by tint alone.
 */
export function ListingHeader({
  title,
  listingType,
  condition,
  priceCents,
  originalPriceCents,
  isNegotiable,
  status,
  locationLabel,
  availableQuantity,
}: Props) {
  // Brand New already communicates condition on its own -- never print
  // "Brand New · Brand New" (mirrors ListingCard's exact rule).
  const typeLabel =
    listingType === "brand_new"
      ? "Brand New"
      : condition
        ? `Pre-loved · ${CONDITION_LABELS[condition]}`
        : "Pre-loved";

  const statusLabel = STATUS_LABELS[status];

  return (
    <div>
      <p className="text-sm font-medium text-ink-secondary">{typeLabel}</p>

      <h1 className="mt-1 text-2xl font-bold leading-tight text-ink lg:text-[28px]">{title}</h1>

      <div className="mt-3 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <span className="text-2xl font-bold tabular-nums text-ink lg:text-3xl">
          {formatPriceFromCents(priceCents)}
        </span>
        {typeof originalPriceCents === "number" && originalPriceCents > priceCents && (
          <span className="text-base tabular-nums text-ink-muted line-through">
            {formatPriceFromCents(originalPriceCents)}
          </span>
        )}
        {isNegotiable && <span className="text-sm font-medium text-accent">Negotiable</span>}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {statusLabel && <Badge tone="neutral">{statusLabel}</Badge>}
        {status === "available" && availableQuantity > 1 && (
          <span className="text-xs text-ink-muted">{availableQuantity} available</span>
        )}
      </div>

      <p className="mt-3 flex items-center gap-1.5 text-sm text-ink-secondary">
        <MapPin className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
        {locationLabel}
      </p>
    </div>
  );
}
