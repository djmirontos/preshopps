"use client";

import { useRef, useState } from "react";
import { ImagePlus, Loader2, RotateCcw, X } from "lucide-react";
import { uploadImage, deleteUploadedImage, UPLOAD_IMAGE_ERROR_MESSAGES, type UploadImageErrorCode } from "@/lib/image-processing/upload-image";

const MAX_IMAGES = 3;

type Slot = {
  localId: string;
  file: File;
  previewUrl: string;
  status: "compressing" | "uploading" | "uploaded" | "error";
  path?: string;
  errorCode?: UploadImageErrorCode;
};

type Props = {
  uploaderUserId: string;
  orderId: string;
  onPathsChange: (paths: string[]) => void;
  onUploadingChange: (isUploading: boolean) => void;
};

function readyPaths(slots: Slot[]): string[] {
  return slots.filter((slot) => slot.status === "uploaded" && slot.path).map((slot) => slot.path as string);
}

function isUploading(slots: Slot[]): boolean {
  return slots.some((slot) => slot.status === "compressing" || slot.status === "uploading");
}

/**
 * Up to 3 dispute evidence photos (PRD 34.2) -- create-only, no edit mode
 * (a dispute is never edited after creation), otherwise the same
 * immediate-upload-on-selection UX as ReviewImagePicker: selected image
 * shown right away, spinner overlay while processing/uploading, Retry +
 * Remove on failure. Uploads into the private dispute-images bucket
 * (0073) at dispute-images/{uploaderUserId}/{orderId}/{file} -- the
 * order id, not a dispute id, since no dispute row exists yet at upload
 * time (create_dispute takes already-uploaded paths as input, mirroring
 * ReviewImagePicker's own order_id-anchored path for the identical
 * reason).
 */
export function DisputeImagePicker({ uploaderUserId, orderId, onPathsChange, onUploadingChange }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [slots, setSlots] = useState<Slot[]>([]);

  function updateSlots(updater: (prev: Slot[]) => Slot[]) {
    setSlots((prev) => {
      const next = updater(prev);
      onPathsChange(readyPaths(next));
      onUploadingChange(isUploading(next));
      return next;
    });
  }

  async function startUpload(localId: string, file: File) {
    const result = await uploadImage("dispute-images", uploaderUserId, orderId, file, (status) => {
      updateSlots((prev) => prev.map((slot) => (slot.localId === localId ? { ...slot, status } : slot)));
    });

    updateSlots((prev) =>
      prev.map((slot) => {
        if (slot.localId !== localId) return slot;
        return result.ok ? { ...slot, status: "uploaded", path: result.path } : { ...slot, status: "error", errorCode: result.code };
      }),
    );
  }

  function handleFileSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    const localId = crypto.randomUUID();
    const newSlot: Slot = { localId, file, previewUrl: URL.createObjectURL(file), status: "compressing" };
    updateSlots((prev) => [...prev, newSlot]);
    void startUpload(localId, file);
  }

  function handleRetry(slot: Slot) {
    updateSlots((prev) => prev.map((s) => (s.localId === slot.localId ? { ...s, status: "compressing", errorCode: undefined } : s)));
    void startUpload(slot.localId, slot.file);
  }

  function handleRemove(slot: Slot) {
    if (slot.status === "uploaded" && slot.path) {
      void deleteUploadedImage(slot.path);
    }
    updateSlots((prev) => prev.filter((s) => s !== slot));
  }

  const canAddMore = slots.length < MAX_IMAGES;
  const firstError = slots.find((slot) => slot.status === "error");

  return (
    <div>
      <p className="text-sm font-medium text-ink">
        Photos <span className="font-normal text-ink-muted">(optional, up to {MAX_IMAGES})</span>
      </p>
      <div className="mt-2 flex gap-3">
        {slots.map((slot) => {
          const isBusy = slot.status === "compressing" || slot.status === "uploading";
          const isError = slot.status === "error";

          return (
            <div key={slot.localId} className="relative h-20 w-20 shrink-0 overflow-hidden rounded-[10px] border border-border bg-canvas">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={slot.previewUrl} alt="" className="h-full w-full object-contain" />

              {isBusy && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                  <Loader2 className="h-5 w-5 animate-spin text-white" aria-hidden="true" />
                  <span className="sr-only">{slot.status === "compressing" ? "Processing photo…" : "Uploading photo…"}</span>
                </div>
              )}

              {isError && (
                <button
                  type="button"
                  onClick={() => handleRetry(slot)}
                  className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/60 text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                >
                  <RotateCcw className="h-4 w-4" aria-hidden="true" />
                  <span className="text-[10px] font-semibold">Retry</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => handleRemove(slot)}
                aria-label="Remove photo"
                className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </div>
          );
        })}

        {canAddMore && (
          <>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="flex h-20 w-20 shrink-0 flex-col items-center justify-center gap-1 rounded-[10px] border border-dashed border-border text-ink-muted hover:border-brand-link hover:text-brand-link focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              <ImagePlus className="h-5 w-5" aria-hidden="true" />
              <span className="text-[10px] font-medium">Add photo</span>
            </button>
            <input ref={inputRef} type="file" accept="image/*" onChange={handleFileSelected} className="sr-only" aria-label="Add a dispute photo" />
          </>
        )}
      </div>

      {firstError && <p className="mt-1.5 text-xs text-danger">{UPLOAD_IMAGE_ERROR_MESSAGES[firstError.errorCode as UploadImageErrorCode]}</p>}
    </div>
  );
}
