import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth/session";
import { getMyListing, type MyListingStatus } from "@/lib/seller/get-my-listing";
import { getPublishedListingEditState } from "@/lib/seller/published-listing-actions";
import { getCategories, getProvinces, getCitiesForProvince, getBarangaysForCity, type LocationRef } from "@/lib/marketplace/reference-data";
import { type ListingFieldValues } from "@/components/seller/ListingForm";
import { ListingFormWithPublish } from "@/components/seller/ListingFormWithPublish";
import { ListingImagesPicker } from "@/components/seller/ListingImagesPicker";
import { vehicleFieldValuesFromServer, rentalFieldValuesFromServer } from "@/components/listings/listing-field-mappers";
import { getListingImageUrl } from "@/lib/marketplace/listing-image-url";

export const metadata = { title: "Edit Listing | Preshopps" };

type PageProps = {
  params: Promise<{ listingId: string }>;
};

const NOT_EDITABLE_STATUS_LABELS: Partial<Record<MyListingStatus, string>> = {
  reserved: "Reserved",
  sold: "Sold",
  archived: "Archived",
};

/** Matches get_listing_detail's own visibility (0036) exactly -- Available/
 * Reserved/Sold/Archived remain reachable by direct URL, Draft/Paused do
 * not (confirmed directly against the live migration: `l.status in
 * ('available', 'reserved', 'sold', 'archived')`). Same rule, same
 * comment convention, as SellerListingsListClient's own canViewPublicly --
 * duplicated here rather than imported across the client/server boundary,
 * since it is a one-line pure check, not shared stateful logic. */
function canViewPublicly(status: MyListingStatus): boolean {
  return status === "available" || status === "reserved" || status === "sold" || status === "archived";
}

/** Shared "couldn't load, nothing else to say" state -- reused wherever a
 * loader outcome must stay privacy-safe (no existence/ownership signal, no
 * raw backend message) and there is no more specific, still-safe thing to
 * show instead. */
function UnableToLoad() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-16 text-center sm:px-6 lg:px-8">
      <p className="text-sm text-ink-secondary">Unable to load this listing right now.</p>
    </div>
  );
}

/** Read-only state for Reserved/Sold/Archived, and for the (expected-rare)
 * race where a listing moves out of Available/Paused between this page's
 * own getMyListing read and the published-edit loader's own status check --
 * get_published_listing_edit_state's LISTING_NOT_EDITABLE falls back here
 * rather than a generic error, since by that point ownership/existence are
 * already confirmed and there is a real, specific thing to say. */
function NotEditable({ title, status, publicCode }: { title: string; status: MyListingStatus; publicCode: string }) {
  const label = NOT_EDITABLE_STATUS_LABELS[status];
  return (
    <div className="mx-auto max-w-sm px-4 py-10 sm:py-16">
      <div className="rounded-[14px] border border-border bg-surface p-6 text-center sm:p-8">
        <h1 className="text-xl font-bold text-ink">This listing isn&rsquo;t editable right now</h1>
        <p className="mt-3 text-sm font-semibold text-ink">{title}</p>
        {label && <p className="mt-1 text-xs font-medium text-ink-muted">Status: {label}</p>}
        <p className="mt-3 text-sm text-ink-secondary">
          {status === "reserved"
            ? "This listing is reserved by an active order and can't be edited right now."
            : "This listing can't be edited in its current status."}
        </p>
        <div className="mt-6 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <Link
            href="/sell"
            className="inline-flex h-11 items-center justify-center rounded-[10px] border border-border px-5 text-sm font-semibold text-ink hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            Back to my listings
          </Link>
          {canViewPublicly(status) && (
            <Link
              href={`/item/${publicCode}`}
              className="inline-flex h-11 items-center justify-center rounded-[10px] border border-border px-5 text-sm font-semibold text-ink hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              View listing
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Temporary published-edit placeholder -- a route-integration checkpoint
 * only (this task's own instruction), not the real editor. Proves the
 * correct 0094 RPC loaded (get_published_listing_edit_state, via
 * getPublishedListingEditState) and that its response reached this render:
 * title and status come straight from that response, not from the earlier
 * getMyListing read. Deliberately does not render `revision` -- there is no
 * seller-facing use for the raw number yet, and this task's own instruction
 * prefers verifying it lands correctly via a test over surfacing it in UI
 * (see PublishedListingEditPlaceholder.test coverage instead). No Save, no
 * Publish, no editable inputs -- those are later, separate steps.
 */
function PublishedListingEditPlaceholder({ title, status }: { title: string; status: "available" | "paused" }) {
  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:px-6 lg:px-8">
      <h1 className="text-xl font-bold text-ink lg:text-2xl">Published listing editing</h1>
      <div className="mt-6 rounded-[14px] border border-border bg-surface p-6">
        <p className="text-sm font-semibold text-ink">{title}</p>
        <p className="mt-1 text-xs font-medium text-ink-muted">Status: {status === "available" ? "Available" : "Paused"}</p>
        <p className="mt-4 text-sm text-ink-secondary">Published editing is being prepared.</p>
      </div>
    </div>
  );
}

/**
 * Real edit-listing page. getMyListing (get_my_listing, 0063) applies no
 * status restriction at all -- confirmed via its own live definition, it is
 * "deliberately reusable for any status the caller owns" -- so one call
 * already tells this page everything it needs to route correctly: it scopes
 * every row to the caller's own shop server-side and collapses
 * LISTING_NOT_FOUND/NOT_LISTING_OWNER/SHOP_NOT_FOUND into the same
 * "not_found" result (getMyListing's own established privacy pattern), so a
 * listing id belonging to another seller, or one that doesn't exist, is
 * never distinguishable from the outside. No second "what status is this"
 * probe RPC is introduced -- get_published_listing_edit_state is only ever
 * called once this page already knows (from getMyListing) that the listing
 * is the caller's own and is Available/Paused.
 *
 * Draft: unchanged -- update_listing/publish_listing remain Draft-only by
 * design (0059's own header), so Draft keeps its full existing editor here
 * verbatim. Available/Paused: routes into the new 0094 published-edit RPC
 * via getPublishedListingEditState, currently rendering only a temporary
 * placeholder (this step's own scope) -- the real editable form, save flow,
 * gallery editing, and stale-revision UX are later, separate steps.
 * Reserved/Sold/Archived: a read-only state; get_published_listing_edit_state
 * is never called for these -- 0094's own function would just reject them
 * with LISTING_NOT_EDITABLE, and getMyListing's status already tells this
 * page the same thing for free.
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
    return <UnableToLoad />;
  }

  const { listing } = result;

  if (listing.status === "reserved" || listing.status === "sold" || listing.status === "archived") {
    return <NotEditable title={listing.title} status={listing.status} publicCode={listing.publicCode} />;
  }

  if (listing.status === "available" || listing.status === "paused") {
    const publishedResult = await getPublishedListingEditState(listing.listingId);

    if (publishedResult.status === "not_editable") {
      // Rare race: status moved out of Available/Paused between the two
      // reads above (e.g. a concurrent order acceptance) -- this page does
      // not actually know the listing's new status, so it is not guessed
      // at; NotEditable's own fallback copy covers an unlabeled status.
      // Ownership and existence are already confirmed by this point, so
      // this falls back to the same read-only state a genuinely
      // Reserved/Sold/Archived listing gets, never a generic load error.
      return <NotEditable title={listing.title} status={listing.status} publicCode={listing.publicCode} />;
    }

    if (publishedResult.status !== "found") {
      return <UnableToLoad />;
    }

    return <PublishedListingEditPlaceholder title={publishedResult.listing.title} status={listing.status} />;
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
