"use client";

import { useRef, useState } from "react";
import { ImagePlus, Loader2, RotateCcw, UserCircle, X } from "lucide-react";
import { uploadImage, deleteUploadedImage, UPLOAD_IMAGE_ERROR_MESSAGES, type UploadImageErrorCode } from "@/lib/image-processing/upload-image";

/** Fixed folder label under the caller's own storage prefix -- one avatar
 * per account means there is never more than one per owner, exactly like
 * ShopLogoPicker's own LOGO_ENTITY convention:
 * avatar-images/{userId}/avatar/{randomUUID}.jpg. */
const AVATAR_ENTITY = "avatar";

type Slot =
  | { kind: "empty" }
  | { kind: "existing"; path: string; url: string }
  | { kind: "pending"; file: File; previewUrl: string; status: "compressing" | "uploading" | "saving" }
  | { kind: "error"; file: File; previewUrl: string; errorCode: UploadImageErrorCode };

type Props = {
  ownerId: string;
  initialPath: string | null;
  initialUrl: string | undefined;
  disabled?: boolean;
  /** Called immediately once a new file finishes uploading to storage --
   * the parent persists the resulting path via update_my_profile and
   * best-effort-deletes the previous object only after that RPC confirms
   * success, per this feature's own locked avatar flow. This is a
   * deliberate departure from ShopLogoPicker, which defers persistence to
   * the surrounding form's own Save/Create submit -- avatar changes save
   * immediately instead. Must resolve to whether the save succeeded. */
  onUploaded: (path: string) => Promise<boolean>;
  /** Same immediate-save contract as onUploaded, for removing the photo
   * entirely (no new path). */
  onRemoved: () => Promise<boolean>;
};

/**
 * On a failed save (onUploaded/onRemoved resolves false), this picker
 * does not render its own error text -- the parent's shared save-error
 * banner already shows the real (mapped, safe) message. Instead, the
 * parent bumps this component's `key` prop, which remounts it from its
 * still-unchanged initialPath/initialUrl (the parent only updates those
 * props after a confirmed successful save) -- the simplest correct way
 * to revert the preview back to the last actually-persisted avatar
 * without duplicating save-result state inside this component.
 */
export function AvatarPicker({ ownerId, initialPath, initialUrl, disabled = false, onUploaded, onRemoved }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [slot, setSlot] = useState<Slot>(() => (initialPath ? { kind: "existing", path: initialPath, url: initialUrl ?? "" } : { kind: "empty" }));
  const [isRemoving, setIsRemoving] = useState(false);

  async function runUpload(file: File, previewUrl: string) {
    const result = await uploadImage("avatar-images", ownerId, AVATAR_ENTITY, file, (status) => {
      setSlot((prev) => (prev.kind === "pending" && prev.file === file ? { ...prev, status } : prev));
    });

    if (!result.ok) {
      setSlot({ kind: "error", file, previewUrl, errorCode: result.code });
      return;
    }

    setSlot((prev) => (prev.kind === "pending" && prev.file === file ? { ...prev, status: "saving" } : prev));
    const saved = await onUploaded(result.path);

    if (!saved) {
      // Not persisted onto the profile row -- an orphaned object, safe to
      // best-effort remove immediately (never awaited for UI purposes).
      void deleteUploadedImage(result.path);
      return;
    }

    setSlot({ kind: "existing", path: result.path, url: previewUrl });
  }

  function handleFileSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    const previewUrl = URL.createObjectURL(file);
    setSlot({ kind: "pending", file, previewUrl, status: "compressing" });
    void runUpload(file, previewUrl);
  }

  function handleRetry() {
    if (slot.kind !== "error") return;
    const { file, previewUrl } = slot;
    setSlot({ kind: "pending", file, previewUrl, status: "compressing" });
    void runUpload(file, previewUrl);
  }

  async function handleRemove() {
    setIsRemoving(true);
    const saved = await onRemoved();
    setIsRemoving(false);
    if (!saved) return;
    setSlot({ kind: "empty" });
  }

  const previewUrl = slot.kind === "existing" ? slot.url : slot.kind === "pending" || slot.kind === "error" ? slot.previewUrl : undefined;
  const isBusy = slot.kind === "pending" || isRemoving;
  const isError = slot.kind === "error";
  const isEmpty = slot.kind === "empty";

  return (
    <div>
      <div className="flex items-center gap-4">
        <div className="relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-canvas">
          {previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- local blob preview / already-uploaded avatar, same reasoning as ShopLogoPicker
            <img src={previewUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <UserCircle className="h-10 w-10 text-ink-muted" aria-hidden="true" />
          )}

          {isBusy && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/30">
              <Loader2 className="h-5 w-5 animate-spin text-white" aria-hidden="true" />
              <span className="sr-only">
                {isRemoving
                  ? "Removing photo…"
                  : slot.kind === "pending" && slot.status === "compressing"
                    ? "Processing photo…"
                    : slot.kind === "pending" && slot.status === "uploading"
                      ? "Uploading photo…"
                      : "Saving photo…"}
              </span>
            </div>
          )}

          {isError && !isBusy && (
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
            disabled={disabled || isBusy}
            className="inline-flex h-9 items-center gap-1.5 rounded-[10px] border border-border px-3 text-sm font-medium text-ink hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-60"
          >
            <ImagePlus className="h-4 w-4" aria-hidden="true" />
            {isEmpty ? "Upload photo" : "Change photo"}
          </button>
          {!isEmpty && (
            <button
              type="button"
              onClick={handleRemove}
              disabled={disabled || isBusy}
              className="inline-flex h-9 items-center gap-1.5 rounded-[10px] px-3 text-sm font-medium text-ink-secondary hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-60"
            >
              <X className="h-4 w-4" aria-hidden="true" />
              Remove photo
            </button>
          )}
        </div>

        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={handleFileSelected}
          className="sr-only"
          aria-label="Upload profile photo"
        />
      </div>

      {isError && <p className="mt-1.5 text-xs text-danger">{UPLOAD_IMAGE_ERROR_MESSAGES[slot.errorCode]}</p>}
    </div>
  );
}
