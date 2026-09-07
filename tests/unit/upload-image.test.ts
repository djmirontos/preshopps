import { beforeEach, describe, expect, it, vi } from "vitest";

const { uploadMock, removeMock, fromMock, createClientMock, compressImageMock } = vi.hoisted(() => ({
  uploadMock: vi.fn(),
  removeMock: vi.fn(),
  fromMock: vi.fn(),
  createClientMock: vi.fn(),
  compressImageMock: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: createClientMock,
}));

vi.mock("@/lib/image-processing/compress-image", () => ({
  compressImage: compressImageMock,
}));

createClientMock.mockReturnValue({ storage: { from: fromMock } });
fromMock.mockReturnValue({ upload: uploadMock, remove: removeMock });

import { uploadImage, deleteUploadedImage } from "@/lib/image-processing/upload-image";

function fakeFile(sizeBytes: number, type = "image/jpeg"): File {
  const file = new File([new Uint8Array(1)], "photo.jpg", { type });
  Object.defineProperty(file, "size", { value: sizeBytes });
  return file;
}

beforeEach(() => {
  vi.clearAllMocks();
  compressImageMock.mockResolvedValue({ ok: true, blob: new Blob(["x"], { type: "image/jpeg" }), width: 800, height: 600 });
  uploadMock.mockResolvedValue({ error: null });
});

describe("uploadImage", () => {
  it("uploads to the given bucket at {ownerUserId}/{entityId}/{randomFileName}.jpg and returns the bucket-prefixed path", async () => {
    const result = await uploadImage("review-images", "buyer-1", "order-1", fakeFile(1000));

    expect(fromMock).toHaveBeenCalledWith("review-images");
    expect(uploadMock).toHaveBeenCalledTimes(1);
    const [path, , options] = uploadMock.mock.calls[0];
    expect(path).toMatch(/^buyer-1\/order-1\/[0-9a-f-]+\.jpg$/);
    expect(options).toMatchObject({ contentType: "image/jpeg", upsert: false });

    expect(result).toEqual({ ok: true, path: `review-images/${path}` });
  });

  it("rejects a source file over the size cap before ever compressing or uploading", async () => {
    const result = await uploadImage("listing-images", "seller-1", "listing-1", fakeFile(21 * 1024 * 1024));

    expect(result).toEqual({ ok: false, code: "FILE_TOO_LARGE" });
    expect(compressImageMock).not.toHaveBeenCalled();
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it("maps a compression failure without attempting to upload", async () => {
    compressImageMock.mockResolvedValue({ ok: false, code: "DECODE_FAILED" });
    const result = await uploadImage("shop-images", "seller-1", "shop-1", fakeFile(1000));

    expect(result).toEqual({ ok: false, code: "COMPRESSION_FAILED" });
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it("maps an unsupported file type from the compressor", async () => {
    compressImageMock.mockResolvedValue({ ok: false, code: "UNSUPPORTED_FILE_TYPE" });
    const result = await uploadImage("review-images", "buyer-1", "order-1", fakeFile(1000));

    expect(result).toEqual({ ok: false, code: "UNSUPPORTED_FILE_TYPE" });
  });

  it("maps a storage upload error to UPLOAD_FAILED, never leaking the raw error", async () => {
    uploadMock.mockResolvedValue({ error: { message: "new row violates row-level security policy" } });
    const result = await uploadImage("review-images", "buyer-1", "order-1", fakeFile(1000));

    expect(result).toEqual({ ok: false, code: "UPLOAD_FAILED" });
  });

  it("maps a thrown network error to UPLOAD_FAILED", async () => {
    uploadMock.mockRejectedValue(new Error("network down"));
    const result = await uploadImage("review-images", "buyer-1", "order-1", fakeFile(1000));

    expect(result).toEqual({ ok: false, code: "UPLOAD_FAILED" });
  });

  it("reports compressing then uploading status transitions", async () => {
    const statuses: string[] = [];
    await uploadImage("review-images", "buyer-1", "order-1", fakeFile(1000), (status) => statuses.push(status));

    expect(statuses).toEqual(["compressing", "uploading"]);
  });

  it("never sends an owner id other than the one it was called with -- callers are responsible for passing auth.uid()", async () => {
    await uploadImage("listing-images", "seller-42", "listing-9", fakeFile(1000));
    const [path] = uploadMock.mock.calls[0];
    expect(path.startsWith("seller-42/listing-9/")).toBe(true);
  });
});

describe("deleteUploadedImage", () => {
  it("splits the bucket-prefixed path and calls storage.remove on the correct bucket", async () => {
    removeMock.mockResolvedValue({ error: null });
    const ok = await deleteUploadedImage("review-images/buyer-1/order-1/a.jpg");

    expect(fromMock).toHaveBeenCalledWith("review-images");
    expect(removeMock).toHaveBeenCalledWith(["buyer-1/order-1/a.jpg"]);
    expect(ok).toBe(true);
  });

  it("returns false (never throws) on a storage error", async () => {
    removeMock.mockResolvedValue({ error: { message: "not found" } });
    const ok = await deleteUploadedImage("review-images/buyer-1/order-1/a.jpg");
    expect(ok).toBe(false);
  });

  it("returns false for a malformed path with no bucket segment", async () => {
    const ok = await deleteUploadedImage("");
    expect(ok).toBe(false);
    expect(removeMock).not.toHaveBeenCalled();
  });
});
