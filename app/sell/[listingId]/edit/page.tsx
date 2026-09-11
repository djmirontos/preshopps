import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth/session";
import { getMyListing } from "@/lib/seller/get-my-listing";
import { getCategories, getProvinces, getCitiesForProvince, getBarangaysForCity, type LocationRef } from "@/lib/marketplace/reference-data";
import { type ListingFieldValues } from "@/components/seller/ListingForm";
import { ListingFormWithPublish } from "@/components/seller/ListingFormWithPublish";
import { ListingImagesPicker } from "@/components/seller/ListingImagesPicker";
import { vehicleFieldValuesFromServer, rentalFieldValuesFromServer } from "@/components/listings/listing-field-mappers";
import { getListingImageUrl } from "@/lib/marketplace/listing-image-url";

export const metadata = { title: "Edit Draft | Preshopps" };

type PageProps = {
  params: Promise<{ listingId: string }>;
};

/**
 * Real edit-listing page, replacing the prior static placeholder.
 * get_my_listing (0063) already scopes every row to the caller's own shop
 * server-side and raises LISTING_NOT_FOUND/NOT_LISTING_OWNER/SHOP_NOT_FOUND
 * for anything else -- getMyListing (lib/seller/get-my-listing.ts) collapses
 * all three into the same "not_found" result, mirroring
 * getMyShopOrderDetail's own established privacy pattern, so a listing id
 * belonging to another seller (or a nonexistent one) is never
 * distinguishable from the outside.
 *
 * Only Draft listings are editable through update_listing today (it is
 * Draft-only by design -- see 0059's own header). A non-draft listing is
 * therefore shown a clear not-editable state here rather than silently
 * rendering a form whose Save Draft would just fail -- post-publish editing
 * (PRD 29.1) is a deliberately deferred, separate future task.
 */
export default async function SellListingEditPage({ params }: PageProps) {
  const { listingId } = await params;
  const user = await getAuthUser();

  if (!user) {
    redirect(`/sign-in?next=${encodeURIComponent(`/sell/${listingId}/edit`)}`);
  }

  const result = await getMyListing(listingId);

  if (result.status === "not_found") {
    notFound();
  }

  if (result.status === "error") {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center sm:px-6 lg:px-8">
        <p className="text-sm text-ink-secondary">Unable to load this listing right now.</p>
      </div>
    );
  }

  const { listing } = result;

  if (listing.status !== "draft") {
    return (
      <div className="mx-auto max-w-sm px-4 py-10 sm:py-16">
        <div className="rounded-[14px] border border-border bg-surface p-6 text-center sm:p-8">
          <h1 className="text-xl font-bold text-ink">This listing isn&rsquo;t editable here</h1>
          <p className="mt-3 text-sm text-ink-secondary">Only Draft listings can be edited right now. Editing published listings is coming soon.</p>
          <Link
            href={`/item/${listing.publicCode}`}
            className="mt-6 inline-flex h-11 items-center justify-center rounded-[10px] border border-border px-5 text-sm font-semibold text-ink hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            View listing
          </Link>
        </div>
      </div>
    );
  }

  const [categories, provinces, initialCities, initialBarangays] = await Promise.all([
    getCategories(),
    getProvinces(),
    listing.provinceId !== null ? getCitiesForProvince(listing.provinceId) : Promise.resolve([] as LocationRef[]),
    listing.barangayId !== null ? getBarangaysForCity(listing.cityId as number) : Promise.resolve([] as LocationRef[]),
  ]);

  async function loadCitiesAction(provinceId: number): Promise<LocationRef[]> {
    "use server";
    return getCitiesForProvince(provinceId);
  }

  async function loadBarangaysAction(cityId: number): Promise<LocationRef[]> {
    "use server";
    return getBarangaysForCity(cityId);
  }

  const initialValues: ListingFieldValues = {
    title: listing.title,
    description: listing.description,
    categoryId: listing.categoryId,
    listingType: listing.listingType,
    condition: listing.condition,
    priceCents: listing.priceCents,
    originalPriceCents: listing.originalPriceCents,
    isNegotiable: listing.isNegotiable,
    brand: listing.brand,
    knownFlaws: listing.knownFlaws,
    stockQuantity: listing.stockQuantity,
    meetupNote: listing.meetupNote,
    fulfillmentMethods: listing.fulfillmentMethods,
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:px-6 lg:px-8">
      <h1 className="text-xl font-bold text-ink lg:text-2xl">Edit Draft</h1>
      <p className="mt-1 text-sm text-ink-secondary">Only a title is required -- fill in the rest whenever you&rsquo;re ready.</p>

      <div className="mt-6">
        <ListingImagesPicker
          listingId={listing.listingId}
          ownerUserId={user.id}
          listingType={listing.listingType}
          initialImages={listing.images.map((image) => ({
            id: image.id,
            storagePath: image.storagePath,
            position: image.position,
            isReferenceImage: image.isReferenceImage,
            url: getListingImageUrl(image.storagePath) ?? "",
          }))}
        />
      </div>

      <div className="mt-8">
        <ListingFormWithPublish
          listingId={listing.listingId}
          listingStatus={listing.status}
          categories={categories}
          provinces={provinces}
          initialCities={initialCities}
          initialBarangays={initialBarangays}
          loadCities={loadCitiesAction}
          loadBarangays={loadBarangaysAction}
          initialLocation={{ provinceId: listing.provinceId, cityId: listing.cityId, barangayId: listing.barangayId }}
          initialValues={initialValues}
          initialVehicleDetails={vehicleFieldValuesFromServer(listing.vehicleDetails)}
          initialRentalDetails={rentalFieldValuesFromServer(listing.rentalDetails)}
        />
      </div>
    </div>
  );
}
