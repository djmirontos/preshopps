"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, ImagePlus, Loader2, RotateCcw, X } from "lucide-react";
import { uploadImage, deleteUploadedImage, UPLOAD_IMAGE_ERROR_MESSAGES, type UploadImageErrorCode } from "@/lib/image-processing/upload-image";
import { replaceListingImages, REPLACE_LISTING_IMAGES_ERROR_MESSAGES } from "@/lib/seller/listing-actions";
import type { ListingTypeFilter } from "@/lib/marketplace/search-params";

const MAX_IMAGES = 8;

/** Same shape as MyListingImage (lib/seller/get-my-listing.ts) plus a
 * pre-resolved display `url` -- resolving storage_path -> a public URL is
 * the page/data-fetching layer's job (getListingImageUrl), exactly like
 * ShopLogoPicker's initialUrl and ReviewImagePicker's initialUrls; this
 * component never calls getListingImageUrl itself. */
export type ListingImageWithUrl = {
  id: string;
  storagePath: string;
  position: number;
  isReferenceImage: boolean;
  url: string;
};

type ExistingSlot = { kind: "existing"; id: string; path: string; url: string; isReferenceImage: boolean };
type NewSlot = {
  kind: "new";
  localId: string;
  file: File;
  previewUrl: string;
  status: "compressing" | "uploading" | "uploaded" | "error";
  path?: string;
  errorCode?: UploadImageErrorCode;
  isReferenceImage: boolean;
};
type Slot = ExistingSlot | NewSlot;

type Props = {
  /** Null on the initial Create Listing page before any draft exists yet --
   * see `ensureListingId` below, the only case that ever needs to tolerate
   * this. The edit page always passes a real id here (unchanged; that path
   * never calls ensureListingId at all). */
  listingId: string | null;
  ownerUserId: string;
  /** Current listing type, sourced from the page (the same get_my_listing
   * read that prefills ListingForm) -- if the seller changes listing type
   * in ListingForm, that change is only reflected here once Save Draft
   * reloads the page (see this component's own header comment for why a
   * live cross-component wire was not built in this slice). */
  listingType: ListingTypeFilter | null;
  initialImages: ListingImageWithUrl[];
  /** Create-page only. Called the first time this picker needs a real
   * listing id and `listingId` is still null (i.e. the very first photo
   * the seller adds) -- resolves to a freshly, minimally auto-created
   * draft. Mirrors ListingForm's own identically-shaped `ensureListingId`
   * prop: both point at the SAME shared, de-duplicated function on the
   * orchestrating parent, so whichever of "add a photo" or "click Save
   * Draft" happens first is the only one that ever actually creates the
   * draft. Never called once `listingId` is already non-null (the edit
   * page never passes this at all). A null return means creation failed;
   * the attempted upload is then treated exactly like any other failure. */
  ensureListingId?: () => Promise<string | null>;
  /** Optional. Fires whenever the current, already-persisted set of photos
   * (committed existing images plus any new upload that has finished --
   * never an in-flight or failed one) starts or stops matching
   * publish_listing's own image-completeness rules: 1-8 total, no
   * reference images at all for Pre-loved, and at least one actual
   * (non-reference) image for Brand New. Lets an orchestrating parent
   * combine this with ListingForm's own onPublishReadyChange signal into a
   * single "can Publish now" gate, without waiting for a Save Draft/page
   * reload round trip. */
  onPhotosReadyChange?: (ready: boolean) => void;
};

function readyPath(slot: Slot): string | null {
  if (slot.kind === "existing") return slot.path;
  if (slot.kind === "new" && slot.status === "uploaded") return slot.path ?? null;
  return null;
}

function isUploading(slot: Slot): boolean {
  return slot.kind === "new" && (slot.status === "compressing" || slot.status === "uploading");
}

function toInitialSlots(images: ListingImageWithUrl[]): Slot[] {
  return [...images]
    .sort((a, b) => a.position - b.position)
    .map((image) => ({
      kind: "existing" as const,
      id: image.id,
      path: image.storagePath,
      url: image.url,
      isReferenceImage: image.isReferenceImage,
    }));
}

/**
 * Draft photo management for the edit-listing page -- 0-8 photos, add/
 * remove/reorder (Move Left/Move Right, no drag dependency), and an
 * Actual/Reference toggle for Brand New listings. Every mutation (add,
 * remove, reorder, toggle) immediately persists the COMPLETE resulting
 * ordered set via replace_listing_images -- the seller never needs to
 * click the separate textual "Save Draft" button just to manage photos,
 * per this task's own instruction. Deliberately kept as its own component
 * rather than folded into ListingForm's field-diff logic: that logic
 * tracks a single baseline/current pair for the textual fields and only
 * ever calls update_listing on explicit submit, which is the wrong shape
 * for "persist immediately, independently, per photo action."
 *
 * Cross-component wiring note (reported per this task's own instruction,
 * not solved by adding coupling): `listingType` is passed down once from
 * the page's own get_my_listing read, not from ListingForm's live client
 * state. If a seller changes listing type in ListingForm without yet
 * clicking Save Draft, this picker will not know about that change until
 * the next full page load (e.g. after Save Draft succeeds and the page
 * re-fetches, or a manual refresh) -- wiring ListingForm's live
 * listingType into this sibling component would require lifting listing
 * type state up to the page or introducing a shared context, which is a
 * broader refactor than this focused images slice warrants. The practical
 * impact is narrow: a seller who changes type to Brand New and immediately
 * (before saving) tries to mark a freshly-uploaded photo as Reference
 * simply won't see the toggle yet, and must Save Draft first -- backend
 * validation (publish, once built) remains authoritative regardless.
 *
 * Storage cleanup: mirrors ShopForm's own established "delete the old
 * object only after the replacing mutation confirms success" pattern,
 * generalized from one logo path to an ordered set. `committedPaths`
 * tracks the last successfully persisted set; after every successful
 * replace_listing_images call, any previously-committed path no longer in
 * the new set is best-effort deleted. A brand-new upload that is removed
 * before ever being included in a successful persist (e.g. the seller
 * uploads, then immediately removes it) is deleted immediately instead,
 * since nothing could possibly reference it yet -- mirroring
 * ReviewImagePicker's identical "new + uploaded, not yet committed" case.
 * Known limitation, reported rather than worked around: if the
 * replace_listing_images call itself succeeds but this best-effort
 * deleteUploadedImage call fails or the tab closes before it runs, the old
 * object becomes an orphan in storage -- the same accepted risk already
 * documented for ShopForm's logo cleanup; no stronger guarantee exists
 * anywhere else in this codebase either.
 *
 * Create-page reuse (auto-draft on first photo): this same component (no
 * parallel image-upload implementation) is also mounted on the initial
 * Create Listing page, before any listing exists at all. There, `listingId`
 * starts null and `ensureListingId` is provided; the first upload attempt
 * calls it to silently create a minimal draft (see ListingForm's identical
 * `ensureListingId` prop and CreateListingWorkspace, which owns and
 * de-duplicates the actual creation) and reuses the id for every action
 * from then on. The edit page is completely unaffected: it always passes a
 * real `listingId` and no `ensureListingId`, so resolveListingId's fast
 * path (return the already-known id) is the only path it ever takes.
 */
export function ListingImagesPicker({
  listingId,
  ownerUserId,
  listingType,
  initialImages,
  ensureListingId,
  onPhotosReadyChange,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [slots, setSlotsState] = useState<Slot[]>(() => toInitialSlots(initialImages));
  const slotsRef = useRef<Slot[]>(slots);
  const [committedPaths, setCommittedPaths] = useState<string[]>(() => initialImages.map((image) => image.storagePath));
  const [isPersisting, setIsPersisting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Own local cache of the resolved id, separate from the `listingId` prop:
  // once ensureListingId() resolves (or the edit page's own non-null prop
  // seeds it immediately via this initializer), every later action keeps
  // using it directly without waiting for the orchestrating parent's own
  // state update/re-render to flow the id back down as a prop. Nothing
  // else ever needs to re-sync this from the `listingId` prop: on the edit
  // page it is a stable, always-non-null string from the very first render
  // (this initializer is the only assignment it ever needs); on the create
  // page it starts null and is set exactly once, by resolveListingId
  // itself, the instant ensureListingId resolves -- strictly before the
  // orchestrating parent's own re-render could ever update this prop.
  const resolvedListingIdRef = useRef<string | null>(listingId);

  function setSlots(next: Slot[]) {
    slotsRef.current = next;
    setSlotsState(next);
  }

  /** Returns the real listing id to act against, creating a minimal draft
   * via ensureListingId on first use if none exists yet. Idempotent within
   * this component -- once resolved, later calls return the cached value
   * immediately without calling ensureListingId again (the orchestrating
   * parent's own de-duplication additionally protects against a concurrent
   * caller, e.g. ListingForm's own Save Draft, from ever creating a second
   * draft even across components). */
  async function resolveListingId(): Promise<string | null> {
    if (resolvedListingIdRef.current) return resolvedListingIdRef.current;
    if (!ensureListingId) return null;
    const id = await ensureListingId();
    if (id) resolvedListingIdRef.current = id;
    return id;
  }

  const anyUploading = slots.some(isUploading);
  const isBusy = isPersisting || anyUploading;
  const canAddMore = slots.length < MAX_IMAGES;
  const allowReferenceToggle = listingType === "brand_new";
  const referenceImagesWhilePreloved = listingType === "preloved" && slots.some((slot) => slot.isReferenceImage);

  // ===== live "would publish_listing accept these photos" signal =====
  // Mirrors publish_listing's own image-completeness rules exactly (1-8
  // total, no reference images for Pre-loved, at least one actual image
  // for Brand New) -- counted only over slots that are actually ready to
  // be published (already-committed existing images, or a brand-new
  // upload that has finished uploading), never an in-flight or failed one,
  // since those aren't part of what would actually be persisted yet.
  const readySlots = slots.filter((slot) => readyPath(slot) !== null);
  const readyTotal = readySlots.length;
  const readyActualCount = readySlots.filter((slot) => !slot.isReferenceImage).length;
  const photosReady =
    readyTotal >= 1 &&
    readyTotal <= MAX_IMAGES &&
    !(listingType === "preloved" && readyTotal !== readyActualCount) &&
    !(listingType === "brand_new" && readyActualCount === 0);

  useEffect(() => {
    onPhotosReadyChange?.(photosReady);
  }, [photosReady, onPhotosReadyChange]);

  async function persist(nextSlots: Slot[]): Promise<boolean> {
    setIsPersisting(true);
    setSubmitError(null);

    const readySlots = nextSlots.filter((slot) => readyPath(slot) !== null);
    const paths = readySlots.map((slot) => readyPath(slot) as string);
    const flags = readySlots.map((slot) => slot.isReferenceImage);

    // persist is only ever reached once a listing id is known: either the
    // edit page's own non-null prop (seeded above), or a successful
    // resolveListingId() call inside startUpload for the very first photo
    // on the create page -- reorder/remove/toggle can only act on a slot
    // that already exists, which itself required a prior successful upload.
    const result = await replaceListingImages(resolvedListingIdRef.current as string, paths, flags);
    setIsPersisting(false);

    if (!result.ok) {
      setSubmitError(REPLACE_LISTING_IMAGES_ERROR_MESSAGES[result.code]);
      return false;
    }

    const nextPathSet = new Set(paths);
    for (const oldPath of committedPaths) {
      if (!nextPathSet.has(oldPath)) {
        void deleteUploadedImage(oldPath);
      }
    }
    setCommittedPaths(paths);
    return true;
  }

  async function applyMutation(nextSlots: Slot[]) {
    const previous = slotsRef.current;
    setSlots(nextSlots);
    const ok = await persist(nextSlots);
    if (!ok) {
      // Roll the visible UI back to the last known-good state -- a failed
      // persist must never leave the seller looking at an order/set that
      // isn't actually what the backend has. Any newly-uploaded file this
      // attempt would have added is now rolling out of view and was never
      // committed by the failed call, so it is about to become an orphan
      // -- best-effort delete it now rather than leaving it unreachable.
      const previousPaths = new Set(previous.map((slot) => readyPath(slot)).filter((path): path is string => path !== null));
      for (const slot of nextSlots) {
        const path = readyPath(slot);
        if (slot.kind === "new" && path && !previousPaths.has(path)) {
          void deleteUploadedImage(path);
        }
      }
      setSlots(previous);
    }
  }

  async function startUpload(localId: string, file: File) {
    const id = await resolveListingId();
    if (!id) {
      setSubmitError("Couldn't start your listing. Please try again.");
      setSlots(
        slotsRef.current.map((slot) =>
          slot.kind === "new" && slot.localId === localId ? { ...slot, status: "error", errorCode: "UPLOAD_FAILED" } : slot,
        ),
      );
      return;
    }

    const result = await uploadImage("listing-images", ownerUserId, id, file, (status) => {
      setSlots(slotsRef.current.map((slot) => (slot.kind === "new" && slot.localId === localId ? { ...slot, status } : slot)));
    });

    const settled = slotsRef.current.map((slot) => {
      if (slot.kind !== "new" || slot.localId !== localId) return slot;
      return result.ok
        ? ({ ...slot, status: "uploaded", path: result.path } as Slot)
        : ({ ...slot, status: "error", errorCode: result.code } as Slot);
    });

    if (result.ok) {
      // Goes straight through applyMutation rather than calling setSlots
      // here first -- applyMutation needs to capture the true pre-upload
      // state as its rollback baseline, which it can only do if slotsRef
      // still reflects "before this upload" when it starts.
      await applyMutation(settled);
    } else {
      setSlots(settled);
    }
  }

  function handleFileSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !canAddMore) return;

    const localId = crypto.randomUUID();
    const newSlot: NewSlot = {
      kind: "new",
      localId,
      file,
      previewUrl: URL.createObjectURL(file),
      status: "compressing",
      isReferenceImage: false,
    };
    setSlots([...slotsRef.current, newSlot]);
    void startUpload(localId, file);
  }

  function handleRetry(slot: NewSlot) {
    setSlots(
      slotsRef.current.map((s) => (s.kind === "new" && s.localId === slot.localId ? { ...s, status: "compressing", errorCode: undefined } : s)),
    );
    void startUpload(slot.localId, slot.file);
  }

  function handleRemove(slot: Slot) {
    if (isBusy) return;

    const path = readyPath(slot);
    const wasCommitted = path !== null && committedPaths.includes(path);
    const nextSlots = slotsRef.current.filter((s) => s !== slot);

    if (!wasCommitted && path) {
      // Never made it into a successful replace_listing_images call --
      // nothing references it, safe to delete right away.
      void deleteUploadedImage(path);
    }

    void applyMutation(nextSlots);
  }

  function handleMove(index: number, direction: -1 | 1) {
    if (isBusy) return;
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= slotsRef.current.length) return;

    const next = [...slotsRef.current];
    [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
    void applyMutation(next);
  }

  function handleToggleReference(slot: Slot) {
    if (isBusy || !allowReferenceToggle) return;
    const next = slotsRef.current.map((s) => (s === slot ? { ...s, isReferenceImage: !s.isReferenceImage } : s));
    void applyMutation(next);
  }

  const firstUploadError = slots.find((slot): slot is NewSlot => slot.kind === "new" && slot.status === "error");

  return (
    <div>
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-ink">Photos</p>
        <p className="text-xs text-ink-muted">
          {slots.length} of {MAX_IMAGES} photos
        </p>
      </div>

      {referenceImagesWhilePreloved && (
        <p className="mt-1.5 text-xs text-danger">
          This listing has reference/catalog photos, but Pre-loved listings must use actual-item photos only. Remove or replace them, or switch
          back to Brand New, before publishing.
        </p>
      )}

      <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
        {slots.map((slot, index) => {
          const previewUrl = slot.kind === "existing" ? slot.url : slot.previewUrl;
          const busySlot = isUploading(slot);
          const isError = slot.kind === "new" && slot.status === "error";
          const isCover = index === 0;
          const key = slot.kind === "existing" ? slot.id : slot.localId;

          return (
            <div key={key} className="relative aspect-square overflow-hidden rounded-[10px] border border-border bg-canvas">
              {previewUrl && (
                // Local blob previews and already-uploaded photos both
                // render here -- same reasoning as ReviewImagePicker's own
                // plain <img>, a client-generated blob: URL fits neither
                // next/image's remote loader nor a static import.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={previewUrl} alt="" className="h-full w-full object-contain" />
              )}

              {isCover && !busySlot && (
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
                  onClick={() => handleRetry(slot as NewSlot)}
                  className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/60 text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                >
                  <RotateCcw className="h-4 w-4" aria-hidden="true" />
                  <span className="text-[10px] font-semibold">Retry</span>
                </button>
              )}

              {!busySlot && !isError && (
                <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-0.5 bg-black/60 px-1 py-1">
                  <button
                    type="button"
                    onClick={() => handleMove(index, -1)}
                    disabled={isBusy || index === 0}
                    aria-label={`Move image ${index + 1} left`}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-30"
                  >
                    <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                  </button>

                  {allowReferenceToggle && (
                    <button
                      type="button"
                      onClick={() => handleToggleReference(slot)}
                      disabled={isBusy}
                      aria-pressed={slot.isReferenceImage}
                      aria-label={`Mark image ${index + 1} as ${slot.isReferenceImage ? "actual item" : "reference"}`}
                      className="flex h-7 shrink-0 items-center rounded px-1 text-[9px] font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-30"
                    >
                      {slot.isReferenceImage ? "Actual" : "Reference"}
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => handleRemove(slot)}
                    disabled={isBusy}
                    aria-label={`Remove image ${index + 1}`}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-30"
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>

                  <button
                    type="button"
                    onClick={() => handleMove(index, 1)}
                    disabled={isBusy || index === slots.length - 1}
                    aria-label={`Move image ${index + 1} right`}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-30"
                  >
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              )}
            </div>
          );
        })}

        {canAddMore && (
          <>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={isPersisting}
              className="flex aspect-square flex-col items-center justify-center gap-1 rounded-[10px] border border-dashed border-border text-ink-muted hover:border-brand-link hover:text-brand-link focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50"
            >
              <ImagePlus className="h-5 w-5" aria-hidden="true" />
              <span className="text-[10px] font-medium">Add photo</span>
            </button>
            <input ref={inputRef} type="file" accept="image/*" onChange={handleFileSelected} className="sr-only" aria-label="Add a listing photo" />
          </>
        )}
      </div>

      {firstUploadError && (
        <p className="mt-2 text-xs text-danger">{UPLOAD_IMAGE_ERROR_MESSAGES[firstUploadError.errorCode as UploadImageErrorCode]}</p>
      )}
      {submitError && <p className="mt-2 text-xs text-danger">{submitError}</p>}
    </div>
  );
}
