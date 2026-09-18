import { useState } from "react";
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

/** Mirrors ShopForm's exact wiring (`onPathChange={setLogoPath}`,
 * `onUploadingChange={setLogoUploading}`) -- real React state setters, not
 * plain mock functions. Calling a real setter of this wrapping component
 * from inside ShopLogoPicker's own setSlot functional updater is what
 * reproduces React's "Cannot update a component while rendering a
 * different component" dev warning; a plain vi.fn() callback would not. */
function Harness({ initialPath = null as string | null, initialUrl = undefined as string | undefined }) {
  const [path, setPath] = useState<string | null>(initialPath);
  const [uploading, setUploading] = useState(false);
  return (
    <div>
      <p data-testid="path">{path ?? "null"}</p>
      <p data-testid="uploading">{String(uploading)}</p>
      <ShopLogoPicker ownerId="owner-1" initialPath={initialPath} initialUrl={initialUrl} onPathChange={setPath} onUploadingChange={setUploading} />
    </div>
  );
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

describe("ShopLogoPicker -- stale upload protection", () => {
  it("a slow first upload resolving after a second file was selected does not overwrite the newer file's path", async () => {
    let resolveFirst: (value: { ok: true; path: string }) => void = () => {};
    uploadImageMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    );
    uploadImageMock.mockResolvedValueOnce({ ok: true, path: "shop-images/owner-1/logo/second.jpg" });
    const { onPathChange } = renderPicker();
    const input = screen.getByLabelText(/upload shop logo/i);

    selectFile(input, "first.jpg");
    await waitFor(() => expect(uploadImageMock).toHaveBeenCalledTimes(1));

    // Replace before the first upload settles.
    selectFile(input, "second.jpg");
    await waitFor(() => expect(onPathChange).toHaveBeenLastCalledWith("shop-images/owner-1/logo/second.jpg"));

    // The stale (first) upload now resolves -- prev.file !== file inside
    // startUpload's setSlot updater must reject it rather than clobbering
    // the currently-selected second file's already-uploaded path.
    resolveFirst({ ok: true, path: "shop-images/owner-1/logo/first.jpg" });
    await Promise.resolve();

    expect(onPathChange).not.toHaveBeenCalledWith("shop-images/owner-1/logo/first.jpg");
    expect(onPathChange).toHaveBeenLastCalledWith("shop-images/owner-1/logo/second.jpg");
  });
});

describe("ShopLogoPicker -- parent notification never runs during another component's render", () => {
  it("does not call the parent's setState from inside setSlot's functional updater (no React 'update a component while rendering' warning) across select -> upload -> retry", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    uploadImageMock.mockResolvedValueOnce({ ok: false, code: "UPLOAD_FAILED" });
    uploadImageMock.mockResolvedValueOnce({ ok: true, path: "shop-images/owner-1/logo/a.jpg" });

    render(<Harness />);
    const input = screen.getByLabelText(/upload shop logo/i);

    selectFile(input);
    await screen.findByRole("button", { name: "Retry" });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getByTestId("path").textContent).toBe("shop-images/owner-1/logo/a.jpg"));

    const warnings = consoleError.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(warnings).not.toMatch(/Cannot update a component .* while rendering a different component/i);

    consoleError.mockRestore();
  });

  it("still reflects the real parent state correctly (path and uploading) using the exact setLogoPath/setLogoUploading-style wiring ShopForm uses", async () => {
    uploadImageMock.mockResolvedValue({ ok: true, path: "shop-images/owner-1/logo/a.jpg" });
    render(<Harness />);

    expect(screen.getByTestId("uploading").textContent).toBe("false");

    selectFile(screen.getByLabelText(/upload shop logo/i));

    await waitFor(() => expect(screen.getByTestId("uploading").textContent).toBe("true"));
    await waitFor(() => expect(screen.getByTestId("path").textContent).toBe("shop-images/owner-1/logo/a.jpg"));
    expect(screen.getByTestId("uploading").textContent).toBe("false");
  });
});
