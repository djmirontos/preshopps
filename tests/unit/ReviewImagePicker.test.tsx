import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { uploadImageMock, deleteUploadedImageMock } = vi.hoisted(() => ({
  uploadImageMock: vi.fn(),
  deleteUploadedImageMock: vi.fn(),
}));

vi.mock("@/lib/image-processing/upload-image", async () => {
  const actual = await vi.importActual<typeof import("@/lib/image-processing/upload-image")>("@/lib/image-processing/upload-image");
  return {
    ...actual,
    uploadImage: uploadImageMock,
    deleteUploadedImage: deleteUploadedImageMock,
  };
});

import { ReviewImagePicker } from "@/components/orders/ReviewImagePicker";

beforeEach(() => {
  vi.clearAllMocks();
  deleteUploadedImageMock.mockResolvedValue(true);
  if (!("createObjectURL" in URL)) {
    // jsdom does not implement this -- provide a minimal stand-in so
    // selecting a file for preview doesn't throw.
    // @ts-expect-error -- test-environment polyfill
    URL.createObjectURL = vi.fn(() => "blob:mock-preview");
  }
});

function selectFile(input: HTMLElement, name = "photo.jpg") {
  const file = new File(["fake-bytes"], name, { type: "image/jpeg" });
  fireEvent.change(input, { target: { files: [file] } });
}

function renderPicker(overrides: Partial<{ initialPaths: string[]; initialUrls: string[] }> = {}) {
  const onPathsChange = vi.fn();
  const onUploadingChange = vi.fn();
  render(
    <ReviewImagePicker
      buyerId="buyer-1"
      orderId="order-1"
      initialPaths={overrides.initialPaths ?? []}
      initialUrls={overrides.initialUrls ?? []}
      onPathsChange={onPathsChange}
      onUploadingChange={onUploadingChange}
    />,
  );
  return { onPathsChange, onUploadingChange };
}

describe("ReviewImagePicker -- choosing photos", () => {
  it("choosing 1 photo uploads it to the review-images bucket under the buyer's own id and the order id", async () => {
    uploadImageMock.mockResolvedValue({ ok: true, path: "review-images/buyer-1/order-1/a.jpg" });
    const { onPathsChange } = renderPicker();

    selectFile(screen.getByLabelText(/add a review photo/i));

    await waitFor(() => expect(uploadImageMock).toHaveBeenCalledWith("review-images", "buyer-1", "order-1", expect.any(File), expect.any(Function)));
    await waitFor(() => expect(onPathsChange).toHaveBeenLastCalledWith(["review-images/buyer-1/order-1/a.jpg"]));
  });

  it("choosing a 2nd photo uploads both, reporting both paths once uploaded", async () => {
    uploadImageMock.mockResolvedValueOnce({ ok: true, path: "review-images/buyer-1/order-1/a.jpg" });
    uploadImageMock.mockResolvedValueOnce({ ok: true, path: "review-images/buyer-1/order-1/b.jpg" });
    const { onPathsChange } = renderPicker();

    selectFile(screen.getByLabelText(/add a review photo/i));
    await waitFor(() => expect(onPathsChange).toHaveBeenLastCalledWith(["review-images/buyer-1/order-1/a.jpg"]));

    selectFile(screen.getByLabelText(/add a review photo/i));
    await waitFor(() =>
      expect(onPathsChange).toHaveBeenLastCalledWith(["review-images/buyer-1/order-1/a.jpg", "review-images/buyer-1/order-1/b.jpg"]),
    );
  });

  it("hides the Add photo control once 2 photos are selected -- a 3rd cannot be added", async () => {
    uploadImageMock.mockResolvedValueOnce({ ok: true, path: "review-images/buyer-1/order-1/a.jpg" });
    uploadImageMock.mockResolvedValueOnce({ ok: true, path: "review-images/buyer-1/order-1/b.jpg" });
    renderPicker();

    selectFile(screen.getByLabelText(/add a review photo/i));
    await waitFor(() => expect(uploadImageMock).toHaveBeenCalledTimes(1));

    selectFile(screen.getByLabelText(/add a review photo/i));
    await waitFor(() => expect(uploadImageMock).toHaveBeenCalledTimes(2));

    expect(screen.queryByLabelText(/add a review photo/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add photo/i })).not.toBeInTheDocument();
  });

  it("reports isUploading:true while compressing/uploading and false once settled", async () => {
    let resolveUpload: (value: { ok: true; path: string }) => void = () => {};
    uploadImageMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveUpload = resolve;
        }),
    );
    const { onUploadingChange } = renderPicker();

    selectFile(screen.getByLabelText(/add a review photo/i));
    await waitFor(() => expect(onUploadingChange).toHaveBeenLastCalledWith(true));

    resolveUpload({ ok: true, path: "review-images/buyer-1/order-1/a.jpg" });
    await waitFor(() => expect(onUploadingChange).toHaveBeenLastCalledWith(false));
  });
});

describe("ReviewImagePicker -- removing photos", () => {
  it("removing an uploaded photo reports the remaining paths and best-effort deletes the removed one", async () => {
    uploadImageMock.mockResolvedValue({ ok: true, path: "review-images/buyer-1/order-1/a.jpg" });
    const { onPathsChange } = renderPicker();

    selectFile(screen.getByLabelText(/add a review photo/i));
    await waitFor(() => expect(onPathsChange).toHaveBeenLastCalledWith(["review-images/buyer-1/order-1/a.jpg"]));

    fireEvent.click(screen.getByRole("button", { name: "Remove photo" }));

    await waitFor(() => expect(onPathsChange).toHaveBeenLastCalledWith([]));
    expect(deleteUploadedImageMock).toHaveBeenCalledWith("review-images/buyer-1/order-1/a.jpg");
  });

  it("removing a previously-persisted (existing) image does not call delete -- only newly uploaded images are cleaned up", async () => {
    const { onPathsChange } = renderPicker({
      initialPaths: ["review-images/buyer-1/order-1/existing.jpg"],
      initialUrls: ["https://example.supabase.co/storage/v1/object/public/review-images/buyer-1/order-1/existing.jpg"],
    });

    fireEvent.click(screen.getByRole("button", { name: "Remove photo" }));

    expect(onPathsChange).toHaveBeenLastCalledWith([]);
    expect(deleteUploadedImageMock).not.toHaveBeenCalled();
  });

  it("frees a slot after removal, allowing a new photo to be added again", async () => {
    uploadImageMock.mockResolvedValue({ ok: true, path: "review-images/buyer-1/order-1/a.jpg" });
    renderPicker({
      initialPaths: [
        "review-images/buyer-1/order-1/existing1.jpg",
        "review-images/buyer-1/order-1/existing2.jpg",
      ],
      initialUrls: ["https://example.supabase.co/x/existing1.jpg", "https://example.supabase.co/x/existing2.jpg"],
    });

    expect(screen.queryByLabelText(/add a review photo/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Remove photo" })[0]);

    expect(screen.getByLabelText(/add a review photo/i)).toBeInTheDocument();
  });
});

describe("ReviewImagePicker -- upload failure and retry", () => {
  it("shows Retry on upload failure and does not report the failed image as a ready path", async () => {
    uploadImageMock.mockResolvedValue({ ok: false, code: "UPLOAD_FAILED" });
    const { onPathsChange } = renderPicker();

    selectFile(screen.getByLabelText(/add a review photo/i));

    expect(await screen.findByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(onPathsChange).toHaveBeenLastCalledWith([]);
    expect(await screen.findByText("Upload failed. Please try again.")).toBeInTheDocument();
  });

  it("Retry re-attempts the upload for the same file without requiring re-selection", async () => {
    uploadImageMock.mockResolvedValueOnce({ ok: false, code: "UPLOAD_FAILED" });
    uploadImageMock.mockResolvedValueOnce({ ok: true, path: "review-images/buyer-1/order-1/a.jpg" });
    const { onPathsChange } = renderPicker();

    selectFile(screen.getByLabelText(/add a review photo/i));
    await screen.findByRole("button", { name: "Retry" });

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(uploadImageMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(onPathsChange).toHaveBeenLastCalledWith(["review-images/buyer-1/order-1/a.jpg"]));
  });
});
