import { cache } from "react";
import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { ShopBreadcrumb } from "@/components/shop/ShopBreadcrumb";
import { ShopDescription } from "@/components/shop/ShopDescription";
import { ShopFeaturedListing } from "@/components/shop/ShopFeaturedListing";
import { ShopHeader } from "@/components/shop/ShopHeader";
import { ShopListingsClient } from "@/components/shop/ShopListingsClient";
import { getShopDetail } from "@/lib/marketplace/shop-detail";
import { getShopListings } from "@/lib/marketplace/shop-listings";
import type { BrowseCursor } from "@/lib/marketplace/search-params";

const LISTINGS_LIMIT = 20;
const META_DESCRIPTION_LENGTH = 160;

/**
 * Memoized per-request so generateMetadata and the page body share one
 * get_shop_detail call instead of fetching the same shop twice.
 */
const getCachedShopDetail = cache(getShopDetail);

type ShopPageProps = {
  params: Promise<{ slug: string }>;
};

function buildMetaDescription(name: string, description: string | null): string {
  const trimmed = description?.trim();
  if (trimmed) {
    return trimmed.length > META_DESCRIPTION_LENGTH
      ? `${trimmed.slice(0, META_DESCRIPTION_LENGTH - 1).trimEnd()}…`
      : trimmed;
  }
  return `Browse listings from ${name} on Preshopps.`;
}

export async function generateMetadata({ params }: ShopPageProps): Promise<Metadata> {
  const { slug } = await params;
  const result = await getCachedShopDetail(slug);

  if (result.status !== "found") {
    return { title: "Shop | Preshopps" };
  }

  return {
    title: `${result.shop.name} | Preshopps`,
    description: buildMetaDescription(result.shop.name, result.shop.description),
  };
}

export default async function ShopPage({ params }: ShopPageProps) {
  const { slug } = await params;
  const result = await getCachedShopDetail(slug);

  if (result.status === "not_found") {
    // get_shop_detail raises the identical SHOP_NOT_FOUND signal for a
    // nonexistent slug or a suspended-seller shop -- this page must never
    // distinguish those cases, so it always renders the same standard
    // Next.js 404 regardless of which one occurred.
    notFound();
  }

  if (result.status === "error") {
    return (
      <div className="mx-auto max-w-7xl px-4 py-16 text-center sm:px-6 lg:px-8">
        <p className="text-sm text-ink-secondary">Unable to load this shop right now.</p>
      </div>
    );
  }

  const { shop, isCurrentSlug } = result;

  if (!isCurrentSlug) {
    // Canonical rule: old shop slugs redirect forever. get_shop_detail
    // already resolves historical slugs via shop_slugs and tells us
    // whether the requested one matches the current one -- no separate
    // slug-history query needed.
    permanentRedirect(`/shop/${shop.slug}`);
  }

  const listingsResult = await getShopListings(shop.id, LISTINGS_LIMIT);

  async function loadMoreAction(cursor: BrowseCursor) {
    "use server";
    return getShopListings(shop.id, LISTINGS_LIMIT, cursor);
  }

  // Matched against the shop's own already-fetched listings page -- never
  // a second listing-detail query. If the featured listing isn't on this
  // page (or is otherwise not currently visible), the section is simply
  // omitted rather than faking one.
  const featuredListing = shop.featuredListingId
    ? listingsResult.listings.find((listing) => listing.id === shop.featuredListingId)
    : undefined;

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <ShopBreadcrumb shopName={shop.name} />

      <ShopHeader
        name={shop.name}
        logoUrl={shop.logoUrl}
        locationLabel={shop.locationLabel}
        status={shop.status}
        isTrustedSeller={shop.isTrustedSeller}
        memberSinceLabel={shop.memberSinceLabel}
        messengerLink={shop.messengerLink}
        reviewCount={shop.reviewCount}
        averageRating={shop.averageRating}
        completedOrderCount={shop.completedOrderCount}
        activeListingCount={shop.activeListingCount}
      />

      {featuredListing && (
        <div className="mt-8">
          <ShopFeaturedListing listing={featuredListing} />
        </div>
      )}

      <div className="mt-8">
        <h2 className="text-lg font-semibold text-ink">Listings</h2>
        <div className="mt-2">
          <ShopListingsClient
            initialListings={listingsResult.listings}
            initialHadError={listingsResult.hadError}
            initialCursor={listingsResult.nextCursor}
            loadMore={loadMoreAction}
          />
        </div>
      </div>

      <div className="mt-8">
        <ShopDescription description={shop.description} />
      </div>
    </div>
  );
}
