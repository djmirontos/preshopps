"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, ImagePlus, Loader2, RotateCcw, Star, X } from "lucide-react";
import { ShopLocationFields, type ShopLocationValue } from "@/components/seller/ShopLocationFields";
import {
  getPublishedListingEditState,
  updatePublishedListing,
  UPDATE_PUBLISHED_LISTING_ERROR_MESSAGES,
  type PublishedListingEditState,
  type PublishedListingPatch,
  type PublishedListingImages,
} from "@/lib/seller/published-listing-actions";
import { parsePesosToCents, centsToPesosInput } from "@/lib/seller/price-cents";
import { LISTING_TYPE_LABELS, CONDITION_LABELS, FULFILLMENT_LABELS, type FulfillmentMethod } from "@/lib/marketplace/search-params";
import type { CategoryRef, LocationRef } from "@/lib/marketplace/reference-data";
import { getListingImageUrl } from "@/lib/marketplace/listing-image-url";
import { uploadImage, UPLOAD_IMAGE_ERROR_MESSAGES, type UploadImageErrorCode } from "@/lib/image-processing/upload-image";
import {
  ListingVehicleFields,
  isVehicleValuesEmpty,
  vehicleValuesEqual,
  validateVehicleValues,
  buildVehicleDetailsJson,
  vehicleFieldValuesFromServer,
  type VehicleFieldValues,
} from "@/components/seller/ListingVehicleFields";
import {
  ListingRentalFields,
  isRentalValuesEmpty,
  rentalValuesEqual,
  validateRentalValues,
  buildRentalDetailsJson,
  rentalFieldValuesFromServer,
  type RentalFieldValues,
} from "@/components/seller/ListingRentalFields";

const INPUT_CLASS =
  "mt-1.5 h-11 w-full rounded-[10px] border border-border bg-surface px-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-60";
const TEXTAREA_CLASS =
  "mt-1.5 w-full rounded-[10px] border border-border bg-surface p-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand";

const FULFILLMENT_METHODS = Object.keys(FULFILLMENT_LABELS) as FulfillmentMethod[];
const MAX_IMAGES = 8;

type FieldErrors = {
  title?: string;
  price?: string;
  originalPrice?: string;
  quantity?: string;
  gallery?: string;
};

function fulfillmentSetsEqual(a: FulfillmentMethod[], b: FulfillmentMethod[]): boolean {
  return a.length === b.length && a.every((method) => b.includes(method));
}

/** Raw, form-shaped values derived from a fresh server state -- the single
 * place both this component's initial mount and every later
 * "replace the form with the server's truth" moment (a successful save,
 * or an explicit Reload latest) go through, so those two moments can never
 * drift into different prefill logic. */
function fieldValuesFromServerState(state: PublishedListingEditState) {
  return {
    title: state.title,
    description: state.description ?? "",
    brand: state.brand ?? "",
    knownFlaws: state.knownFlaws ?? "",
    priceInput: centsToPesosInput(state.priceCents),
    originalPriceInput: centsToPesosInput(state.originalPriceCents),
    isNegotiable: state.isNegotiable,
    quantityInput: String(state.availableQuantity),
    location: { provinceId: state.provinceId, cityId: state.cityId, barangayId: state.barangayId } as ShopLocationValue,
    fulfillmentMethods: state.fulfillmentMethods,
    meetupNote: state.meetupNote ?? "",
    vehicleValues: vehicleFieldValuesFromServer(state.vehicleDetails),
    rentalValues: rentalFieldValuesFromServer(state.rentalDetails),
  };
}

// ============================================================
// Gallery slot model -- deliberately mirrors ListingImagesPicker's own
// ExistingSlot/NewSlot/Slot shapes (ListingImagesPicker.tsx) rather than
// inventing a second image model, with one structural difference: `isCover`
// is tracked explicitly per slot here, because update_published_listing's
// own p_images contract (0094) requires an explicit `is_cover: true` on
// exactly one entry regardless of array position -- unlike Draft's
// replace_listing_images, which has no cover concept at all and treats
// array position 0 as the cover by construction. Reorder and "which one is
// cover" are therefore independent operations here, matching this task's
// own explicit "Set as cover" control instead of an implicit position rule.
// ============================================================

type ExistingImageSlot = { kind: "existing"; id: string; path: string; url: string; isReferenceImage: boolean; isCover: boolean };
type NewImageSlot = {
  kind: "new";
  localId: string;
  file: File;
  previewUrl: string;
  status: "compressing" | "uploading" | "uploaded" | "error";
  path?: string;
  errorCode?: UploadImageErrorCode;
  isReferenceImage: boolean;
  isCover: boolean;
};
type ImageSlot = ExistingImageSlot | NewImageSlot;

function readyImagePath(slot: ImageSlot): string | null {
  if (slot.kind === "existing") return slot.path;
  if (slot.kind === "new" && slot.status === "uploaded") return slot.path ?? null;
  return null;
}

function isImageUploading(slot: ImageSlot): boolean {
  return slot.kind === "new" && (slot.status === "compressing" || slot.status === "uploading");
}

/** Server images arrive already ordered by position (get_my_listing's own
 * `order by li.position asc`, embedded in get_published_listing_edit_state) --
 * this only re-shapes them into editable slots, never re-sorts. */
function slotsFromServerState(state: PublishedListingEditState): ImageSlot[] {
  return state.images.map((image) => ({
    kind: "existing" as const,
    id: image.id,
    path: image.storagePath,
    url: getListingImageUrl(image.storagePath) ?? "",
    isReferenceImage: image.isReferenceImage,
    isCover: image.id === state.coverImageId,
  }));
}

/** The exact update_published_listing p_images shape (published-listing-
 * actions.ts's own PublishedListingImageEntry), built from every "ready"
 * slot (an existing photo, or a new upload that finished) in its current
 * order -- array order IS the position update_published_listing assigns
 * server-side; there is no separate position field to compute. An in-
 * flight or failed upload is never included, so it can never leak into a
 * save payload regardless of whether it is still visible on screen. */
function buildImagesPayload(slots: ImageSlot[]): PublishedListingImages {
  return slots.reduce<PublishedListingImages>((entries, slot) => {
    if (slot.kind === "existing") {
      entries.push({ image_id: slot.id, is_reference_image: slot.isReferenceImage, is_cover: slot.isCover });
    } else if (slot.status === "uploaded" && slot.path) {
      entries.push({ storage_path: slot.path, is_reference_image: slot.isReferenceImage, is_cover: slot.isCover });
    }
    return entries;
  }, []);
}

/** The same payload shape, but derived from the server's own last-known
 * gallery (state.images + state.coverImageId) -- the baseline a live
 * gallery is diffed against to decide whether `images` stays `null`
 * ("unchanged") or must be sent as a complete array. */
function baselineImagesPayload(state: PublishedListingEditState): PublishedListingImages {
  return state.images.map((image) => ({
    image_id: image.id,
    is_reference_image: image.isReferenceImage,
    is_cover: image.id === state.coverImageId,
  }));
}

type Props = {
  listingId: string;
  ownerUserId: string;
  initialState: PublishedListingEditState;
  categories: CategoryRef[];
  provinces: LocationRef[];
  initialCities: LocationRef[];
  initialBarangays: LocationRef[];
  loadCities: (provinceId: number) => Promise<LocationRef[]>;
  loadBarangays: (cityId: number) => Promise<LocationRef[]>;
};

/**
 * Real editor for a published (Available/Paused) listing's fields AND
 * gallery, seeded from getPublishedListingEditState (0094) and saved
 * through updatePublishedListing. Deliberately a separate component from
 * ListingForm rather than a published-mode branch inside it: the two forms
 * diff against a different baseline shape (PublishedListingEditState vs
 * get_my_listing's MyListing/ListingFieldValues), save through different
 * RPCs with different patch contracts and a revision precondition, and
 * share no save/Publish button at all -- forcing them into one component
 * would mean threading that divergence through every field instead of
 * keeping it contained here.
 *
 * category_id/listing_type/condition are immutable once published (0094's
 * own v_protected list) and are rendered as a plain read-only summary,
 * never a disabled control.
 *
 * `serverState` is this component's only source of truth for "what the
 * server currently has" (including `revision`, never parsed as a number --
 * see published-listing-actions.ts's own header comment). Every editable
 * field (and the gallery -- see imageSlots below) also has a live,
 * controlled value; a Save diffs live values against serverState to build
 * the smallest patch, exactly like ListingForm's own baseline-diff
 * convention. A successful save and an explicit Reload latest both funnel
 * through applyServerState, which replaces serverState AND every live
 * field AND the gallery from the fresh response/read in one step -- there
 * is no path that updates one without the others, which is what keeps a
 * resolved stale conflict from ever silently rebasing old local edits (text
 * or gallery) onto a new revision.
 *
 * Gallery editing intentionally does NOT persist immediately the way
 * Draft's ListingImagesPicker does (every Draft mutation calls
 * replace_listing_images on the spot). Every add/remove/reorder/set-cover/
 * reference-toggle here only ever touches local `imageSlots` state; the
 * complete resulting gallery is sent to updatePublishedListing's `images`
 * argument only when the seller presses Save changes, atomically with any
 * text-field patch -- there is exactly one authoritative published save
 * call, matching this task's own architecture requirement. Removing an
 * image only ever removes it from local gallery state: this module never
 * calls deleteUploadedImage or any Storage delete/update for a published
 * listing, even for a brand-new upload that is added and then removed
 * again before ever being saved -- unlike Draft's picker, which does clean
 * up that specific case. A newly-uploaded, never-saved Storage object can
 * therefore become an orphan if the seller uploads then leaves without
 * saving; this is an accepted, temporary tradeoff (see this task's own
 * "later media/storage hardening" note), not a bug to fix here.
 */
export function PublishedListingEditor({
  listingId,
  ownerUserId,
  initialState,
  categories,
  provinces,
  initialCities,
  initialBarangays,
  loadCities,
  loadBarangays,
}: Props) {
  const router = useRouter();
  const titleErrorId = useId();
  const priceErrorId = useId();
  const originalPriceErrorId = useId();
  const quantityHintId = useId();
  const imageInputRef = useRef<HTMLInputElement>(null);

  const [serverState, setServerState] = useState<PublishedListingEditState>(initialState);

  const initialValues = fieldValuesFromServerState(initialState);
  const [title, setTitle] = useState(initialValues.title);
  const [description, setDescription] = useState(initialValues.description);
  const [brand, setBrand] = useState(initialValues.brand);
  const [knownFlaws, setKnownFlaws] = useState(initialValues.knownFlaws);
  const [priceInput, setPriceInput] = useState(initialValues.priceInput);
  const [originalPriceInput, setOriginalPriceInput] = useState(initialValues.originalPriceInput);
  const [isNegotiable, setIsNegotiable] = useState(initialValues.isNegotiable);
  const [quantityInput, setQuantityInput] = useState(initialValues.quantityInput);
  const [location, setLocation] = useState<ShopLocationValue>(initialValues.location);
  const [fulfillmentMethods, setFulfillmentMethods] = useState<FulfillmentMethod[]>(initialValues.fulfillmentMethods);
  const [meetupNote, setMeetupNote] = useState(initialValues.meetupNote);
  const [vehicleValues, setVehicleValues] = useState<VehicleFieldValues>(initialValues.vehicleValues);
  const [rentalValues, setRentalValues] = useState<RentalFieldValues>(initialValues.rentalValues);

  const [imageSlots, setImageSlotsState] = useState<ImageSlot[]>(() => slotsFromServerState(initialState));
  const imageSlotsRef = useRef<ImageSlot[]>(imageSlots);
  function setImageSlots(next: ImageSlot[]) {
    imageSlotsRef.current = next;
    setImageSlotsState(next);
  }

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [vehicleErrors, setVehicleErrors] = useState<ReturnType<typeof validateVehicleValues>>({});
  const [rentalErrors, setRentalErrors] = useState<ReturnType<typeof validateRentalValues>>({});

  const [saveStatus, setSaveStatus] = useState<"idle" | "saved" | "no_changes">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveErrorCode, setSaveErrorCode] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [staleConflict, setStaleConflict] = useState(false);
  const [isReloading, setIsReloading] = useState(false);

  const selectedCategory = categories.find((category) => category.id === serverState.categoryId);
  const categorySlug = selectedCategory?.slug ?? null;
  const isVehicleCategory = categorySlug === "cars" || categorySlug === "motorcycles";
  const isRentalCategory = categorySlug === "for-rent";

  const minQuantity = serverState.status === "available" ? 1 : 0;

  const listingTypeLabel = serverState.listingType ? LISTING_TYPE_LABELS[serverState.listingType] : "Not set";
  const conditionLabel =
    serverState.listingType === "brand_new"
      ? "Brand New"
      : serverState.condition && serverState.condition !== "brand_new"
        ? CONDITION_LABELS[serverState.condition]
        : "Not set";

  const canAddMorePhotos = imageSlots.length < MAX_IMAGES;
  const allowReferenceToggle = serverState.listingType === "brand_new";
  const referenceImagesWhilePreloved = serverState.listingType === "preloved" && imageSlots.some((slot) => slot.isReferenceImage);
  const anyImageUploading = imageSlots.some(isImageUploading);
  const galleryBusy = isSaving || anyImageUploading;

  /** Single funnel for "replace everything with the server's current truth"
   * -- used after a successful save and after an explicit Reload latest.
   * See this component's own header comment for why both must go through
   * exactly this function. Resets the gallery too, so Reload latest always
   * discards pending gallery edits together with pending text edits --
   * never one without the other. */
  function applyServerState(next: PublishedListingEditState) {
    setServerState(next);
    const values = fieldValuesFromServerState(next);
    setTitle(values.title);
    setDescription(values.description);
    setBrand(values.brand);
    setKnownFlaws(values.knownFlaws);
    setPriceInput(values.priceInput);
    setOriginalPriceInput(values.originalPriceInput);
    setIsNegotiable(values.isNegotiable);
    setQuantityInput(values.quantityInput);
    setLocation(values.location);
    setFulfillmentMethods(values.fulfillmentMethods);
    setMeetupNote(values.meetupNote);
    setVehicleValues(values.vehicleValues);
    setRentalValues(values.rentalValues);
    setImageSlots(slotsFromServerState(next));
    setFieldErrors({});
    setVehicleErrors({});
    setRentalErrors({});
  }

  function toggleFulfillmentMethod(method: FulfillmentMethod) {
    setFulfillmentMethods((prev) => (prev.includes(method) ? prev.filter((m) => m !== method) : [...prev, method]));
  }

  // ===== gallery mutations -- local state only, never an RPC call. See this
  // component's own header comment for why gallery edits never persist
  // until Save changes. =====

  function handleAddPhotoClick() {
    if (!canAddMorePhotos || galleryBusy) return;
    imageInputRef.current?.click();
  }

  function handleFileSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !canAddMorePhotos) return;

    const localId = crypto.randomUUID();
    const newSlot: NewImageSlot = {
      kind: "new",
      localId,
      file,
      previewUrl: URL.createObjectURL(file),
      status: "compressing",
      isReferenceImage: false,
      // The very first photo ever added to an empty gallery becomes the
      // cover automatically (there is otherwise no cover at all, which
      // update_published_listing would reject) -- every later upload
      // defaults to not-cover, exactly like an existing photo would.
      isCover: imageSlotsRef.current.length === 0,
    };
    setImageSlots([...imageSlotsRef.current, newSlot]);
    void startImageUpload(localId, file);
  }

  async function startImageUpload(localId: string, file: File) {
    const result = await uploadImage("listing-images", ownerUserId, listingId, file, (status) => {
      setImageSlots(imageSlotsRef.current.map((slot) => (slot.kind === "new" && slot.localId === localId ? { ...slot, status } : slot)));
    });

    setImageSlots(
      imageSlotsRef.current.map((slot) => {
        if (slot.kind !== "new" || slot.localId !== localId) return slot;
        return result.ok ? { ...slot, status: "uploaded", path: result.path } : { ...slot, status: "error", errorCode: result.code };
      }),
    );
  }

  function handleRetryImage(slot: NewImageSlot) {
    setImageSlots(
      imageSlotsRef.current.map((s) => (s.kind === "new" && s.localId === slot.localId ? { ...s, status: "compressing", errorCode: undefined } : s)),
    );
    void startImageUpload(slot.localId, slot.file);
  }

  function handleRemoveImage(slot: ImageSlot) {
    if (galleryBusy) return;
    const remaining = imageSlotsRef.current.filter((s) => s !== slot);
    // Never leave the gallery with zero cover images just because the
    // seller removed whichever photo happened to be marked as cover --
    // update_published_listing requires exactly one is_cover:true whenever
    // images are sent at all, so the next remaining photo (if any) takes
    // over automatically.
    if (slot.isCover && remaining.length > 0 && !remaining.some((s) => s.isCover)) {
      remaining[0] = { ...remaining[0], isCover: true };
    }
    setImageSlots(remaining);
  }

  function handleMoveImage(index: number, direction: -1 | 1) {
    if (galleryBusy) return;
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= imageSlotsRef.current.length) return;

    const next = [...imageSlotsRef.current];
    [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
    setImageSlots(next);
  }

  function handleSetCover(slot: ImageSlot) {
    if (galleryBusy) return;
    setImageSlots(imageSlotsRef.current.map((s) => ({ ...s, isCover: s === slot })));
  }

  function handleToggleImageReference(slot: ImageSlot) {
    if (galleryBusy || !allowReferenceToggle) return;
    setImageSlots(imageSlotsRef.current.map((s) => (s === slot ? { ...s, isReferenceImage: !s.isReferenceImage } : s)));
  }

  function buildPatch(): PublishedListingPatch {
    const patch: PublishedListingPatch = {};

    const trimmedTitle = title.trim();
    if (trimmedTitle !== serverState.title) patch.title = trimmedTitle;

    const trimmedDescription = description.trim().length > 0 ? description.trim() : null;
    if (trimmedDescription !== serverState.description) patch.description = trimmedDescription;

    const trimmedBrand = brand.trim().length > 0 ? brand.trim() : null;
    if (trimmedBrand !== serverState.brand) patch.brand = trimmedBrand;

    const trimmedKnownFlaws = knownFlaws.trim().length > 0 ? knownFlaws.trim() : null;
    if (trimmedKnownFlaws !== serverState.knownFlaws) patch.known_flaws = trimmedKnownFlaws;

    const priceResult = parsePesosToCents(priceInput);
    if (priceResult.ok && priceResult.cents !== serverState.priceCents) patch.price_cents = priceResult.cents;

    const originalPriceResult = parsePesosToCents(originalPriceInput);
    if (originalPriceResult.ok && originalPriceResult.cents !== serverState.originalPriceCents) {
      patch.original_price_cents = originalPriceResult.cents;
    }

    if (isNegotiable !== serverState.isNegotiable) patch.is_negotiable = isNegotiable;

    if (location.provinceId !== serverState.provinceId) patch.province_id = location.provinceId;
    if (location.cityId !== serverState.cityId) patch.city_id = location.cityId;
    if (location.barangayId !== serverState.barangayId) patch.barangay_id = location.barangayId;

    if (!fulfillmentSetsEqual(fulfillmentMethods, serverState.fulfillmentMethods)) {
      patch.fulfillment_methods = fulfillmentMethods;
    }

    const trimmedMeetupNote = fulfillmentMethods.includes("meetup") && meetupNote.trim().length > 0 ? meetupNote.trim() : null;
    if (trimmedMeetupNote !== serverState.meetupNote) patch.meetup_note = trimmedMeetupNote;

    if (isVehicleCategory) {
      const vehicleEmpty = isVehicleValuesEmpty(vehicleValues);
      const serverVehicleBaseline = vehicleFieldValuesFromServer(serverState.vehicleDetails);
      const serverVehicleEmpty = serverState.vehicleDetails === null;
      if (vehicleEmpty && !serverVehicleEmpty) {
        patch.vehicle_details = null;
      } else if (!vehicleEmpty && (serverVehicleEmpty || !vehicleValuesEqual(vehicleValues, serverVehicleBaseline))) {
        patch.vehicle_details = buildVehicleDetailsJson(vehicleValues);
      }
    }

    if (isRentalCategory) {
      const rentalEmpty = isRentalValuesEmpty(rentalValues);
      const serverRentalBaseline = rentalFieldValuesFromServer(serverState.rentalDetails);
      const serverRentalEmpty = serverState.rentalDetails === null;
      if (rentalEmpty && !serverRentalEmpty) {
        patch.rental_details = null;
      } else if (!rentalEmpty && (serverRentalEmpty || !rentalValuesEqual(rentalValues, serverRentalBaseline))) {
        patch.rental_details = buildRentalDetailsJson(rentalValues);
      }
    }

    if (serverState.quantityEditable) {
      const trimmedQuantity = quantityInput.trim();
      const quantityValue = trimmedQuantity === "" ? null : Number(trimmedQuantity);
      if (quantityValue !== null && Number.isInteger(quantityValue) && quantityValue !== serverState.availableQuantity) {
        patch.available_quantity = quantityValue;
      }
    }

    return patch;
  }

  /** `null` means "gallery unchanged" (per updatePublishedListing's own
   * contract, never an empty array for that). Compares the current ready
   * gallery against the server's own last-known gallery -- order, cover,
   * and reference flags all count as a change, not just membership. */
  function buildImagesArg(): PublishedListingImages | null {
    const current = buildImagesPayload(imageSlotsRef.current);
    const baseline = baselineImagesPayload(serverState);
    return JSON.stringify(current) === JSON.stringify(baseline) ? null : current;
  }

  async function handleSave() {
    setSaveError(null);
    setSaveErrorCode(null);
    setSaveStatus("idle");

    const errors: FieldErrors = {};
    if (title.trim().length === 0) {
      errors.title = "Please enter a title for your listing.";
    }

    const priceResult = parsePesosToCents(priceInput);
    if (!priceResult.ok) {
      errors.price = "Please enter a valid price.";
    }

    const originalPriceResult = parsePesosToCents(originalPriceInput);
    if (!originalPriceResult.ok) {
      errors.originalPrice = "Please enter a valid original price.";
    }

    if (
      priceResult.ok &&
      originalPriceResult.ok &&
      priceResult.cents !== null &&
      originalPriceResult.cents !== null &&
      originalPriceResult.cents < priceResult.cents
    ) {
      errors.originalPrice = "Original price must not be lower than the current price.";
    }

    if (serverState.quantityEditable) {
      const trimmedQuantity = quantityInput.trim();
      const quantityValue = trimmedQuantity === "" ? null : Number(trimmedQuantity);
      if (quantityValue === null || !Number.isInteger(quantityValue) || quantityValue < minQuantity) {
        errors.quantity = `Available quantity must be at least ${minQuantity}.`;
      }
    }

    if (anyImageUploading) {
      errors.gallery = "Please wait for your photos to finish uploading before saving.";
    } else {
      const readyImages = imageSlotsRef.current.filter((slot) => readyImagePath(slot) !== null);
      if (readyImages.length === 0) {
        errors.gallery = "Add at least one photo before saving.";
      } else if (readyImages.length > MAX_IMAGES) {
        errors.gallery = "A listing may have at most 8 photos.";
      } else if (serverState.listingType === "preloved" && readyImages.some((slot) => slot.isReferenceImage)) {
        errors.gallery =
          "Pre-loved listings may only include actual-item photos. Remove or replace the reference/catalog photos in the Photos section.";
      } else if (serverState.listingType === "brand_new" && readyImages.every((slot) => slot.isReferenceImage)) {
        errors.gallery = "Brand New listings need at least one actual-item photo. Mark a photo as Actual in the Photos section.";
      }
    }

    const nextVehicleErrors = isVehicleCategory ? validateVehicleValues(vehicleValues) : {};
    const nextRentalErrors = isRentalCategory ? validateRentalValues(rentalValues) : {};
    setVehicleErrors(nextVehicleErrors);
    setRentalErrors(nextRentalErrors);
    setFieldErrors(errors);

    if (Object.keys(errors).length > 0 || Object.keys(nextVehicleErrors).length > 0 || Object.keys(nextRentalErrors).length > 0) {
      return;
    }

    const patch = buildPatch();
    const imagesArg = buildImagesArg();
    if (Object.keys(patch).length === 0 && imagesArg === null) {
      setSaveStatus("no_changes");
      return;
    }

    setIsSaving(true);
    const result = await updatePublishedListing(listingId, serverState.revision, patch, imagesArg);
    setIsSaving(false);

    if (result.outcome === "stale_revision") {
      setStaleConflict(true);
      return;
    }

    if (result.outcome === "failed") {
      setSaveErrorCode(result.code);
      setSaveError(UPDATE_PUBLISHED_LISTING_ERROR_MESSAGES[result.code]);
      return;
    }

    applyServerState(result.listing);
    setSaveStatus(result.changed ? "saved" : "no_changes");
  }

  async function handleReloadLatest() {
    setIsReloading(true);
    const result = await getPublishedListingEditState(listingId);
    setIsReloading(false);

    if (result.status === "found") {
      applyServerState(result.listing);
      setStaleConflict(false);
      setSaveError(null);
      setSaveErrorCode(null);
      setSaveStatus("idle");
      return;
    }

    // The listing moved to a state this editor no longer covers (e.g. it
    // became Reserved/Sold/Archived, or is no longer the caller's own) --
    // never guessed at here; a full route refresh lets the Server Component
    // route re-derive and render whichever state is now actually correct.
    router.refresh();
  }

  const firstImageUploadError = imageSlots.find((slot): slot is NewImageSlot => slot.kind === "new" && slot.status === "error");

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:px-6 lg:px-8">
      <h1 className="text-xl font-bold text-ink lg:text-2xl">Edit Listing</h1>
      <p className="mt-1 text-sm text-ink-secondary">Status: {serverState.status === "available" ? "Available" : "Paused"}</p>

      {staleConflict && (
        <div role="alert" className="mt-6 rounded-[14px] border border-danger/40 bg-danger/5 p-4">
          <p className="text-sm font-medium text-ink">This listing changed elsewhere. Reload the latest version before saving.</p>
          <p className="mt-1 text-xs text-ink-secondary">Reloading will discard your unsaved changes here, including any photo changes.</p>
          <button
            type="button"
            onClick={() => void handleReloadLatest()}
            disabled={isReloading}
            className="mt-3 h-9 rounded-[10px] border border-border px-4 text-sm font-semibold text-ink hover:bg-canvas disabled:opacity-60"
          >
            {isReloading ? "Reloading…" : "Reload latest"}
          </button>
        </div>
      )}

      <div className="mt-6 space-y-8">
        <section>
          <div className="space-y-3">
            <div>
              <label htmlFor="published-title" className="text-sm font-medium text-ink">
                Title
              </label>
              <input
                id="published-title"
                type="text"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                aria-describedby={titleErrorId}
                aria-invalid={Boolean(fieldErrors.title)}
                className={INPUT_CLASS}
              />
              {fieldErrors.title && (
                <p id={titleErrorId} className="mt-1 text-xs text-danger">
                  {fieldErrors.title}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="published-description" className="text-sm font-medium text-ink">
                Description
              </label>
              <textarea
                id="published-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={4}
                className={TEXTAREA_CLASS}
              />
            </div>

            <div>
              <label htmlFor="published-brand" className="text-sm font-medium text-ink">
                Brand <span className="font-normal text-ink-muted">(optional)</span>
              </label>
              <input
                id="published-brand"
                type="text"
                value={brand}
                onChange={(event) => setBrand(event.target.value)}
                className={INPUT_CLASS}
              />
            </div>
          </div>
        </section>

        <section>
          <h2 className="text-sm font-semibold text-ink">Category &amp; type</h2>
          <p className="mt-1 text-xs text-ink-muted">These can&rsquo;t be changed after publishing.</p>
          <dl className="mt-3 grid grid-cols-1 gap-3 rounded-[10px] border border-border bg-canvas p-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs text-ink-muted">Category</dt>
              <dd className="font-medium text-ink">{selectedCategory?.name ?? "Not set"}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-muted">Listing type</dt>
              <dd className="font-medium text-ink">{listingTypeLabel}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-muted">Condition</dt>
              <dd className="font-medium text-ink">{conditionLabel}</dd>
            </div>
          </dl>

          {serverState.condition === "fair" && (
            <div className="mt-3">
              <label htmlFor="published-known-flaws" className="text-sm font-medium text-ink">
                Known flaws
              </label>
              <textarea
                id="published-known-flaws"
                value={knownFlaws}
                onChange={(event) => setKnownFlaws(event.target.value)}
                rows={3}
                className={TEXTAREA_CLASS}
              />
            </div>
          )}
        </section>

        {isVehicleCategory && (
          <section>
            <h2 className="text-sm font-semibold text-ink">Vehicle details</h2>
            <div className="mt-3">
              <ListingVehicleFields value={vehicleValues} onChange={setVehicleValues} errors={vehicleErrors} />
            </div>
          </section>
        )}

        {isRentalCategory && (
          <section>
            <h2 className="text-sm font-semibold text-ink">Rental details</h2>
            <div className="mt-3">
              <ListingRentalFields value={rentalValues} onChange={setRentalValues} errors={rentalErrors} />
            </div>
          </section>
        )}

        <section>
          <div className="space-y-3">
            <div>
              <label htmlFor="published-price" className="text-sm font-medium text-ink">
                Price
              </label>
              <div className="mt-1.5 flex items-center rounded-[10px] border border-border bg-surface pl-3 focus-within:ring-2 focus-within:ring-brand">
                <span className="text-sm text-ink-muted">₱</span>
                <input
                  id="published-price"
                  type="text"
                  inputMode="decimal"
                  value={priceInput}
                  onChange={(event) => setPriceInput(event.target.value)}
                  aria-describedby={priceErrorId}
                  aria-invalid={Boolean(fieldErrors.price)}
                  className="h-11 w-full bg-transparent px-2 text-sm text-ink focus-visible:outline-none"
                />
              </div>
              {fieldErrors.price && (
                <p id={priceErrorId} className="mt-1 text-xs text-danger">
                  {fieldErrors.price}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="published-original-price" className="text-sm font-medium text-ink">
                Original price <span className="font-normal text-ink-muted">(optional)</span>
              </label>
              <div className="mt-1.5 flex items-center rounded-[10px] border border-border bg-surface pl-3 focus-within:ring-2 focus-within:ring-brand">
                <span className="text-sm text-ink-muted">₱</span>
                <input
                  id="published-original-price"
                  type="text"
                  inputMode="decimal"
                  value={originalPriceInput}
                  onChange={(event) => setOriginalPriceInput(event.target.value)}
                  aria-describedby={originalPriceErrorId}
                  aria-invalid={Boolean(fieldErrors.originalPrice)}
                  className="h-11 w-full bg-transparent px-2 text-sm text-ink focus-visible:outline-none"
                />
              </div>
              {fieldErrors.originalPrice && (
                <p id={originalPriceErrorId} className="mt-1 text-xs text-danger">
                  {fieldErrors.originalPrice}
                </p>
              )}
            </div>

            <label className="flex h-11 items-center gap-2 text-sm font-medium text-ink">
              <input
                type="checkbox"
                checked={isNegotiable}
                onChange={(event) => setIsNegotiable(event.target.checked)}
                className="h-4 w-4 rounded border-border text-brand-action focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              />
              Price is negotiable
            </label>

            <div>
              <label htmlFor="published-quantity" className="text-sm font-medium text-ink">
                Available quantity
              </label>
              <input
                id="published-quantity"
                type="text"
                inputMode="numeric"
                value={quantityInput}
                onChange={(event) => setQuantityInput(event.target.value)}
                disabled={!serverState.quantityEditable}
                aria-describedby={quantityHintId}
                aria-invalid={Boolean(fieldErrors.quantity)}
                className={INPUT_CLASS}
              />
              <p id={quantityHintId} className="mt-1 text-xs text-ink-muted">
                {serverState.quantityEditable
                  ? `Minimum ${minQuantity} while ${serverState.status === "available" ? "Available" : "Paused"}.`
                  : "This can't be changed right now -- stock is currently reserved by an order."}
              </p>
              {fieldErrors.quantity && <p className="mt-1 text-xs text-danger">{fieldErrors.quantity}</p>}
            </div>
          </div>
        </section>

        <section>
          <h2 className="text-sm font-semibold text-ink">Location</h2>
          <div className="mt-3">
            <ShopLocationFields
              provinces={provinces}
              initialCities={initialCities}
              initialBarangays={initialBarangays}
              initialValue={location}
              loadCities={loadCities}
              loadBarangays={loadBarangays}
              onChange={setLocation}
            />
          </div>
        </section>

        <section>
          <h2 className="text-sm font-semibold text-ink">Fulfillment</h2>
          <div className="mt-3 space-y-2">
            {FULFILLMENT_METHODS.map((method) => (
              <label key={method} className="flex h-11 items-center gap-2 text-sm font-medium text-ink">
                <input
                  type="checkbox"
                  checked={fulfillmentMethods.includes(method)}
                  onChange={() => toggleFulfillmentMethod(method)}
                  className="h-4 w-4 rounded border-border text-brand-action focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                />
                {FULFILLMENT_LABELS[method]}
              </label>
            ))}
          </div>

          {fulfillmentMethods.includes("meetup") && (
            <div className="mt-3">
              <label htmlFor="published-meetup-note" className="text-sm font-medium text-ink">
                Meetup note <span className="font-normal text-ink-muted">(optional)</span>
              </label>
              <textarea
                id="published-meetup-note"
                value={meetupNote}
                onChange={(event) => setMeetupNote(event.target.value)}
                rows={2}
                className={TEXTAREA_CLASS}
              />
            </div>
          )}
        </section>

        <section>
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-ink">Photos</p>
            <p className="text-xs text-ink-muted">
              {imageSlots.length} of {MAX_IMAGES} photos
            </p>
          </div>

          {referenceImagesWhilePreloved && (
            <p className="mt-1.5 text-xs text-danger">
              This listing has reference/catalog photos, but Pre-loved listings must use actual-item photos only. Remove or replace them before
              saving.
            </p>
          )}

          <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
            {imageSlots.map((slot, index) => {
              const previewUrl = slot.kind === "existing" ? slot.url : slot.previewUrl;
              const busySlot = isImageUploading(slot);
              const isError = slot.kind === "new" && slot.status === "error";
              const key = slot.kind === "existing" ? slot.id : slot.localId;

              return (
                <div key={key} className="relative aspect-square overflow-hidden rounded-[10px] border border-border bg-canvas">
                  {previewUrl && (
                    // Local blob previews and already-uploaded photos both
                    // render here -- same reasoning as ListingImagesPicker's
                    // own plain <img>, a client-generated blob: URL fits
                    // neither next/image's remote loader nor a static import.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={previewUrl} alt="" className="h-full w-full object-contain" />
                  )}

                  {slot.isCover && !busySlot && (
                    <span className="absolute left-1 top-1 rounded-full bg-brand-navy/90 px-2 py-0.5 text-[10px] font-semibold text-white">
                      Cover
                    </span>
                  )}

                  {slot.isReferenceImage && (
                    <span className="absolute right-1 top-1 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-semibold text-white">
                      Reference
                    </span>
                  )}

                  {busySlot && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                      <Loader2 className="h-5 w-5 animate-spin text-white" aria-hidden="true" />
                      <span className="sr-only">{slot.kind === "new" && slot.status === "compressing" ? "Compressing…" : "Uploading…"}</span>
                    </div>
                  )}

                  {isError && (
                    <button
                      type="button"
                      onClick={() => handleRetryImage(slot as NewImageSlot)}
                      className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/60 text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                    >
                      <RotateCcw className="h-4 w-4" aria-hidden="true" />
                      <span className="text-[10px] font-semibold">Retry</span>
                    </button>
                  )}

                  {!busySlot && !isError && (
                    <div className="absolute inset-x-0 bottom-0 flex flex-col gap-0.5 bg-black/60 px-1 py-1">
                      <div className="flex items-center justify-between gap-0.5">
                        <button
                          type="button"
                          onClick={() => handleMoveImage(index, -1)}
                          disabled={galleryBusy || index === 0}
                          aria-label={`Move image ${index + 1} left`}
                          className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-30"
                        >
                          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                        </button>

                        <button
                          type="button"
                          onClick={() => handleSetCover(slot)}
                          disabled={galleryBusy || slot.isCover}
                          aria-pressed={slot.isCover}
                          aria-label={`Set image ${index + 1} as cover`}
                          className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-30"
                        >
                          <Star className="h-4 w-4" aria-hidden="true" fill={slot.isCover ? "currentColor" : "none"} />
                        </button>

                        <button
                          type="button"
                          onClick={() => handleRemoveImage(slot)}
                          disabled={galleryBusy}
                          aria-label={`Remove image ${index + 1}`}
                          className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-30"
                        >
                          <X className="h-4 w-4" aria-hidden="true" />
                        </button>

                        <button
                          type="button"
                          onClick={() => handleMoveImage(index, 1)}
                          disabled={galleryBusy || index === imageSlots.length - 1}
                          aria-label={`Move image ${index + 1} right`}
                          className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-30"
                        >
                          <ArrowRight className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </div>

                      {allowReferenceToggle && (
                        <button
                          type="button"
                          onClick={() => handleToggleImageReference(slot)}
                          disabled={galleryBusy}
                          aria-pressed={slot.isReferenceImage}
                          aria-label={`Mark image ${index + 1} as ${slot.isReferenceImage ? "actual item" : "reference"}`}
                          className="h-6 shrink-0 rounded text-center text-[9px] font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-30"
                        >
                          {slot.isReferenceImage ? "Actual" : "Reference"}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {canAddMorePhotos && (
              <>
                <button
                  type="button"
                  onClick={handleAddPhotoClick}
                  disabled={galleryBusy}
                  className="flex aspect-square flex-col items-center justify-center gap-1 rounded-[10px] border border-dashed border-border text-ink-muted hover:border-brand-link hover:text-brand-link focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50"
                >
                  <ImagePlus className="h-5 w-5" aria-hidden="true" />
                  <span className="text-[10px] font-medium">Add photo</span>
                </button>
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleFileSelected}
                  className="sr-only"
                  aria-label="Add a listing photo"
                />
              </>
            )}
          </div>

          {firstImageUploadError && (
            <p className="mt-2 text-xs text-danger">{UPLOAD_IMAGE_ERROR_MESSAGES[firstImageUploadError.errorCode as UploadImageErrorCode]}</p>
          )}
          {fieldErrors.gallery && <p className="mt-2 text-xs text-danger">{fieldErrors.gallery}</p>}
        </section>

        {saveErrorCode === "LISTING_NOT_EDITABLE" ? (
          <div>
            <p className="text-sm text-danger">{saveError}</p>
            <button
              type="button"
              onClick={() => router.refresh()}
              className="mt-2 h-9 rounded-[10px] border border-border px-4 text-sm font-semibold text-ink hover:bg-canvas"
            >
              Reload page
            </button>
          </div>
        ) : (
          saveError && <p className="text-sm text-danger">{saveError}</p>
        )}
        {saveStatus === "saved" && <p className="text-sm text-success">Saved</p>}
        {saveStatus === "no_changes" && <p className="text-sm text-ink-muted">No changes to save</p>}

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={isSaving || staleConflict || anyImageUploading}
            className="h-11 w-full rounded-[10px] bg-brand-action px-5 text-sm font-semibold text-brand-action-text hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:opacity-60 sm:w-auto"
          >
            {isSaving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
