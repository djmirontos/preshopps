import { ListingCard, type ListingCardData } from "@/components/marketplace/ListingCard";

type Props = {
  listing: ListingCardData;
};

/**
 * Renders the shop's one featured listing using the unmodified
 * ListingCard -- no second listing-detail query: the featured id is
 * matched against the shop's own already-fetched listings page (see
 * app/shop/[slug]/page.tsx), so this never triggers an extra RPC call.
 * ListingCard's own width utilities are sized for the homepage rail, so
 * (same trick as ListingGrid) they're overridden here to fill this
 * fixed-width single-card wrapper instead.
 */
export function ShopFeaturedListing({ listing }: Props) {
  return (
    <div>
      <h2 className="text-lg font-semibold text-ink">Featured</h2>
      <div className="mt-2 w-[44%] max-w-[200px] sm:w-[30%] lg:w-48 [&>div]:!w-full">
        <ListingCard listing={listing} />
      </div>
    </div>
  );
}
