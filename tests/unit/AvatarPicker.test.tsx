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

import { AvatarPicker } from "@/components/account/AvatarPicker";

beforeEach(() => {
  vi.clearAllMocks();
  deleteUploadedImageMock.mockResolvedValue(true);
  if (!("createObjectURL" in URL)) {
    // @ts-expect-error -- test-environment polyfill
    URL.createObjectURL = vi.fn(() => "blob:mock-preview");
  }
});

function selectFile(input: HTMLElement, name = "avatar.jpg") {
  const file = new File(["fake-bytes"], name, { type: "image/jpeg" });
  fireEvent.change(input, { target: { files: [file] } });
}

function renderPicker(overrides: Partial<{ initialPath: string | null; initialUrl: string | undefined; disabled: boolean }> = {}) {
  const onUploaded = vi.fn().mockResolvedValue(true);
  const onRemoved = vi.fn().mockResolvedValue(true);
  const utils = render(
    <AvatarPicker
      ownerId="user-1"
      initialPath={overrides.initialPath ?? null}
      initialUrl={overrides.initialUrl}
      disabled={overrides.disabled}
      onUploaded={onUploaded}
      onRemoved={onRemoved}
    />,
  );
  return { ...utils, onUploaded, onRemoved };
}

describe("AvatarPicker -- uploading", () => {
  it("uploads to the avatar-images bucket under the authenticated user's own id and a fixed 'avatar' folder", async () => {
    uploadImageMock.mockResolvedValue({ ok: true, path: "avatar-images/user-1/avatar/a.jpg" });
    renderPicker();

    selectFile(screen.getByLabelText(/upload profile photo/i));

    await waitFor(() => expect(uploadImageMock).toHaveBeenCalledWith("avatar-images", "user-1", "avatar", expect.any(File), expect.any(Function)));
  });

  it("calls onUploaded with the new path once storage upload succeeds", async () => {
    uploadImageMock.mockResolvedValue({ ok: true, path: "avatar-images/user-1/avatar/a.jpg" });
    const { onUploaded } = renderPicker();

    selectFile(screen.getByLabelText(/upload profile photo/i));

    await waitFor(() => expect(onUploaded).toHaveBeenCalledWith("avatar-images/user-1/avatar/a.jpg"));
  });

  it("shows 'Change photo' instead of 'Upload photo' once an avatar exists", () => {
    renderPicker({ initialPath: "avatar-images/user-1/avatar/existing.jpg", initialUrl: "https://example.supabase.co/x/existing.jpg" });
    expect(screen.getByRole("button", { name: /change photo/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^upload photo$/i })).not.toBeInTheDocument();
  });
});

describe("AvatarPicker -- save failure (parent's update_my_profile call fails)", () => {
  it("does not render its own error text -- the parent's shared error banner owns that", async () => {
    uploadImageMock.mockResolvedValue({ ok: true, path: "avatar-images/user-1/avatar/a.jpg" });
    const onUploaded = vi.fn().mockResolvedValue(false);
    render(<AvatarPicker ownerId="user-1" initialPath={null} initialUrl={undefined} onUploaded={onUploaded} onRemoved={vi.fn()} />);

    selectFile(screen.getByLabelText(/upload profile photo/i));

    await waitFor(() => expect(onUploaded).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  it("best-effort deletes the newly-uploaded object when the parent's save fails (it was never persisted)", async () => {
    uploadImageMock.mockResolvedValue({ ok: true, path: "avatar-images/user-1/avatar/a.jpg" });
    const onUploaded = vi.fn().mockResolvedValue(false);
    render(<AvatarPicker ownerId="user-1" initialPath={null} initialUrl={undefined} onUploaded={onUploaded} onRemoved={vi.fn()} />);

    selectFile(screen.getByLabelText(/upload profile photo/i));

    await waitFor(() => expect(deleteUploadedImageMock).toHaveBeenCalledWith("avatar-images/user-1/avatar/a.jpg"));
  });
});

describe("AvatarPicker -- removing", () => {
  it("calls onRemoved and, on success, clears its own display back to empty", async () => {
    const { onRemoved } = renderPicker({ initialPath: "avatar-images/user-1/avatar/existing.jpg", initialUrl: "https://example.supabase.co/x/existing.jpg" });

    fireEvent.click(screen.getByRole("button", { name: /remove photo/i }));

    await waitFor(() => expect(onRemoved).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole("button", { name: /upload photo/i })).toBeInTheDocument());
  });

  it("does not clear its display when onRemoved reports failure", async () => {
    const onRemoved = vi.fn().mockResolvedValue(false);
    render(
      <AvatarPicker
        ownerId="user-1"
        initialPath="avatar-images/user-1/avatar/existing.jpg"
        initialUrl="https://example.supabase.co/x/existing.jpg"
        onUploaded={vi.fn()}
        onRemoved={onRemoved}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /remove photo/i }));

    await waitFor(() => expect(onRemoved).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: /change photo/i })).toBeInTheDocument();
  });

  it("does not render a Remove control when there is no photo", () => {
    renderPicker();
    expect(screen.queryByRole("button", { name: /remove photo/i })).not.toBeInTheDocument();
  });
});

describe("AvatarPicker -- upload failure and retry (storage/compression errors, before any save attempt)", () => {
  it("shows Retry on upload failure and never calls onUploaded", async () => {
    uploadImageMock.mockResolvedValue({ ok: false, code: "UPLOAD_FAILED" });
    const { onUploaded } = renderPicker();

    selectFile(screen.getByLabelText(/upload profile photo/i));

    expect(await screen.findByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(onUploaded).not.toHaveBeenCalled();
  });

  it("shows a safe message for an unsupported file type -- never a raw storage error", async () => {
    uploadImageMock.mockResolvedValue({ ok: false, code: "UNSUPPORTED_FILE_TYPE" });
    renderPicker();

    selectFile(screen.getByLabelText(/upload profile photo/i));

    expect(await screen.findByText(/jpg, png, or webp/i)).toBeInTheDocument();
  });

  it("Retry re-attempts the upload for the same file", async () => {
    uploadImageMock.mockResolvedValueOnce({ ok: false, code: "UPLOAD_FAILED" });
    uploadImageMock.mockResolvedValueOnce({ ok: true, path: "avatar-images/user-1/avatar/a.jpg" });
    const { onUploaded } = renderPicker();

    selectFile(screen.getByLabelText(/upload profile photo/i));
    await screen.findByRole("button", { name: "Retry" });

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(uploadImageMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(onUploaded).toHaveBeenCalledWith("avatar-images/user-1/avatar/a.jpg"));
  });
});

describe("AvatarPicker -- disabled state", () => {
  it("disables both buttons when disabled is true", () => {
    renderPicker({ initialPath: "avatar-images/user-1/avatar/existing.jpg", initialUrl: "https://example.supabase.co/x/existing.jpg", disabled: true });
    expect(screen.getByRole("button", { name: /change photo/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /remove photo/i })).toBeDisabled();
  });
});
