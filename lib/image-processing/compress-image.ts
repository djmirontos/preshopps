/**
 * Client-side image resize/compression shared by every marketplace media
 * upload (listing photos, review photos, shop logo) -- matches
 * ARCHITECTURE.md S3.5/S12 and PRD S11.3 exactly: preserve original aspect
 * ratio, no destructive crop (the whole photo stays visible, only
 * uniformly scaled down), keep output visually clear, reduce file size
 * before upload. Uses the Canvas API (no external library) per
 * ARCHITECTURE.md's own suggestion ("small client library or Canvas API
 * abstraction").
 *
 * Always re-encodes to image/jpeg -- not the ".webp" extension shown in
 * ARCHITECTURE.md/ARCHITECTURE_ESSENTIALS.md's illustrative storage paths.
 * JPEG output via `canvas.toBlob` has universal browser support with zero
 * feature-detection branching; WEBP encoding support varies enough across
 * browsers/canvas implementations that betting the one shared compressor
 * on it would add real failure modes for a purely illustrative filename
 * choice in the docs (no canonical doc actually mandates a specific output
 * format/codec -- only "reduce file size" and "clear output").
 */

const DEFAULT_MAX_DIMENSION = 1600;
const DEFAULT_QUALITY = 0.85;

export type CompressImageOptions = {
  /** Longest edge, in pixels, after scaling. Images already smaller are
   * never upscaled. */
  maxDimension?: number;
  /** JPEG quality, 0-1. */
  quality?: number;
};

export type CompressImageResult =
  | { ok: true; blob: Blob; width: number; height: number }
  | { ok: false; code: "UNSUPPORTED_FILE_TYPE" | "DECODE_FAILED" };

export async function compressImage(file: File, options: CompressImageOptions = {}): Promise<CompressImageResult> {
  if (!file.type.startsWith("image/")) {
    return { ok: false, code: "UNSUPPORTED_FILE_TYPE" };
  }

  const maxDimension = options.maxDimension ?? DEFAULT_MAX_DIMENSION;
  const quality = options.quality ?? DEFAULT_QUALITY;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch (err) {
    console.error("compressImage: createImageBitmap failed:", err instanceof Error ? err.message : err);
    return { ok: false, code: "DECODE_FAILED" };
  }

  // Uniform scale on both axes -- this is what "preserve aspect ratio, no
  // forced crop" means in practice: never independently stretch width vs
  // height, and never scale up (min(1, ...) leaves already-small images
  // untouched).
  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");

  if (!ctx) {
    bitmap.close();
    return { ok: false, code: "DECODE_FAILED" };
  }

  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));

  if (!blob) {
    return { ok: false, code: "DECODE_FAILED" };
  }

  return { ok: true, blob, width, height };
}
