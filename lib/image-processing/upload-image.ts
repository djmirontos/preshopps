import { createClient } from "@/lib/supabase/client";
import { compressImage } from "@/lib/image-processing/compress-image";

/**
 * Exactly the three buckets created by 0048_media_storage_foundation.sql.
 * Never invent a fourth without a matching migration.
 */
export type MediaBucket = "listing-images" | "review-images" | "shop-images" | "dispute-images";

const MAX_SOURCE_FILE_BYTES = 20 * 1024 * 1024;

export type UploadImageErrorCode = "UNSUPPORTED_FILE_TYPE" | "FILE_TOO_LARGE" | "COMPRESSION_FAILED" | "UPLOAD_FAILED";

export const UPLOAD_IMAGE_ERROR_MESSAGES: Record<UploadImageErrorCode, string> = {
  UNSUPPORTED_FILE_TYPE: "Please choose a JPG, PNG, or WEBP image.",
  FILE_TOO_LARGE: "That image is too large. Please choose a smaller photo.",
  COMPRESSION_FAILED: "This image couldn't be processed. Please try a different photo.",
  UPLOAD_FAILED: "Upload failed. Please try again.",
};

export type UploadImageResult = { ok: true; path: string } | { ok: false; code: UploadImageErrorCode };

/**
 * "compressing" then "uploading" -- a status-based indicator, not a true
 * byte-level progress percentage. The installed @supabase/storage-js
 * (2.112.4) uploads via `fetch`, which exposes no upload-progress events;
 * building real percentage progress would mean bypassing the SDK for a
 * raw XHR PUT against the Storage REST API -- exactly the kind of
 * speculative infrastructure this task's own "do not build a giant media
 * framework" instruction warns against for a two-photo review form. This
 * still satisfies PRD S11.4's actual requirement (an overlay/spinner while
 * uploading, a clear completion/failure state) without pretending to know
 * a percentage the SDK cannot report.
 */
export type UploadImageStatus = "compressing" | "uploading";

function randomFileName(): string {
  return `${crypto.randomUUID()}.jpg`;
}

/**
 * Shared upload helper for every marketplace media type (listing photos,
 * review photos, shop logo). Compresses client-side (compressImage --
 * aspect ratio preserved, no crop), then uploads the resulting JPEG to
 * `{bucket}/{ownerUserId}/{entityId}/{randomFileName}`. `ownerUserId` MUST
 * be the caller's own auth.uid() -- storage RLS
 * (0048_media_storage_foundation.sql) enforces this independently of
 * whatever this function is told to do, so passing anything else simply
 * fails the upload rather than succeeding for the wrong user. Returns the
 * bucket-prefixed storage path (never a public URL) -- callers persist
 * this path into the relevant table (`review_images.storage_path`,
 * `listing_images.storage_path`, `shops.logo_storage_path`) and resolve a
 * display URL later via the existing getListingImageUrl helper, exactly
 * like every other stored path in this schema.
 */
export async function uploadImage(
  bucket: MediaBucket,
  ownerUserId: string,
  entityId: string,
  file: File,
  onStatusChange?: (status: UploadImageStatus) => void,
): Promise<UploadImageResult> {
  if (file.size > MAX_SOURCE_FILE_BYTES) {
    return { ok: false, code: "FILE_TOO_LARGE" };
  }

  onStatusChange?.("compressing");
  const compressed = await compressImage(file);

  if (!compressed.ok) {
    return { ok: false, code: compressed.code === "UNSUPPORTED_FILE_TYPE" ? "UNSUPPORTED_FILE_TYPE" : "COMPRESSION_FAILED" };
  }

  const path = `${ownerUserId}/${entityId}/${randomFileName()}`;
  const supabase = createClient();

  onStatusChange?.("uploading");

  try {
    const { error } = await supabase.storage.from(bucket).upload(path, compressed.blob, {
      contentType: "image/jpeg",
      upsert: false,
    });

    if (error) {
      console.error(`Storage upload to ${bucket} failed:`, error.message);
      return { ok: false, code: "UPLOAD_FAILED" };
    }

    return { ok: true, path: `${bucket}/${path}` };
  } catch (err) {
    console.error(`Storage upload to ${bucket} threw:`, err instanceof Error ? err.message : err);
    return { ok: false, code: "UPLOAD_FAILED" };
  }
}

/**
 * Best-effort delete, used only for (a) a buyer removing a not-yet-submitted
 * image before the review mutation runs, and (b) cleanup of newly-uploaded
 * orphans when a review create/update call fails after upload succeeded.
 * `storagePath` is the same bucket-prefixed path uploadImage returns.
 * Never throws -- a failed cleanup is logged, not surfaced as a user-facing
 * error, since the image being orphaned is a minor storage-hygiene issue,
 * never a reason to fail the surrounding user action.
 */
export async function deleteUploadedImage(storagePath: string): Promise<boolean> {
  const [bucket, ...rest] = storagePath.split("/");
  const path = rest.join("/");

  if (!bucket || !path) return false;

  const supabase = createClient();

  try {
    const { error } = await supabase.storage.from(bucket).remove([path]);

    if (error) {
      console.error(`Storage delete from ${bucket} failed:`, error.message);
      return false;
    }

    return true;
  } catch (err) {
    console.error("Storage delete threw:", err instanceof Error ? err.message : err);
    return false;
  }
}
