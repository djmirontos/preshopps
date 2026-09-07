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

import { ShopLogoPicker } from "@/components/seller/ShopLogoPicker";

beforeEach(() => {
  vi.clearAllMocks();
  deleteUploadedImageMock.mockResolvedValue(true);
  if (!("createObjectURL" in URL)) {
    // @ts-expect-error -- test-environment polyfill
    URL.createObjectURL = vi.fn(() => "blob:mock-preview");
  }
});

function selectFile(input: HTMLElement, name = "logo.jpg") {
  const file = new File(["fake-bytes"], name, { type: "image/jpeg" });
  fireEvent.change(input, { target: { files: [file] } });
}

function renderPicker(overrides: Partial<{ initialPath: string | null; initialUrl: string | undefined }> = {}) {
  const onPathChange = vi.fn();
  const onUploadingChange = vi.fn();
  render(
    <ShopLogoPicker
      ownerId="owner-1"
      initialPath={overrides.initialPath ?? null}
      initialUrl={overrides.initialUrl}
      onPathChange={onPathChange}
      onUploadingChange={onUploadingChange}
    />,
  );
  return { onPathChange, onUploadingChange };
}

describe("ShopLogoPicker -- uploading", () => {
  it("uploads to the shop-images bucket under the owner's own id and a fixed 'logo' folder", async () => {
    uploadImageMock.mockResolvedValue({ ok: true, path: "shop-images/owner-1/logo/a.jpg" });
    const { onPathChange } = renderPicker();

    selectFile(screen.getByLabelText(/upload shop logo/i));

    await waitFor(() => expect(uploadImageMock).toHaveBeenCalledWith("shop-images", "owner-1", "logo", expect.any(File), expect.any(Function)));
    await waitFor(() => expect(onPathChange).toHaveBeenLastCalledWith("shop-images/owner-1/logo/a.jpg"));
  });

  it("reports isUploading true then false across the upload lifecycle", async () => {
    let resolveUpload: (value: { ok: true; path: string }) => void = () => {};
    uploadImageMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveUpload = resolve;
        }),
    );
    const { onUploadingChange } = renderPicker();

    selectFile(screen.getByLabelText(/upload shop logo/i));
    await waitFor(() => expect(onUploadingChange).toHaveBeenLastCalledWith(true));

    resolveUpload({ ok: true, path: "shop-images/owner-1/logo/a.jpg" });
    await waitFor(() => expect(onUploadingChange).toHaveBeenLastCalledWith(false));
  });

  it("shows 'Replace' instead of 'Add logo' once a logo exists", () => {
    renderPicker({ initialPath: "shop-images/owner-1/logo/existing.jpg", initialUrl: "https://example.supabase.co/x/existing.jpg" });
    expect(screen.getByRole("button", { name: /replace/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^add logo$/i })).not.toBeInTheDocument();
  });
});

describe("ShopLogoPicker -- replacing", () => {
  it("selecting a new file while an existing logo is set replaces it (never adds a second)", async () => {
    uploadImageMock.mockResolvedValue({ ok: true, path: "shop-images/owner-1/logo/new.jpg" });
    const { onPathChange } = renderPicker({ initialPath: "shop-images/owner-1/logo/existing.jpg", initialUrl: "https://example.supabase.co/x/existing.jpg" });

    selectFile(screen.getByLabelText(/upload shop logo/i));

    await waitFor(() => expect(onPathChange).toHaveBeenLastCalledWith("shop-images/owner-1/logo/new.jpg"));
    expect(document.querySelectorAll("img")).toHaveLength(1);
  });

  it("replacing a persisted (existing) logo does not delete it immediately -- only a new session upload replaced by another gets cleaned up", async () => {
    uploadImageMock.mockResolvedValueOnce({ ok: true, path: "shop-images/owner-1/logo/first-new.jpg" });
    uploadImageMock.mockResolvedValueOnce({ ok: true, path: "shop-images/owner-1/logo/second-new.jpg" });
    renderPicker({ initialPath: "shop-images/owner-1/logo/existing.jpg", initialUrl: "https://example.supabase.co/x/existing.jpg" });

    // Replace existing (persisted) with a new upload -- no delete yet.
    selectFile(screen.getByLabelText(/upload shop logo/i), "first.jpg");
    await waitFor(() => expect(uploadImageMock).toHaveBeenCalledTimes(1));
    expect(deleteUploadedImageMock).not.toHaveBeenCalled();

    // Replace that session upload with another -- the abandoned session upload IS cleaned up.
    selectFile(screen.getByLabelText(/upload shop logo/i), "second.jpg");
    await waitFor(() => expect(deleteUploadedImageMock).toHaveBeenCalledWith("shop-images/owner-1/logo/first-new.jpg"));
  });
});

describe("ShopLogoPicker -- removing", () => {
  it("removing a session-uploaded logo best-effort deletes it and clears the path", async () => {
    uploadImageMock.mockResolvedValue({ ok: true, path: "shop-images/owner-1/logo/a.jpg" });
    const { onPathChange } = renderPicker();

    selectFile(screen.getByLabelText(/upload shop logo/i));
    await waitFor(() => expect(onPathChange).toHaveBeenLastCalledWith("shop-images/owner-1/logo/a.jpg"));

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    expect(onPathChange).toHaveBeenLastCalledWith(null);
    expect(deleteUploadedImageMock).toHaveBeenCalledWith("shop-images/owner-1/logo/a.jpg");
  });

  it("removing a previously-persisted logo does not delete it immediately", () => {
    const { onPathChange } = renderPicker({ initialPath: "shop-images/owner-1/logo/existing.jpg", initialUrl: "https://example.supabase.co/x/existing.jpg" });

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    expect(onPathChange).toHaveBeenLastCalledWith(null);
    expect(deleteUploadedImageMock).not.toHaveBeenCalled();
  });

  it("shows 'Add logo' again after removal", () => {
    renderPicker({ initialPath: "shop-images/owner-1/logo/existing.jpg", initialUrl: "https://example.supabase.co/x/existing.jpg" });
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(screen.getByRole("button", { name: /add logo/i })).toBeInTheDocument();
  });
});

describe("ShopLogoPicker -- upload failure and retry", () => {
  it("shows Retry on upload failure and reports no path", async () => {
    uploadImageMock.mockResolvedValue({ ok: false, code: "UPLOAD_FAILED" });
    const { onPathChange } = renderPicker();

    selectFile(screen.getByLabelText(/upload shop logo/i));

    expect(await screen.findByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(onPathChange).toHaveBeenLastCalledWith(null);
  });

  it("Retry re-attempts the upload for the same file", async () => {
    uploadImageMock.mockResolvedValueOnce({ ok: false, code: "UPLOAD_FAILED" });
    uploadImageMock.mockResolvedValueOnce({ ok: true, path: "shop-images/owner-1/logo/a.jpg" });
    const { onPathChange } = renderPicker();

    selectFile(screen.getByLabelText(/upload shop logo/i));
    await screen.findByRole("button", { name: "Retry" });

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(uploadImageMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(onPathChange).toHaveBeenLastCalledWith("shop-images/owner-1/logo/a.jpg"));
  });
});
