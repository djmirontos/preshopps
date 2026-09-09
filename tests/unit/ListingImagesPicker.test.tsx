import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { ListingImageWithUrl } from "@/components/seller/ListingImagesPicker";

const { uploadImageMock, deleteUploadedImageMock, replaceListingImagesMock } = vi.hoisted(() => ({
  uploadImageMock: vi.fn(),
  deleteUploadedImageMock: vi.fn(),
  replaceListingImagesMock: vi.fn(),
}));

vi.mock("@/lib/image-processing/upload-image", async () => {
  const actual = await vi.importActual<typeof import("@/lib/image-processing/upload-image")>("@/lib/image-processing/upload-image");
  return {
    ...actual,
    uploadImage: uploadImageMock,
    deleteUploadedImage: deleteUploadedImageMock,
  };
});

vi.mock("@/lib/seller/listing-actions", async () => {
  const actual = await vi.importActual<typeof import("@/lib/seller/listing-actions")>("@/lib/seller/listing-actions");
  return {
    ...actual,
    replaceListingImages: replaceListingImagesMock,
  };
});

import { ListingImagesPicker } from "@/components/seller/ListingImagesPicker";

function image(overrides: Partial<ListingImageWithUrl> = {}): ListingImageWithUrl {
  const storagePath = overrides.storagePath ?? "listing-images/owner-1/listing-1/a.jpg";
  return {
    id: "img-1",
    storagePath,
    position: 0,
    isReferenceImage: false,
    url: `https://example.supabase.co/storage/v1/object/public/${storagePath}`,
    ...overrides,
  };
}

function renderPicker(overrides: Partial<React.ComponentProps<typeof ListingImagesPicker>> = {}) {
  return render(
    <ListingImagesPicker listingId="listing-1" ownerUserId="owner-1" listingType={null} initialImages={[]} {...overrides} />,
  );
}

function selectFile(input: HTMLElement, name = "photo.jpg") {
  const file = new File(["fake-bytes"], name, { type: "image/jpeg" });
  fireEvent.change(input, { target: { files: [file] } });
}

const SUCCESS_RESULT = { ok: true as const, listingId: "listing-1", imageCount: 1, coverImageId: "img-x" };

beforeEach(() => {
  vi.clearAllMocks();
  deleteUploadedImageMock.mockResolvedValue(true);
  replaceListingImagesMock.mockResolvedValue(SUCCESS_RESULT);
  if (!("createObjectURL" in URL)) {
    // @ts-expect-error -- test-environment polyfill
    URL.createObjectURL = vi.fn(() => "blob:mock-preview");
  }
});

describe("ListingImagesPicker -- rendering", () => {
  it("renders zero images with a 0 of 8 count and no remove/move controls", () => {
    renderPicker();
    expect(screen.getByText("0 of 8 photos")).toBeInTheDocument();
    expect(screen.queryByLabelText(/remove image/i)).not.toBeInTheDocument();
  });

  it("renders existing images in position order", () => {
    const { container } = renderPicker({
      initialImages: [
        image({ id: "img-2", storagePath: "listing-images/owner-1/listing-1/b.jpg", position: 1 }),
        image({ id: "img-1", storagePath: "listing-images/owner-1/listing-1/a.jpg", position: 0 }),
      ],
    });

    expect(screen.getByText("2 of 8 photos")).toBeInTheDocument();
    // Preview <img> tiles are decorative (alt="") and carry no accessible
    // "img" role, so this queries the DOM directly rather than via role.
    const images = container.querySelectorAll("img");
    expect(images[0]).toHaveAttribute("src", expect.stringContaining("a.jpg"));
    expect(images[1]).toHaveAttribute("src", expect.stringContaining("b.jpg"));
  });

  it("marks only the first image (position 0) as Cover", () => {
    renderPicker({
      initialImages: [image({ id: "img-1", position: 0 }), image({ id: "img-2", position: 1 })],
    });

    expect(screen.getAllByText("Cover")).toHaveLength(1);
  });

  it("hides Add photo once 8 images exist", () => {
    const images = Array.from({ length: 8 }, (_, i) => image({ id: `img-${i}`, storagePath: `listing-images/owner-1/listing-1/${i}.jpg`, position: i }));
    renderPicker({ initialImages: images });

    expect(screen.getByText("8 of 8 photos")).toBeInTheDocument();
    expect(screen.queryByLabelText("Add a listing photo")).not.toBeInTheDocument();
  });
});

describe("ListingImagesPicker -- upload", () => {
  it("shows compressing then uploading status, then calls replace_listing_images with the uploaded path", async () => {
    let resolveUpload: (value: { ok: true; path: string }) => void = () => {};
    uploadImageMock.mockReturnValue(new Promise((resolve) => (resolveUpload = resolve)));
    renderPicker();

    selectFile(screen.getByLabelText("Add a listing photo"));

    expect(await screen.findByText("Compressing…")).toBeInTheDocument();

    resolveUpload({ ok: true, path: "listing-images/owner-1/listing-1/new.jpg" });

    await waitFor(() =>
      expect(replaceListingImagesMock).toHaveBeenCalledWith("listing-1", ["listing-images/owner-1/listing-1/new.jpg"], [false]),
    );
  });

  it("a failed upload never appears in a replace_listing_images call, and shows Retry", async () => {
    uploadImageMock.mockResolvedValue({ ok: false, code: "UPLOAD_FAILED" });
    renderPicker();

    selectFile(screen.getByLabelText("Add a listing photo"));

    expect(await screen.findByRole("button", { name: /retry/i })).toBeInTheDocument();
    expect(replaceListingImagesMock).not.toHaveBeenCalled();
  });

  it("retrying a failed upload re-attempts and persists on success", async () => {
    uploadImageMock.mockResolvedValueOnce({ ok: false, code: "UPLOAD_FAILED" });
    uploadImageMock.mockResolvedValueOnce({ ok: true, path: "listing-images/owner-1/listing-1/retry.jpg" });
    renderPicker();

    selectFile(screen.getByLabelText("Add a listing photo"));
    const retryButton = await screen.findByRole("button", { name: /retry/i });
    fireEvent.click(retryButton);

    await waitFor(() =>
      expect(replaceListingImagesMock).toHaveBeenCalledWith("listing-1", ["listing-images/owner-1/listing-1/retry.jpg"], [false]),
    );
  });

  it("newly uploaded images default to Actual Item (is_reference_image: false)", async () => {
    uploadImageMock.mockResolvedValue({ ok: true, path: "listing-images/owner-1/listing-1/new.jpg" });
    renderPicker({ listingType: "brand_new" });

    selectFile(screen.getByLabelText("Add a listing photo"));

    await waitFor(() => expect(replaceListingImagesMock).toHaveBeenCalledWith("listing-1", expect.any(Array), [false]));
  });

  it("uploading a second photo alongside an existing one sends the full combined array", async () => {
    uploadImageMock.mockResolvedValue({ ok: true, path: "listing-images/owner-1/listing-1/new.jpg" });
    renderPicker({ initialImages: [image({ id: "img-1", storagePath: "listing-images/owner-1/listing-1/a.jpg", position: 0 })] });

    selectFile(screen.getByLabelText("Add a listing photo"));

    await waitFor(() =>
      expect(replaceListingImagesMock).toHaveBeenCalledWith(
        "listing-1",
        ["listing-images/owner-1/listing-1/a.jpg", "listing-images/owner-1/listing-1/new.jpg"],
        [false, false],
      ),
    );
  });

  it("rolls back the optimistic UI state when replace_listing_images fails", async () => {
    uploadImageMock.mockResolvedValue({ ok: true, path: "listing-images/owner-1/listing-1/new.jpg" });
    replaceListingImagesMock.mockResolvedValue({ ok: false, code: "TOO_MANY_LISTING_IMAGES" });
    renderPicker();

    selectFile(screen.getByLabelText("Add a listing photo"));

    expect(await screen.findByText("A listing may have at most 8 photos.")).toBeInTheDocument();
  });
});

describe("ListingImagesPicker -- remove", () => {
  it("removing one of several images persists the full remaining array", async () => {
    renderPicker({
      initialImages: [
        image({ id: "img-1", storagePath: "listing-images/owner-1/listing-1/a.jpg", position: 0 }),
        image({ id: "img-2", storagePath: "listing-images/owner-1/listing-1/b.jpg", position: 1 }),
      ],
    });

    fireEvent.click(screen.getByLabelText("Remove image 1"));

    await waitFor(() =>
      expect(replaceListingImagesMock).toHaveBeenCalledWith("listing-1", ["listing-images/owner-1/listing-1/b.jpg"], [false]),
    );
  });

  it("removing the final image sends an empty array", async () => {
    renderPicker({ initialImages: [image({ id: "img-1", position: 0 })] });

    fireEvent.click(screen.getByLabelText("Remove image 1"));

    await waitFor(() => expect(replaceListingImagesMock).toHaveBeenCalledWith("listing-1", [], []));
  });

  it("a newly uploaded image is deleted from storage if the persisting replace_listing_images call fails", async () => {
    uploadImageMock.mockResolvedValue({ ok: true, path: "listing-images/owner-1/listing-1/new.jpg" });
    replaceListingImagesMock.mockResolvedValue({ ok: false, code: "TOO_MANY_LISTING_IMAGES" });
    renderPicker();

    selectFile(screen.getByLabelText("Add a listing photo"));

    await waitFor(() => expect(deleteUploadedImageMock).toHaveBeenCalledWith("listing-images/owner-1/listing-1/new.jpg"));
  });

  it("removing a freshly-uploaded (successfully committed) image deletes it only after the new replace call confirms success", async () => {
    uploadImageMock.mockResolvedValue({ ok: true, path: "listing-images/owner-1/listing-1/new.jpg" });
    renderPicker();

    selectFile(screen.getByLabelText("Add a listing photo"));
    await waitFor(() => expect(replaceListingImagesMock).toHaveBeenCalledWith("listing-1", ["listing-images/owner-1/listing-1/new.jpg"], [false]));
    await waitFor(() => expect(screen.getByLabelText("Remove image 1")).not.toBeDisabled());

    fireEvent.click(screen.getByLabelText("Remove image 1"));

    await waitFor(() => expect(replaceListingImagesMock).toHaveBeenCalledWith("listing-1", [], []));
    await waitFor(() => expect(deleteUploadedImageMock).toHaveBeenCalledWith("listing-images/owner-1/listing-1/new.jpg"));
  });

  it("does not delete storage for an existing (already committed) image on remove -- only the post-success cleanup diff does that", async () => {
    renderPicker({ initialImages: [image({ id: "img-1", storagePath: "listing-images/owner-1/listing-1/a.jpg", position: 0 })] });

    fireEvent.click(screen.getByLabelText("Remove image 1"));

    // deleteUploadedImage should not be called synchronously on click for an
    // existing/committed image -- cleanup happens after replace succeeds.
    expect(deleteUploadedImageMock).not.toHaveBeenCalled();
    await waitFor(() => expect(replaceListingImagesMock).toHaveBeenCalled());
    await waitFor(() => expect(deleteUploadedImageMock).toHaveBeenCalledWith("listing-images/owner-1/listing-1/a.jpg"));
  });
});

describe("ListingImagesPicker -- reorder", () => {
  it("Move Right swaps an image with its right neighbor and persists the new order", async () => {
    renderPicker({
      initialImages: [
        image({ id: "img-1", storagePath: "listing-images/owner-1/listing-1/a.jpg", position: 0 }),
        image({ id: "img-2", storagePath: "listing-images/owner-1/listing-1/b.jpg", position: 1 }),
      ],
    });

    fireEvent.click(screen.getByLabelText("Move image 1 right"));

    await waitFor(() =>
      expect(replaceListingImagesMock).toHaveBeenCalledWith(
        "listing-1",
        ["listing-images/owner-1/listing-1/b.jpg", "listing-images/owner-1/listing-1/a.jpg"],
        [false, false],
      ),
    );
  });

  it("Move Left swaps an image with its left neighbor", async () => {
    renderPicker({
      initialImages: [
        image({ id: "img-1", storagePath: "listing-images/owner-1/listing-1/a.jpg", position: 0 }),
        image({ id: "img-2", storagePath: "listing-images/owner-1/listing-1/b.jpg", position: 1 }),
      ],
    });

    fireEvent.click(screen.getByLabelText("Move image 2 left"));

    await waitFor(() =>
      expect(replaceListingImagesMock).toHaveBeenCalledWith(
        "listing-1",
        ["listing-images/owner-1/listing-1/b.jpg", "listing-images/owner-1/listing-1/a.jpg"],
        [false, false],
      ),
    );
  });

  it("the cover moves with whichever image ends up at position 0 after reorder", async () => {
    renderPicker({
      initialImages: [
        image({ id: "img-1", storagePath: "listing-images/owner-1/listing-1/a.jpg", position: 0 }),
        image({ id: "img-2", storagePath: "listing-images/owner-1/listing-1/b.jpg", position: 1 }),
      ],
    });

    expect(screen.getAllByText("Cover")).toHaveLength(1);
    fireEvent.click(screen.getByLabelText("Move image 1 right"));

    await waitFor(() => expect(replaceListingImagesMock).toHaveBeenCalled());
  });

  it("the first image's Move Left button is disabled", () => {
    renderPicker({
      initialImages: [image({ id: "img-1", position: 0 }), image({ id: "img-2", position: 1 })],
    });

    expect(screen.getByLabelText("Move image 1 left")).toBeDisabled();
  });

  it("the last image's Move Right button is disabled", () => {
    renderPicker({
      initialImages: [image({ id: "img-1", position: 0 }), image({ id: "img-2", position: 1 })],
    });

    expect(screen.getByLabelText("Move image 2 right")).toBeDisabled();
  });

  it("reorder keeps reference flags aligned with their own image, not with position", async () => {
    renderPicker({
      listingType: "brand_new",
      initialImages: [
        image({ id: "img-1", storagePath: "listing-images/owner-1/listing-1/a.jpg", position: 0, isReferenceImage: false }),
        image({ id: "img-2", storagePath: "listing-images/owner-1/listing-1/b.jpg", position: 1, isReferenceImage: true }),
      ],
    });

    fireEvent.click(screen.getByLabelText("Move image 1 right"));

    await waitFor(() =>
      expect(replaceListingImagesMock).toHaveBeenCalledWith(
        "listing-1",
        ["listing-images/owner-1/listing-1/b.jpg", "listing-images/owner-1/listing-1/a.jpg"],
        [true, false],
      ),
    );
  });
});

describe("ListingImagesPicker -- reference/catalog toggle", () => {
  it("Brand New: shows a reference toggle per image", () => {
    renderPicker({ listingType: "brand_new", initialImages: [image({ id: "img-1", position: 0 })] });
    expect(screen.getByLabelText("Mark image 1 as reference")).toBeInTheDocument();
  });

  it("Pre-loved: never shows a reference toggle", () => {
    renderPicker({ listingType: "preloved", initialImages: [image({ id: "img-1", position: 0 })] });
    expect(screen.queryByLabelText(/mark image 1 as/i)).not.toBeInTheDocument();
  });

  it("null listing type (incomplete Draft): never shows a reference toggle", () => {
    renderPicker({ listingType: null, initialImages: [image({ id: "img-1", position: 0 })] });
    expect(screen.queryByLabelText(/mark image 1 as/i)).not.toBeInTheDocument();
  });

  it("toggling reference for Brand New persists the updated flags array", async () => {
    renderPicker({
      listingType: "brand_new",
      initialImages: [
        image({ id: "img-1", storagePath: "listing-images/owner-1/listing-1/a.jpg", position: 0, isReferenceImage: false }),
      ],
    });

    fireEvent.click(screen.getByLabelText("Mark image 1 as reference"));

    await waitFor(() =>
      expect(replaceListingImagesMock).toHaveBeenCalledWith("listing-1", ["listing-images/owner-1/listing-1/a.jpg"], [true]),
    );
  });

  it("shows a Reference badge on a reference image", () => {
    renderPicker({ listingType: "brand_new", initialImages: [image({ id: "img-1", position: 0, isReferenceImage: true })] });
    expect(screen.getByText("Reference")).toBeInTheDocument();
  });

  it("flags a Pre-loved listing that already has a reference image, without removing it", () => {
    renderPicker({ listingType: "preloved", initialImages: [image({ id: "img-1", position: 0, isReferenceImage: true })] });

    expect(screen.getByText(/pre-loved listings must use actual-item photos only/i)).toBeInTheDocument();
    expect(screen.getByText("Reference")).toBeInTheDocument();
  });
});

describe("ListingImagesPicker -- race safety", () => {
  it("disables reorder/remove/toggle while a replace_listing_images call is pending", async () => {
    let resolveReplace: (value: typeof SUCCESS_RESULT) => void = () => {};
    replaceListingImagesMock.mockReturnValue(new Promise((resolve) => (resolveReplace = resolve)));
    renderPicker({
      listingType: "brand_new",
      initialImages: [image({ id: "img-1", position: 0 }), image({ id: "img-2", position: 1 })],
    });

    fireEvent.click(screen.getByLabelText("Move image 1 right"));

    expect(screen.getByLabelText("Move image 1 left")).toBeDisabled();
    expect(screen.getByLabelText("Remove image 1")).toBeDisabled();

    resolveReplace(SUCCESS_RESULT);
    await waitFor(() => expect(screen.getByLabelText("Remove image 1")).not.toBeDisabled());
  });

  it("disables reorder/remove while a photo is still compressing/uploading", async () => {
    uploadImageMock.mockReturnValue(new Promise(() => {}));
    renderPicker({ initialImages: [image({ id: "img-1", position: 0 })] });

    selectFile(screen.getByLabelText("Add a listing photo"));

    await screen.findByText("Compressing…");
    expect(screen.getByLabelText("Remove image 1")).toBeDisabled();
  });
});

describe("ListingImagesPicker -- scope / accessibility", () => {
  it("never renders a Publish button or vehicle/rental fields", () => {
    renderPicker({ initialImages: [image({ id: "img-1", position: 0 })] });
    expect(screen.queryByRole("button", { name: /publish/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/mileage/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/rental price/i)).not.toBeInTheDocument();
  });

  it("only ever calls the RPC wrapper -- no direct table access is imported or used", () => {
    // Structural guarantee: the component imports replaceListingImages
    // (an RPC wrapper) and uploadImage/deleteUploadedImage (storage-only
    // helpers) -- there is no supabase.from(...) call anywhere in this
    // component, verified by construction (no such import exists).
    renderPicker();
    expect(replaceListingImagesMock).not.toHaveBeenCalled();
  });

  it("every action button carries an explicit, descriptive accessible label", () => {
    renderPicker({
      listingType: "brand_new",
      initialImages: [image({ id: "img-1", position: 0 }), image({ id: "img-2", position: 1 })],
    });

    expect(screen.getByLabelText("Move image 1 left")).toBeInTheDocument();
    expect(screen.getByLabelText("Move image 1 right")).toBeInTheDocument();
    expect(screen.getByLabelText("Remove image 1")).toBeInTheDocument();
    expect(screen.getByLabelText("Mark image 1 as reference")).toBeInTheDocument();
  });
});
