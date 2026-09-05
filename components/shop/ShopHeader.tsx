import Image from "next/image";
import { CheckCircle2, ExternalLink, MapPin, Package, ShieldCheck, Star, Store } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import type { ShopStatus } from "@/lib/marketplace/shop-detail";

type Props = {
  name: string;
  logoUrl: string | undefined;
  locationLabel: string;
  status: ShopStatus;
  isTrustedSeller: boolean;
  memberSinceLabel: string;
  messengerLink: string | null;
  reviewCount: number;
  averageRating: number | null;
  completedOrderCount: number;
  activeListingCount: number;
};

/**
 * The "who is this seller" hero card -- identity, trust signals, and
 * reputation stats together, using only fields get_shop_detail already
 * returns. A clean horizontal layout on desktop, stacked on mobile. Away
 * shops are never hidden, just shown with a restrained text badge.
 */
export function ShopHeader({
  name,
  logoUrl,
  locationLabel,
  status,
  isTrustedSeller,
  memberSinceLabel,
  messengerLink,
  reviewCount,
  averageRating,
  completedOrderCount,
  activeListingCount,
}: Props) {
  return (
    <div className="rounded-[14px] border border-border bg-surface p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <span className="relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-canvas">
          {logoUrl ? (
            <Image src={logoUrl} alt={`${name} logo`} fill sizes="64px" className="object-cover" />
          ) : (
            <Store className="h-7 w-7 text-ink-muted" aria-hidden="true" />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold text-ink lg:text-2xl">{name}</h1>
            {status === "away" && <Badge tone="neutral">Away</Badge>}
          </div>

          <p className="mt-1 flex items-center gap-1.5 text-sm text-ink-secondary">
            <MapPin className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
            {locationLabel}
          </p>

          {isTrustedSeller && (
            <p className="mt-2 flex items-center gap-1.5 text-sm font-medium text-accent">
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
              Trusted Seller
            </p>
          )}

          <p className="mt-1 text-xs text-ink-muted">Member since {memberSinceLabel}</p>

          {messengerLink && (
            <a
              href={messengerLink}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex h-10 items-center gap-1.5 rounded-[10px] border border-border px-3 text-sm font-medium text-ink-secondary hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              Contact on Messenger
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          )}
        </div>
      </div>

      <div className="mt-5 grid grid-cols-3 gap-3 border-t border-divider pt-4 text-center">
        <div>
          <p className="flex items-center justify-center gap-1 text-sm font-semibold text-ink">
            {reviewCount > 0 && averageRating !== null ? (
              <>
                <Star className="h-4 w-4 fill-current text-brand-hover" aria-hidden="true" />
                {averageRating.toFixed(1)}
              </>
            ) : (
              "—"
            )}
          </p>
          <p className="text-xs text-ink-muted">
            {reviewCount > 0 ? `${reviewCount} review${reviewCount === 1 ? "" : "s"}` : "No reviews yet"}
          </p>
        </div>

        <div>
          <p className="flex items-center justify-center gap-1 text-sm font-semibold text-ink">
            <CheckCircle2 className="h-4 w-4 text-ink-muted" aria-hidden="true" />
            {completedOrderCount}
          </p>
          <p className="text-xs text-ink-muted">Completed orders</p>
        </div>

        <div>
          <p className="flex items-center justify-center gap-1 text-sm font-semibold text-ink">
            <Package className="h-4 w-4 text-ink-muted" aria-hidden="true" />
            {activeListingCount}
          </p>
          <p className="text-xs text-ink-muted">Active listings</p>
        </div>
      </div>
    </div>
  );
}
