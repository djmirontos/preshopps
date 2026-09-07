import { beforeEach, describe, expect, it, vi } from "vitest";
import { compressImage } from "@/lib/image-processing/compress-image";

function stubImageBitmap(width: number, height: number) {
  const close = vi.fn();
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => ({ width, height, close })),
  );
  return close;
}

function stubCanvas(blob: Blob | null) {
  const drawImage = vi.fn();
  const toBlob = vi.fn((callback: BlobCallback) => callback(blob));
  const getContext = vi.fn(() => ({ drawImage }));
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(getContext as never);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(toBlob as never);
  return { drawImage };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("compressImage", () => {
  it("rejects a non-image file without touching the canvas", async () => {
    const file = new File(["x"], "doc.pdf", { type: "application/pdf" });
    const result = await compressImage(file);
    expect(result).toEqual({ ok: false, code: "UNSUPPORTED_FILE_TYPE" });
  });

  it("rejects video, even with an image-adjacent extension, since only image/* MIME types pass", async () => {
    const file = new File(["x"], "clip.mp4", { type: "video/mp4" });
    const result = await compressImage(file);
    expect(result).toEqual({ ok: false, code: "UNSUPPORTED_FILE_TYPE" });
  });

  it("scales a wide image down to the max dimension while preserving aspect ratio, never upscaling", async () => {
    stubImageBitmap(3200, 1600);
    stubCanvas(new Blob(["x"], { type: "image/jpeg" }));

    const file = new File(["x"], "a.jpg", { type: "image/jpeg" });
    const result = await compressImage(file, { maxDimension: 1600 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.width).toBe(1600);
    expect(result.height).toBe(800);
  });

  it("never upscales an image already smaller than the max dimension", async () => {
    stubImageBitmap(400, 300);
    stubCanvas(new Blob(["x"], { type: "image/jpeg" }));

    const file = new File(["x"], "a.jpg", { type: "image/jpeg" });
    const result = await compressImage(file, { maxDimension: 1600 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.width).toBe(400);
    expect(result.height).toBe(300);
  });

  it("returns DECODE_FAILED when the browser cannot decode the file", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => {
        throw new Error("not a real image");
      }),
    );

    const file = new File(["x"], "a.jpg", { type: "image/jpeg" });
    const result = await compressImage(file);
    expect(result).toEqual({ ok: false, code: "DECODE_FAILED" });
  });

  it("returns DECODE_FAILED when canvas.toBlob yields no blob", async () => {
    stubImageBitmap(800, 600);
    stubCanvas(null);

    const file = new File(["x"], "a.jpg", { type: "image/jpeg" });
    const result = await compressImage(file);
    expect(result).toEqual({ ok: false, code: "DECODE_FAILED" });
  });

  it("always requests image/jpeg output regardless of source type", async () => {
    stubImageBitmap(800, 600);
    stubCanvas(new Blob(["x"], { type: "image/jpeg" }));
    const toBlobSpy = HTMLCanvasElement.prototype.toBlob as unknown as ReturnType<typeof vi.fn>;

    const file = new File(["x"], "a.png", { type: "image/png" });
    await compressImage(file);

    expect(toBlobSpy.mock.calls[0][1]).toBe("image/jpeg");
  });
});
