import Link from "next/link";
import Image from "next/image";
import { ExternalLink, ShieldCheck, Star, Store } from "lucide-react";

type Props = {
  slug: string;
  name: string;
  logoUrl: string | undefined;
  locationLabel: string;
  isTrustedSeller: boolean;
  memberSinceLabel: string;
  messengerLink: string | null;
  reviewCount: number;
  averageRating: number | null;
};

/** Uses only safe shop fields already returned by get_listing_detail --
 * no additional query. Building the shop page itself is out of scope;
 * this only links to the canonical /shop/{slug} route. */
export function ListingSellerCard({
  slug,
  name,
  logoUrl,
  locationLabel,
  isTrustedSeller,
  memberSinceLabel,
  messengerLink,
  reviewCount,
  averageRating,
}: Props) {
  return (
    <div className="rounded-[14px] border border-border bg-surface p-4">
      <h2 className="text-lg font-semibold text-ink">Seller</h2>

      <Link
        href={`/shop/${slug}`}
        className="mt-3 flex items-center gap-3 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
      >
        <span className="relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-canvas">
          {logoUrl ? (
            <Image src={logoUrl} alt="" fill sizes="48px" className="object-cover" />
          ) : (
            <Store className="h-5 w-5 text-ink-muted" aria-hidden="true" />
          )}
        </span>

        <span>
          <span className="block text-sm font-semibold text-ink">{name}</span>
          <span className="block text-xs text-ink-muted">{locationLabel}</span>
        </span>
      </Link>

      {isTrustedSeller && (
        <p className="mt-3 flex items-center gap-1.5 text-sm font-medium text-accent">
          <ShieldCheck className="h-4 w-4" aria-hidden="true" />
          Trusted Seller
        </p>
      )}

      <p className="mt-2 flex items-center gap-1.5 text-sm text-ink-secondary">
        {reviewCount > 0 && averageRating !== null ? (
          <>
            <Star className="h-4 w-4 fill-current text-brand-hover" aria-hidden="true" />
            {averageRating.toFixed(1)} · {reviewCount} review{reviewCount === 1 ? "" : "s"}
          </>
        ) : (
          "No reviews yet"
        )}
      </p>

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
  );
}
