import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ListingActions } from "@/components/listing/ListingActions";
import { ListingBreadcrumb } from "@/components/listing/ListingBreadcrumb";
import { ListingDescription } from "@/components/listing/ListingDescription";
import { ListingFulfillment } from "@/components/listing/ListingFulfillment";
import { ListingGallery } from "@/components/listing/ListingGallery";
import { ListingHeader } from "@/components/listing/ListingHeader";
import { ListingMeta } from "@/components/listing/ListingMeta";
import { ListingSellerCard } from "@/components/listing/ListingSellerCard";
import { ListingSpecificDetails } from "@/components/listing/ListingSpecificDetails";
import { getListingDetail } from "@/lib/marketplace/listing-detail";

const META_DESCRIPTION_LENGTH = 160;

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
    return { title: "Listing | Preshopps" };
  }

  return {
    title: `${result.listing.title} | Preshopps`,
    description: buildMetaDescription(result.listing.description),
  };
}

export default async function ItemPage({ params }: ItemPageProps) {
  const { publicCode } = await params;
  const result = await getCachedListingDetail(publicCode);

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

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <ListingBreadcrumb categoryName={listing.categoryName} title={listing.title} />

      <div className="lg:grid lg:grid-cols-2 lg:gap-10">
        <div>
          <ListingGallery images={listing.imageUrls} title={listing.title} />
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

          <div className="mt-5">
            <ListingFulfillment methods={listing.fulfillmentMethods} meetupNote={listing.meetupNote} />
          </div>

          <ListingActions status={listing.status} isInquiryOnly={listing.isInquiryOnly} />
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
