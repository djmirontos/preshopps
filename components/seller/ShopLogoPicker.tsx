"use client";

import { useRef, useState } from "react";
import { ImagePlus, Loader2, RotateCcw, Store, X } from "lucide-react";
import { uploadImage, deleteUploadedImage, UPLOAD_IMAGE_ERROR_MESSAGES, type UploadImageErrorCode } from "@/lib/image-processing/upload-image";

/** Fixed folder label under the owner's own storage prefix -- one shop per
 * account means there is never more than one logo per owner, so no
 * shop-id segment is needed at all: `shop-images/{ownerId}/logo/{file}`.
 * This is what lets logo upload work identically in create mode (before
 * the shop row exists) and edit mode -- the path never depends on a shop
 * id that might not exist yet. */
const LOGO_ENTITY = "logo";

type Slot =
  | { kind: "empty" }
  | { kind: "existing"; path: string; url: string }
  | { kind: "new"; file: File; previewUrl: string; status: "compressing" | "uploading" | "uploaded" | "error"; path?: string; errorCode?: UploadImageErrorCode };

type Props = {
  ownerId: string;
  initialPath: string | null;
  initialUrl: string | undefined;
  onPathChange: (path: string | null) => void;
  onUploadingChange: (isUploading: boolean) => void;
};

function readyPath(slot: Slot): string | null {
  if (slot.kind === "existing") return slot.path;
  if (slot.kind === "new" && slot.status === "uploaded") return slot.path ?? null;
  return null;
}

function isUploading(slot: Slot): boolean {
  return slot.kind === "new" && (slot.status === "compressing" || slot.status === "uploading");
}

/**
 * A single shop logo -- immediate upload on selection, replace-in-place
 * (selecting a new image while one exists swaps it, it is never a second
 * image), Retry + Remove on failure, matching the same upload UX already
 * established by ReviewImagePicker. The circular preview here uses
 * object-cover rather than ReviewImagePicker's object-contain: this
 * matches how a shop logo is already displayed everywhere else in this
 * app (ShopHeader's and ListingSellerCard's circular avatar, both
 * object-cover) -- changing that established display convention would be
 * an unrelated redesign. The underlying stored file itself is never
 * cropped (compressImage only ever uniformly scales, per PRD S11.3); only
 * this on-screen circular preview crops for display, exactly like the
 * public pages that will end up rendering the same file.
 */
export function ShopLogoPicker({ ownerId, initialPath, initialUrl, onPathChange, onUploadingChange }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [slot, setSlot] = useState<Slot>(() =>
    initialPath ? { kind: "existing", path: initialPath, url: initialUrl ?? "" } : { kind: "empty" },
  );

  function updateSlot(next: Slot) {
    setSlot(next);
    onPathChange(readyPath(next));
    onUploadingChange(isUploading(next));
  }

  async function startUpload(file: File) {
    const result = await uploadImage("shop-images", ownerId, LOGO_ENTITY, file, (status) => {
      setSlot((prev) => (prev.kind === "new" && prev.file === file ? { ...prev, status } : prev));
    });

    setSlot((prev) => {
      if (prev.kind !== "new" || prev.file !== file) return prev;
      const next: Slot = result.ok ? { ...prev, status: "uploaded", path: result.path } : { ...prev, status: "error", errorCode: result.code };
      onPathChange(readyPath(next));
      onUploadingChange(isUploading(next));
      return next;
    });
  }

  function handleFileSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    // Replacing a session upload that hasn't been saved yet: best-effort
    // delete it immediately (it was never persisted to the shop row) --
    // mirrors ReviewImagePicker's own remove-before-replace cleanup.
    if (slot.kind === "new" && slot.status === "uploaded" && slot.path) {
      void deleteUploadedImage(slot.path);
    }

    updateSlot({ kind: "new", file, previewUrl: URL.createObjectURL(file), status: "compressing" });
    void startUpload(file);
  }

  function handleRetry() {
    if (slot.kind !== "new") return;
    const file = slot.file;
    updateSlot({ ...slot, status: "compressing", errorCode: undefined });
    void startUpload(file);
  }

  function handleRemove() {
    // A previously-persisted logo is never deleted here -- only after the
    // shop mutation that confirms its removal succeeds (handled by
    // ShopForm, mirroring ReviewFormClient's own post-success cleanup).
    if (slot.kind === "new" && slot.status === "uploaded" && slot.path) {
      void deleteUploadedImage(slot.path);
    }
    updateSlot({ kind: "empty" });
  }

  const previewUrl = slot.kind === "existing" ? slot.url : slot.kind === "new" ? slot.previewUrl : undefined;
  const isBusy = isUploading(slot);
  const isError = slot.kind === "new" && slot.status === "error";

  return (
    <div>
      <p className="text-sm font-medium text-ink">
        Logo <span className="font-normal text-ink-muted">(optional)</span>
      </p>
      <div className="mt-2 flex items-center gap-3">
        <div className="relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-canvas">
          {previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- local blob preview / already-uploaded logo, see ReviewImagePicker for the same reasoning
            <img src={previewUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <Store className="h-7 w-7 text-ink-muted" aria-hidden="true" />
          )}

          {isBusy && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/30">
              <Loader2 className="h-5 w-5 animate-spin text-white" aria-hidden="true" />
              <span className="sr-only">{slot.kind === "new" && slot.status === "compressing" ? "Processing logo…" : "Uploading logo…"}</span>
            </div>
          )}

          {isError && (
            <button
              type="button"
              onClick={handleRetry}
              className="absolute inset-0 flex flex-col items-center justify-center gap-1 rounded-full bg-black/60 text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              <span className="text-[10px] font-semibold">Retry</span>
            </button>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="inline-flex h-9 items-center gap-1.5 rounded-[10px] border border-border px-3 text-sm font-medium text-ink hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <ImagePlus className="h-4 w-4" aria-hidden="true" />
            {slot.kind === "empty" ? "Add logo" : "Replace"}
          </button>
          {slot.kind !== "empty" && (
            <button
              type="button"
              onClick={handleRemove}
              className="inline-flex h-9 items-center gap-1.5 rounded-[10px] px-3 text-sm font-medium text-ink-secondary hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              <X className="h-4 w-4" aria-hidden="true" />
              Remove
            </button>
          )}
        </div>

        <input ref={inputRef} type="file" accept="image/*" onChange={handleFileSelected} className="sr-only" aria-label="Upload shop logo" />
      </div>

      {isError && (
        <p className="mt-1.5 text-xs text-danger">{UPLOAD_IMAGE_ERROR_MESSAGES[(slot as { errorCode?: UploadImageErrorCode }).errorCode as UploadImageErrorCode]}</p>
      )}
    </div>
  );
}
