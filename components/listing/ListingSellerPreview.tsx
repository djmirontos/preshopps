import Link from "next/link";
import { ShieldCheck, Star } from "lucide-react";

type Props = {
  slug: string;
  name: string;
  isTrustedSeller: boolean;
  reviewCount: number;
  averageRating: number | null;
};

/**
 * Compact identity/trust line shown right under the price/status block --
 * so a buyer (mobile especially) learns who they'd be buying from before
 * scrolling through fulfillment/actions/description. The full seller card
 * (Messenger, member since, larger logo) still renders further down; this
 * doesn't duplicate it -- only the shop name is a link (kept as its own
 * element, not merged into one long-accessible-name link with the trust/
 * rating text), using data listing-detail.ts already returns (no new
 * DTO/API field).
 */
export function ListingSellerPreview({ slug, name, isTrustedSeller, reviewCount, averageRating }: Props) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <Link
        href={`/shop/${slug}`}
        className="rounded font-semibold text-ink hover:text-brand-link focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
      >
        {name}
      </Link>

      {isTrustedSeller && (
        <span className="flex items-center gap-1 text-xs font-medium text-accent">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
          Trusted Seller
        </span>
      )}

      {reviewCount > 0 && averageRating !== null && (
        <span className="flex items-center gap-1 text-xs text-ink-secondary">
          <Star className="h-3.5 w-3.5 fill-current text-brand-link" aria-hidden="true" />
          {averageRating.toFixed(1)} · {reviewCount} review{reviewCount === 1 ? "" : "s"}
        </span>
      )}
    </div>
  );
}
