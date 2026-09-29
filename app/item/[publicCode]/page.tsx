import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ListingActions } from "@/components/listing/ListingActions";
import { ListingBreadcrumb } from "@/components/listing/ListingBreadcrumb";
import { FavoriteButton } from "@/components/marketplace/FavoriteButton";
import { ListingDescription } from "@/components/listing/ListingDescription";
import { ListingFulfillment } from "@/components/listing/ListingFulfillment";
import { ListingGallery } from "@/components/listing/ListingGallery";
import { ListingHeader } from "@/components/listing/ListingHeader";
import { ListingMeta } from "@/components/listing/ListingMeta";
import { ListingSellerCard } from "@/components/listing/ListingSellerCard";
import { ListingSellerPreview } from "@/components/listing/ListingSellerPreview";
import { ListingSpecificDetails } from "@/components/listing/ListingSpecificDetails";
import { getListingDetail, type ListingDetail } from "@/lib/marketplace/listing-detail";
import { getAuthUser } from "@/lib/auth/session";
import { getMyShop } from "@/lib/seller/get-my-shop";
import { getAppUrl } from "@/lib/env";
import { formatPriceFromCents } from "@/components/marketplace/ListingCard";
import { CONDITION_LABELS } from "@/lib/marketplace/search-params";

const META_DESCRIPTION_LENGTH = 160;

/** Same three-way convention ListingHeader's own STATUS_LABELS already
 * uses for the page's visible status badge -- reused here (not
 * redefined as a narrower sold/archived-only map) so the Open Graph
 * description never contradicts what the page itself shows. Undefined
 * for "available", which is exactly when no unavailability prefix
 * should appear at all. */
const STATUS_UNAVAILABLE_LABELS: Partial<Record<ListingDetail["status"], string>> = {
  reserved: "Reserved",
  sold: "Sold",
  archived: "Archived",
};

/** Mirrors ListingHeader's own exact typeLabel rule (Brand New never
 * repeats "· Brand New"; Pre-loved shows its condition only when known)
 * so the Open Graph description and the page's own visible label never
 * disagree. */
function buildTypeConditionLabel(listing: ListingDetail): string {
  return listing.listingType === "brand_new"
    ? "Brand New"
    : listing.condition
      ? `Pre-loved · ${CONDITION_LABELS[listing.condition]}`
      : "Pre-loved";
}

/** Price, type/condition, and location per ARCHITECTURE_ESSENTIALS §23's
 * social-preview requirement, plus an explicit unavailability prefix so
 * a sold/reserved/archived listing's own shared preview never reads as
 * "currently available" -- prepended ahead of the ordinary meta
 * description, never replacing it. */
function buildOgDescription(listing: ListingDetail): string {
  const statusLabel = STATUS_UNAVAILABLE_LABELS[listing.status];
  const summary = [statusLabel, formatPriceFromCents(listing.priceCents), buildTypeConditionLabel(listing), listing.locationLabel]
    .filter((part): part is string => Boolean(part))
    .join(" · ");
  const base = buildMetaDescription(listing.description);
  return summary ? `${summary} — ${base}` : base;
}

/**
 * Escaping "<" prevents seller-supplied text (e.g. a listing title or
 * description containing "</script><script>...") from breaking out of
 * the JSON-LD script element below -- JSON.stringify alone does not
 * escape it, since "<" is a perfectly valid JSON string character.
 */
function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

/**
 * JSON-LD Product/Offer for one narrow, unambiguous case: a found,
 * available, in-stock, non-inquiry-only listing with a real image and a
 * valid price -- reusing the same listing data generateMetadata/the page
 * body already fetch (no added query). Deliberately omits
 * review/aggregateRating (no per-listing rating exists -- reviewCount/
 * averageRating here are the SHOP's own stats, not this item's, and
 * marking them up as a product rating would misattribute a seller rating
 * to the product), brand/GTIN/MPN (not captured for ordinary listings),
 * and any shipping/return/purchase-action claim (Preshopps never
 * processes payment or fulfillment). Cars/Motorcycles/For Rent
 * (isInquiryOnly) are excluded entirely: Product/Offer implies a fixed,
 * directly-offered price that doesn't fit negotiable inquiry-only or
 * period-priced rental listings. isNegotiable is checked independently
 * of isInquiryOnly -- they are separate, independently-settable columns
 * (ListingForm's "Price is negotiable" checkbox is not gated by
 * category), so an ordinary listing can genuinely have isNegotiable
 * true; marking that up as a fixed Offer.price would misrepresent a
 * negotiable asking price as fixed. priceCents <= 0 is excluded because
 * the listings_price_cents_check DB constraint only enforces >= 0 (not
 * > 0) and publish_listing only null-checks price, so a published
 * listing with price_cents = 0 is a real, reachable state, not merely a
 * type-level impossibility.
 */
function buildListingJsonLd(listing: ListingDetail): Record<string, unknown> | null {
  const image = listing.imageUrls[0];
  if (
    listing.status !== "available" ||
    listing.availableQuantity <= 0 ||
    listing.isInquiryOnly ||
    listing.isNegotiable ||
    !image ||
    !Number.isFinite(listing.priceCents) ||
    listing.priceCents <= 0
  ) {
    return null;
  }

  const canonicalUrl = `${getAppUrl()}/item/${listing.publicCode}`;
  const description = listing.description.trim();

  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: listing.title,
    ...(description ? { description } : {}),
    url: canonicalUrl,
    image: listing.imageUrls,
    offers: {
      "@type": "Offer",
      url: canonicalUrl,
      price: (listing.priceCents / 100).toFixed(2),
      priceCurrency: "PHP",
      availability: "https://schema.org/InStock",
      itemCondition:
        listing.listingType === "brand_new" ? "https://schema.org/NewCondition" : "https://schema.org/UsedCondition",
      seller: {
        "@type": "Organization",
        name: listing.shop.name,
        url: `${getAppUrl()}/shop/${listing.shop.slug}`,
      },
    },
  };
}

/**
 * Memoized per-request so generateMetadata and the page body share one
 * get_listing_detail call instead of fetching the same listing twice.
 */
const getCachedListingDetail = cache(getListingDetail);

type ItemPageProps = {
  params: Promise<{ publicCode: string }>;
};

function buildMetaDescription(description: string): string {
  const trimmed = description.trim();
  if (!trimmed) return "Buy and sell pre-loved and brand-new items on Preshopps.";
  return trimmed.length > META_DESCRIPTION_LENGTH
    ? `${trimmed.slice(0, META_DESCRIPTION_LENGTH - 1).trimEnd()}…`
    : trimmed;
}

export async function generateMetadata({ params }: ItemPageProps): Promise<Metadata> {
  // The [publicCode] route segment is the listing's public_code -- the
  // locked MVP route identity (see lib/marketplace/browse-listings.ts):
  // slug is cosmetic/non-unique, public_code is the only key
  // get_listing_detail accepts and the only value this route resolves on.
  const { publicCode } = await params;
  const result = await getCachedListingDetail(publicCode);

  if (result.status !== "found") {
    // Uniform for nonexistent/draft/paused/suspended-seller listings --
    // no canonical/Open Graph field of any kind, so nothing about a
    // private or nonexistent listing is ever derived into metadata.
    return { title: "Listing | Preshopps" };
  }

  const { listing } = result;
  const title = `${listing.title} | Preshopps`;
  // listing.publicCode is the resolved value from the fetched row, not
  // the raw route param -- both are the same value for this route today
  // (public_code is this route's only key, unlike the shop route's own
  // slug/current-slug distinction below), but resolving from the fetched
  // record is the same defensive convention used there.
  const canonicalUrl = `${getAppUrl()}/item/${listing.publicCode}`;

  return {
    title,
    description: buildMetaDescription(listing.description),
    alternates: { canonical: canonicalUrl },
    openGraph: {
      title,
      description: buildOgDescription(listing),
      url: canonicalUrl,
      type: "website",
      // Omitted entirely (never a fallback/placeholder URL) when the
      // listing has no image -- listing.imageUrls[0] is already an
      // absolute Supabase Storage URL when present (getListingImageUrl).
      images: listing.imageUrls[0] ? [{ url: listing.imageUrls[0] }] : undefined,
    },
  };
}

export default async function ItemPage({ params }: ItemPageProps) {
  const { publicCode } = await params;
  const [result, user] = await Promise.all([getCachedListingDetail(publicCode), getAuthUser()]);
  // getMyShop() only matters once we know the listing exists and the
  // viewer is signed in -- skipped otherwise to avoid a pointless query.
  const myShop = result.status === "found" && user ? await getMyShop() : null;

  if (result.status === "not_found") {
    // get_listing_detail raises the identical LISTING_NOT_FOUND signal for
    // a nonexistent, draft, paused, or suspended-seller listing -- this
    // page must never distinguish those cases, so it always renders the
    // same standard Next.js 404 regardless of which one occurred.
    notFound();
  }

  if (result.status === "error") {
    return (
      <div className="mx-auto max-w-7xl px-4 py-16 text-center sm:px-6 lg:px-8">
        <p className="text-sm text-ink-secondary">Unable to load this listing right now.</p>
      </div>
    );
  }

  const { listing } = result;
  const listingJsonLd = buildListingJsonLd(listing);

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      {listingJsonLd && (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(listingJsonLd) }} />
      )}
      <ListingBreadcrumb categoryName={listing.categoryName} title={listing.title} />

      <div className="lg:grid lg:grid-cols-2 lg:gap-10">
        <div className="relative">
          <ListingGallery images={listing.imageUrls} title={listing.title} />
          {/* Sibling of the gallery (not nested inside its own links), same
              composition/positioning as ListingCard's favorite corner. */}
          <div className="absolute right-3 top-3">
            <FavoriteButton
              listingId={listing.id}
              label={listing.title}
              next={`/item/${listing.publicCode}`}
            />
          </div>
        </div>

        <div className="mt-5 lg:mt-0">
          <ListingHeader
            title={listing.title}
            listingType={listing.listingType}
            condition={listing.condition}
            priceCents={listing.priceCents}
            originalPriceCents={listing.originalPriceCents}
            isNegotiable={listing.isNegotiable}
            status={listing.status}
            locationLabel={listing.locationLabel}
            availableQuantity={listing.availableQuantity}
          />

          <ListingSellerPreview
            slug={listing.shop.slug}
            name={listing.shop.name}
            isTrustedSeller={listing.shop.isTrustedSeller}
            reviewCount={listing.reviewCount}
            averageRating={listing.averageRating}
          />

          <div className="mt-5">
            <ListingFulfillment methods={listing.fulfillmentMethods} meetupNote={listing.meetupNote} />
          </div>

          <ListingActions
            listingId={listing.id}
            publicCode={listing.publicCode}
            shopId={listing.shop.id}
            availableQuantity={listing.availableQuantity}
            listingTitle={listing.title}
            listingImageUrl={listing.imageUrls[0]}
            status={listing.status}
            isInquiryOnly={listing.isInquiryOnly}
            isAuthenticated={Boolean(user)}
            isOwnListing={myShop?.id === listing.shop.id}
            next={`/item/${listing.publicCode}`}
          />
        </div>
      </div>

      <div className="mt-8 space-y-8 lg:mt-10">
        <ListingSpecificDetails vehicle={listing.vehicleDetails} rental={listing.rentalDetails} />

        <ListingDescription description={listing.description} knownFlaws={listing.knownFlaws} />

        <ListingSellerCard
          slug={listing.shop.slug}
          name={listing.shop.name}
          logoUrl={listing.shop.logoUrl}
          locationLabel={listing.shop.locationLabel}
          isTrustedSeller={listing.shop.isTrustedSeller}
          memberSinceLabel={listing.shop.memberSinceLabel}
          messengerLink={listing.shop.messengerLink}
          reviewCount={listing.reviewCount}
          averageRating={listing.averageRating}
        />

        <ListingMeta categoryName={listing.categoryName} postedLabel={listing.postedLabel} publicCode={listing.publicCode} />
      </div>
    </div>
  );
}
