"use client";

import { useState } from "react";
import { ListingForm, type ListingFieldValues } from "@/components/seller/ListingForm";
import { PublishListingButton } from "@/components/seller/PublishListingButton";
import type { VehicleFieldValues } from "@/components/seller/ListingVehicleFields";
import type { RentalFieldValues } from "@/components/seller/ListingRentalFields";
import type { ShopLocationValue } from "@/components/seller/ShopLocationFields";
import type { CategoryRef, LocationRef } from "@/lib/marketplace/reference-data";
import type { MyListingStatus } from "@/lib/seller/get-my-listing";

type Props = {
  listingId: string;
  listingStatus: MyListingStatus;
  categories: CategoryRef[];
  provinces: LocationRef[];
  initialCities: LocationRef[];
  initialBarangays: LocationRef[];
  loadCities: (provinceId: number) => Promise<LocationRef[]>;
  loadBarangays: (cityId: number) => Promise<LocationRef[]>;
  initialLocation: ShopLocationValue;
  initialValues: ListingFieldValues;
  initialVehicleDetails: VehicleFieldValues;
  initialRentalDetails: RentalFieldValues;
};

/**
 * Thin client wrapper joining ListingForm's Save Draft with the separate
 * Publish action on the edit-listing page. Save Draft (update_listing) and
 * Publish (publish_listing) are two independent RPCs with different
 * semantics -- a partial patch vs a strict, authoritative completeness
 * boundary -- and stay separate actions/components per this task's own
 * canon. The only thing bridged between them is a single `isDirty`
 * boolean (ListingForm -> here -> PublishListingButton), the smallest
 * signal needed to stop Publish from silently publishing stale server
 * data while the seller has unsaved changes -- not a broader shared-state
 * overhaul.
 */
export function ListingFormWithPublish({ listingId, listingStatus, ...formProps }: Props) {
  const [isDirty, setIsDirty] = useState(false);

  return (
    <div className="space-y-4">
      <ListingForm mode="edit" listingId={listingId} {...formProps} onDirtyChange={setIsDirty} />
      <PublishListingButton listingId={listingId} status={listingStatus} isDirty={isDirty} />
    </div>
  );
}
