import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";

const {
  pushMock,
  refreshMock,
  getPublishedListingEditStateMock,
  updatePublishedListingMock,
  uploadImageMock,
  deleteUploadedImageMock,
  notifySuccessMock,
} = vi.hoisted(() => ({
  pushMock: vi.fn(),
  refreshMock: vi.fn(),
  getPublishedListingEditStateMock: vi.fn(),
  updatePublishedListingMock: vi.fn(),
  uploadImageMock: vi.fn(),
  deleteUploadedImageMock: vi.fn(),
  notifySuccessMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

vi.mock("@/lib/notifications/toast", () => ({
  notifySuccess: notifySuccessMock,
}));

vi.mock("@/lib/seller/published-listing-actions", async () => {
  const actual = await vi.importActual<typeof import("@/lib/seller/published-listing-actions")>("@/lib/seller/published-listing-actions");
  return {
    ...actual,
    getPublishedListingEditState: getPublishedListingEditStateMock,
    updatePublishedListing: updatePublishedListingMock,
  };
});

// Same mocking convention as ListingImagesPicker.test.tsx -- proves this
// component only ever reaches Storage through the shared uploadImage
// helper, and lets tests assert deleteUploadedImage is NEVER called for a
// published gallery (unlike Draft's own picker, which does call it).
vi.mock("@/lib/image-processing/upload-image", async () => {
  const actual = await vi.importActual<typeof import("@/lib/image-processing/upload-image")>("@/lib/image-processing/upload-image");
  return {
    ...actual,
    uploadImage: uploadImageMock,
    deleteUploadedImage: deleteUploadedImageMock,
  };
});

vi.mock("@/lib/marketplace/listing-image-url", () => ({
  getListingImageUrl: (path: string | null) => (path ? `https://example.supabase.co/storage/v1/object/public/${path}` : undefined),
}));

import { PublishedListingEditor } from "@/components/seller/PublishedListingEditor";
import type { PublishedListingEditState } from "@/lib/seller/published-listing-actions";
import type { MyListingImage } from "@/lib/seller/get-my-listing";

const CATEGORIES = [
  { id: 1, slug: "women", name: "Women" },
  { id: 2, slug: "cars", name: "Cars" },
  { id: 3, slug: "for-rent", name: "For Rent" },
];
const PROVINCES = [{ id: 1, name: "Misamis Occidental" }];
const CITIES = [{ id: 10, name: "Tangub City" }];
const BARANGAYS = [{ id: 100, name: "Barangay Uno" }];

function image(overrides: Partial<MyListingImage> = {}): MyListingImage {
  return {
    id: "img-1",
    storagePath: "listing-images/u1/listing-1/a.jpg",
    position: 0,
    isReferenceImage: false,
    ...overrides,
  };
}

function sampleState(overrides: Partial<PublishedListingEditState> = {}): PublishedListingEditState {
  return {
    listingId: "listing-1",
    publicCode: "PSL-ABC123",
    slug: "nike-air-max-270",
    status: "available",
    title: "Nike Air Max 270",
    description: "Worn twice.",
    categoryId: 1,
    listingType: "preloved",
    condition: "good",
    priceCents: 150000,
    originalPriceCents: null,
    isNegotiable: false,
    brand: "Nike",
    knownFlaws: null,
    stockQuantity: 5,
    provinceId: 1,
    cityId: 10,
    barangayId: 100,
    meetupNote: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-05T00:00:00.000Z",
    publishedAt: "2026-01-02T00:00:00.000Z",
    fulfillmentMethods: ["meetup"],
    // A real published (Available/Paused) listing always has at least one
    // image already -- publish_listing itself enforces IMAGE_REQUIRED
    // before a Draft can ever become Available. Defaulting to one image
    // here (rather than []) keeps every non-gallery-focused test realistic
    // without needing to pass images/coverImageId explicitly; tests that
    // deliberately exercise the empty-gallery edge case override this.
    images: [image()],
    vehicleDetails: null,
    rentalDetails: null,
    revision: "1",
    availableQuantity: 5,
    reservedQuantity: 0,
    coverImageId: "img-1",
    quantityEditable: true,
    ...overrides,
  };
}

function renderEditor(overrides: Partial<ComponentProps<typeof PublishedListingEditor>> = {}) {
  return render(
    <PublishedListingEditor
      listingId="listing-1"
      ownerUserId="u1"
      initialState={sampleState()}
      categories={CATEGORIES}
      provinces={PROVINCES}
      initialCities={CITIES}
      initialBarangays={BARANGAYS}
      loadCities={vi.fn().mockResolvedValue(CITIES)}
      loadBarangays={vi.fn().mockResolvedValue(BARANGAYS)}
      {...overrides}
    />,
  );
}

function selectFile(name = "photo.jpg") {
  const input = screen.getByLabelText("Add a listing photo");
  const file = new File(["fake-bytes"], name, { type: "image/jpeg" });
  fireEvent.change(input, { target: { files: [file] } });
}

beforeEach(() => {
  vi.clearAllMocks();
  deleteUploadedImageMock.mockResolvedValue(true);
  if (!("createObjectURL" in URL)) {
    // @ts-expect-error -- test-environment polyfill
    URL.createObjectURL = vi.fn(() => "blob:mock-preview");
  }
});

describe("PublishedListingEditor -- Available", () => {
  it("renders the real editor, prefilled from the server state", () => {
    renderEditor();

    expect(screen.getByRole("heading", { level: 1, name: "Edit Listing" })).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toHaveValue("Nike Air Max 270");
    expect(screen.getByLabelText("Description")).toHaveValue("Worn twice.");
    expect(screen.getByLabelText(/^price$/i)).toHaveValue("1500.00");
    expect(screen.getByRole("button", { name: "Save changes" })).toBeInTheDocument();
  });

  it("never shows a Publish button", () => {
    renderEditor();
    expect(screen.queryByRole("button", { name: "Publish Listing" })).not.toBeInTheDocument();
  });

  it("renders category/type/condition as a read-only summary, never an editable control", () => {
    renderEditor();

    expect(screen.getByText("Women")).toBeInTheDocument();
    expect(screen.getByText("Pre-loved")).toBeInTheDocument();
    expect(screen.getByText("Good")).toBeInTheDocument();
    expect(screen.queryByLabelText(/^category/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/listing type/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^condition/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: /category|condition|listing type/i })).not.toBeInTheDocument();
  });

  it("edits to title/brand produce a patch containing only the changed fields", async () => {
    updatePublishedListingMock.mockResolvedValue({ outcome: "saved", listing: sampleState({ title: "New Title", brand: "Adidas" }), changed: true });
    renderEditor();

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "New Title" } });
    fireEvent.change(screen.getByLabelText(/brand/i), { target: { value: "Adidas" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(updatePublishedListingMock).toHaveBeenCalledWith("listing-1", "1", { title: "New Title", brand: "Adidas" }, null),
    );
  });

  it("passes the revision string unchanged, even at bigint scale, to updatePublishedListing", async () => {
    updatePublishedListingMock.mockResolvedValue({ outcome: "saved", listing: sampleState({ revision: "9007199254740993" }), changed: true });
    renderEditor({ initialState: sampleState({ revision: "9007199254740993" }) });

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "New Title" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(updatePublishedListingMock).toHaveBeenCalledWith("listing-1", "9007199254740993", expect.anything(), null));
  });

  it("a successful material save updates the held revision/baseline (notifying 'Changes saved' once), so a second no-op save sends no further RPC call and does not notify again", async () => {
    updatePublishedListingMock.mockResolvedValue({
      outcome: "saved",
      listing: sampleState({ title: "New Title", revision: "2" }),
      changed: true,
    });
    renderEditor();

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "New Title" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(notifySuccessMock).toHaveBeenCalledWith("Changes saved"));
    expect(notifySuccessMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
    expect(updatePublishedListingMock).toHaveBeenCalledTimes(1);

    // Same title as what was just saved -- no further edits -- Save again.
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText("No changes to save")).toBeInTheDocument();
    expect(updatePublishedListingMock).toHaveBeenCalledTimes(1);
    // The notification count must remain exactly what the first successful
    // save produced -- not reset to zero, and not incremented by the
    // second, no-op attempt.
    expect(notifySuccessMock).toHaveBeenCalledTimes(1);
  });
});

describe("PublishedListingEditor -- Paused", () => {
  it("allows Available quantity to be 0", async () => {
    updatePublishedListingMock.mockResolvedValue({
      outcome: "saved",
      listing: sampleState({ status: "paused", availableQuantity: 0 }),
      changed: true,
    });
    renderEditor({ initialState: sampleState({ status: "paused", availableQuantity: 1 }) });

    fireEvent.change(screen.getByLabelText("Available quantity"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(updatePublishedListingMock).toHaveBeenCalledWith("listing-1", "1", { available_quantity: 0 }, null),
    );
    expect(screen.queryByText(/available quantity must be at least/i)).not.toBeInTheDocument();
  });

  it("save works for a Paused listing and notifies 'Changes saved' exactly once", async () => {
    updatePublishedListingMock.mockResolvedValue({
      outcome: "saved",
      listing: sampleState({ status: "paused", title: "New Title" }),
      changed: true,
    });
    renderEditor({ initialState: sampleState({ status: "paused" }) });

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "New Title" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(notifySuccessMock).toHaveBeenCalledWith("Changes saved"));
    expect(notifySuccessMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
  });
});

describe("PublishedListingEditor -- Available quantity rules", () => {
  it("Available cannot submit a quantity of 0", async () => {
    renderEditor({ initialState: sampleState({ status: "available", availableQuantity: 1, images: [image()], coverImageId: "img-1" }) });

    fireEvent.change(screen.getByLabelText("Available quantity"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText("Available quantity must be at least 1.")).toBeInTheDocument();
    expect(updatePublishedListingMock).not.toHaveBeenCalled();
  });

  it("labels the field 'Available quantity', never 'Stock quantity'", () => {
    renderEditor();
    expect(screen.getByLabelText("Available quantity")).toBeInTheDocument();
    expect(screen.queryByLabelText(/stock quantity/i)).not.toBeInTheDocument();
  });

  it("quantity_editable: false disables the field and never sends available_quantity in the patch", async () => {
    updatePublishedListingMock.mockResolvedValue({ outcome: "saved", listing: sampleState({ title: "New Title" }), changed: true });
    renderEditor({ initialState: sampleState({ quantityEditable: false, availableQuantity: 3 }) });

    expect(screen.getByLabelText("Available quantity")).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "New Title" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(updatePublishedListingMock).toHaveBeenCalled());
    const patch = updatePublishedListingMock.mock.calls[0][2];
    expect(patch).not.toHaveProperty("available_quantity");
  });
});

describe("PublishedListingEditor -- no-op save", () => {
  it("shows a neutral 'No changes to save' state, never calls the RPC when nothing changed client-side, and does not notify", async () => {
    renderEditor();

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText("No changes to save")).toBeInTheDocument();
    expect(updatePublishedListingMock).not.toHaveBeenCalled();
    expect(notifySuccessMock).not.toHaveBeenCalled();
  });

  it("shows 'No changes to save' and does not notify when the RPC itself confirms no material change (changed: false)", async () => {
    updatePublishedListingMock.mockResolvedValue({
      outcome: "saved",
      listing: sampleState(),
      changed: false,
    });
    renderEditor();

    // A real client-side diff (quantity 5 -> 3) means the RPC is actually
    // called -- unlike the client short-circuit test above, it is the
    // server's own changed: false that determines the outcome here.
    fireEvent.change(screen.getByLabelText("Available quantity"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(updatePublishedListingMock).toHaveBeenCalled());
    expect(await screen.findByText("No changes to save")).toBeInTheDocument();
    expect(notifySuccessMock).not.toHaveBeenCalled();
  });
});

describe("PublishedListingEditor -- stale revision conflict", () => {
  it("shows a persistent conflict message and a Reload latest action, never a silent retry", async () => {
    updatePublishedListingMock.mockResolvedValue({ outcome: "stale_revision" });
    renderEditor();

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "New Title" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/this listing changed elsewhere/i);
    expect(screen.getByRole("button", { name: "Reload latest" })).toBeInTheDocument();
    expect(updatePublishedListingMock).toHaveBeenCalledTimes(1);
    expect(notifySuccessMock).not.toHaveBeenCalled();
  });

  it("disables Save changes while a stale conflict is unresolved -- no automatic retry", async () => {
    updatePublishedListingMock.mockResolvedValue({ outcome: "stale_revision" });
    renderEditor();

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "New Title" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await screen.findByRole("alert");
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    expect(updatePublishedListingMock).toHaveBeenCalledTimes(1);
  });

  it("Reload latest replaces the live form/revision with fresh server values, rather than rebasing the old edit", async () => {
    updatePublishedListingMock.mockResolvedValue({ outcome: "stale_revision" });
    getPublishedListingEditStateMock.mockResolvedValue({
      status: "found",
      listing: sampleState({ title: "Fresh Server Title", revision: "5" }),
    });
    renderEditor();

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "My Unsaved Edit" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByRole("alert");

    fireEvent.click(screen.getByRole("button", { name: "Reload latest" }));

    await waitFor(() => expect(screen.getByLabelText("Title")).toHaveValue("Fresh Server Title"));
    expect(screen.queryByText(/my unsaved edit/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    // The next save must use the freshly reloaded revision, not the stale one.
    updatePublishedListingMock.mockResolvedValue({ outcome: "saved", listing: sampleState({ title: "Fresh Server Title", revision: "6" }), changed: true });
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Second Edit" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(updatePublishedListingMock).toHaveBeenCalledWith("listing-1", "5", expect.anything(), null));
  });

  it("falls back to a full route refresh when Reload latest finds the listing no longer in an editable state", async () => {
    updatePublishedListingMock.mockResolvedValue({ outcome: "stale_revision" });
    getPublishedListingEditStateMock.mockResolvedValue({ status: "not_editable" });
    renderEditor();

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "My Unsaved Edit" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByRole("alert");

    fireEvent.click(screen.getByRole("button", { name: "Reload latest" }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("does not retry, upload, or modify any Storage object for a gallery change left pending by a stale conflict", async () => {
    uploadImageMock.mockResolvedValue({ ok: true, path: "listing-images/u1/listing-1/new.jpg" });
    updatePublishedListingMock.mockResolvedValue({ outcome: "stale_revision" });
    renderEditor({ initialState: sampleState({ images: [image()], coverImageId: "img-1" }) });

    selectFile();
    await waitFor(() => expect(uploadImageMock).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await screen.findByRole("alert");
    expect(updatePublishedListingMock).toHaveBeenCalledTimes(1);
    expect(uploadImageMock).toHaveBeenCalledTimes(1);
    expect(deleteUploadedImageMock).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  });
});

describe("PublishedListingEditor -- expected save failures", () => {
  it("maps a typed failure code to sanitized copy, never a raw Postgres message", async () => {
    updatePublishedListingMock.mockResolvedValue({ outcome: "failed", code: "INVALID_PUBLISHED_LISTING" });
    renderEditor();

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "New Title" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText("Please check the listing information.")).toBeInTheDocument();
  });

  it("offers a safe route-reload path when LISTING_NOT_EDITABLE occurs because status changed elsewhere", async () => {
    updatePublishedListingMock.mockResolvedValue({ outcome: "failed", code: "LISTING_NOT_EDITABLE" });
    renderEditor();

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "New Title" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText("This listing can't be edited right now.")).toBeInTheDocument();
    expect(notifySuccessMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Reload page" }));
    expect(refreshMock).toHaveBeenCalled();
  });

  it("handles NOT_LISTING_OWNER/LISTING_NOT_FOUND safely, without leaking existence/ownership details", async () => {
    updatePublishedListingMock.mockResolvedValue({ outcome: "failed", code: "LISTING_NOT_FOUND" });
    renderEditor();

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "New Title" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText("We couldn't find this listing. Please refresh and try again.")).toBeInTheDocument();
  });

  it("maps an unrecognized code to the generic UNKNOWN message, and never notifies success", async () => {
    updatePublishedListingMock.mockResolvedValue({ outcome: "failed", code: "UNKNOWN" });
    renderEditor();

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "New Title" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText("Something went wrong. Please try again.")).toBeInTheDocument();
    expect(notifySuccessMock).not.toHaveBeenCalled();
  });
});

describe("PublishedListingEditor -- restriction-aware INTERACTION_BLOCKED error (A2.2.2e)", () => {
  it("shows the generic edit message, the specific selling-access message, and a 'View account status' link when seller_suspended is confirmed", async () => {
    updatePublishedListingMock.mockResolvedValue({
      outcome: "failed",
      code: "INTERACTION_BLOCKED",
      restriction: { message: "Your selling access is currently suspended.", ctaLabel: "View account status", href: "/account#account-status" },
    });
    renderEditor();

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "New Title" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText("You are not able to edit listings right now.")).toBeInTheDocument();
    expect(screen.getByText("Your selling access is currently suspended.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View account status" })).toHaveAttribute("href", "/account#account-status");
  });

  it("shows the specific account-suspended message and link when account_suspended is confirmed", async () => {
    updatePublishedListingMock.mockResolvedValue({
      outcome: "failed",
      code: "INTERACTION_BLOCKED",
      restriction: { message: "Your account is currently suspended.", ctaLabel: "View account status", href: "/account#account-status" },
    });
    renderEditor();

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "New Title" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText("Your account is currently suspended.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View account status" })).toHaveAttribute("href", "/account#account-status");
  });

  it("shows only the existing generic message, with no link, for a generic INTERACTION_BLOCKED failure with no confirmed restriction", async () => {
    updatePublishedListingMock.mockResolvedValue({ outcome: "failed", code: "INTERACTION_BLOCKED" });
    renderEditor();

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "New Title" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText("You are not able to edit listings right now.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "View account status" })).not.toBeInTheDocument();
  });

  it("shows no Account-status link for a non-INTERACTION_BLOCKED failure (regression: LISTING_NOT_EDITABLE keeps its own Reload-page behavior, never restriction guidance)", async () => {
    updatePublishedListingMock.mockResolvedValue({ outcome: "failed", code: "LISTING_NOT_EDITABLE" });
    renderEditor();

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "New Title" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText("This listing can't be edited right now.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload page" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "View account status" })).not.toBeInTheDocument();
  });

  it("a stale restriction presentation from a prior failed save is cleared once the next attempt succeeds", async () => {
    updatePublishedListingMock.mockResolvedValueOnce({
      outcome: "failed",
      code: "INTERACTION_BLOCKED",
      restriction: { message: "Your selling access is currently suspended.", ctaLabel: "View account status", href: "/account#account-status" },
    });
    renderEditor();

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "New Title" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("Your selling access is currently suspended.")).toBeInTheDocument();
    expect(notifySuccessMock).not.toHaveBeenCalled();

    updatePublishedListingMock.mockResolvedValueOnce({ outcome: "saved", listing: sampleState({ title: "Newer Title" }), changed: true });
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Newer Title" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(notifySuccessMock).toHaveBeenCalledWith("Changes saved"));
    // Exactly one success toast total -- the earlier failed attempt must
    // never have contributed one.
    expect(notifySuccessMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
    expect(screen.queryByText("Your selling access is currently suspended.")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "View account status" })).not.toBeInTheDocument();
  });

  it("a stale restriction presentation from a prior failed save is replaced (not merged) by a later, different failure", async () => {
    updatePublishedListingMock.mockResolvedValueOnce({
      outcome: "failed",
      code: "INTERACTION_BLOCKED",
      restriction: { message: "Your selling access is currently suspended.", ctaLabel: "View account status", href: "/account#account-status" },
    });
    renderEditor();

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "New Title" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("Your selling access is currently suspended.")).toBeInTheDocument();

    updatePublishedListingMock.mockResolvedValueOnce({ outcome: "failed", code: "INVALID_PUBLISHED_LISTING" });
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Another Title" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText("Please check the listing information.")).toBeInTheDocument();
    expect(screen.queryByText("Your selling access is currently suspended.")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "View account status" })).not.toBeInTheDocument();
  });

});

describe("PublishedListingEditor -- vehicle/rental extensions", () => {
  it("renders vehicle fields for a Cars-category listing and includes vehicle_details in the patch when changed", async () => {
    updatePublishedListingMock.mockResolvedValue({ outcome: "saved", listing: sampleState({ categoryId: 2 }), changed: true });
    const { container } = renderEditor({ initialState: sampleState({ categoryId: 2, vehicleDetails: null }) });

    const vehicleModelInput = container.querySelector<HTMLInputElement>("#vehicle-model");
    expect(vehicleModelInput).not.toBeNull();
    fireEvent.change(vehicleModelInput!, { target: { value: "Vios" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(updatePublishedListingMock).toHaveBeenCalled());
    const patch = updatePublishedListingMock.mock.calls[0][2];
    expect(patch.vehicle_details).toMatchObject({ model: "Vios" });
  });

  it("does not render vehicle or rental fields for a non-eligible category", () => {
    renderEditor();
    expect(screen.queryByLabelText(/model/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/rental price/i)).not.toBeInTheDocument();
  });
});

describe("PublishedListingEditor -- published gallery", () => {
  it("renders the existing published gallery, with the current cover marked", () => {
    renderEditor({ initialState: sampleState({ images: [image(), image({ id: "img-2", storagePath: "listing-images/u1/listing-1/b.jpg", position: 1 })], coverImageId: "img-2" }) });

    expect(screen.getByText("2 of 8 photos")).toBeInTheDocument();
    expect(screen.getByText("Cover")).toBeInTheDocument();
  });

  it("uploading a new photo changes only the LOCAL gallery -- it never calls updatePublishedListing by itself", async () => {
    uploadImageMock.mockResolvedValue({ ok: true, path: "listing-images/u1/listing-1/new.jpg" });
    renderEditor({ initialState: sampleState({ images: [image()], coverImageId: "img-1" }) });

    selectFile();

    await waitFor(() => expect(screen.getByText("2 of 8 photos")).toBeInTheDocument());
    expect(uploadImageMock).toHaveBeenCalledWith("listing-images", "u1", "listing-1", expect.any(File), expect.any(Function));
    expect(updatePublishedListingMock).not.toHaveBeenCalled();
  });

  it("removing an existing image never calls deleteUploadedImage -- the underlying Storage object must survive", async () => {
    updatePublishedListingMock.mockResolvedValue({ outcome: "saved", listing: sampleState({ images: [], coverImageId: null }), changed: true });
    renderEditor({ initialState: sampleState({ images: [image()], coverImageId: "img-1" }) });

    fireEvent.click(screen.getByRole("button", { name: "Remove image 1" }));
    expect(screen.getByText("0 of 8 photos")).toBeInTheDocument();
    expect(deleteUploadedImageMock).not.toHaveBeenCalled();

    // Removing the only photo down to zero is allowed locally; only Save
    // enforces the minimum-1 rule (see the dedicated test below). Confirm
    // the removal itself never touched Storage even after a later save
    // attempt is blocked.
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByText("Add at least one photo before saving.");
    expect(deleteUploadedImageMock).not.toHaveBeenCalled();
  });

  it("removing a brand-new, never-saved upload also never calls deleteUploadedImage (orphans are accepted, cleaned up later)", async () => {
    uploadImageMock.mockResolvedValue({ ok: true, path: "listing-images/u1/listing-1/new.jpg" });
    renderEditor({ initialState: sampleState({ images: [image()], coverImageId: "img-1" }) });

    selectFile();
    await waitFor(() => expect(screen.getByText("2 of 8 photos")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Remove image 2" }));
    expect(screen.getByText("1 of 8 photos")).toBeInTheDocument();
    expect(deleteUploadedImageMock).not.toHaveBeenCalled();
  });

  it("reordering produces a payload whose array order matches the new order (position is array index, never a separate field)", async () => {
    updatePublishedListingMock.mockResolvedValue({ outcome: "saved", listing: sampleState(), changed: true });
    renderEditor({
      initialState: sampleState({
        images: [image(), image({ id: "img-2", storagePath: "listing-images/u1/listing-1/b.jpg", position: 1 })],
        coverImageId: "img-1",
      }),
    });

    fireEvent.click(screen.getByRole("button", { name: "Move image 1 right" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(updatePublishedListingMock).toHaveBeenCalled());
    const images = updatePublishedListingMock.mock.calls[0][3];
    expect(images).toEqual([
      { image_id: "img-2", is_reference_image: false, is_cover: false },
      { image_id: "img-1", is_reference_image: false, is_cover: true },
    ]);
  });

  it("Set as cover produces exactly one is_cover:true entry, wherever it is in the order", async () => {
    updatePublishedListingMock.mockResolvedValue({ outcome: "saved", listing: sampleState(), changed: true });
    renderEditor({
      initialState: sampleState({
        images: [image(), image({ id: "img-2", storagePath: "listing-images/u1/listing-1/b.jpg", position: 1 })],
        coverImageId: "img-1",
      }),
    });

    fireEvent.click(screen.getByRole("button", { name: "Set image 2 as cover" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(updatePublishedListingMock).toHaveBeenCalled());
    const images = updatePublishedListingMock.mock.calls[0][3] as { is_cover: boolean }[];
    expect(images.filter((entry) => entry.is_cover)).toHaveLength(1);
    expect(images[1].is_cover).toBe(true);
  });

  it("removing the current cover automatically reassigns cover to a remaining photo -- never zero covers", async () => {
    updatePublishedListingMock.mockResolvedValue({ outcome: "saved", listing: sampleState(), changed: true });
    renderEditor({
      initialState: sampleState({
        images: [image(), image({ id: "img-2", storagePath: "listing-images/u1/listing-1/b.jpg", position: 1 })],
        coverImageId: "img-1",
      }),
    });

    fireEvent.click(screen.getByRole("button", { name: "Remove image 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(updatePublishedListingMock).toHaveBeenCalled());
    const images = updatePublishedListingMock.mock.calls[0][3] as { image_id: string; is_cover: boolean }[];
    expect(images).toEqual([{ image_id: "img-2", is_reference_image: false, is_cover: true }]);
  });

  it("a gallery-only change sends an empty patch alongside the complete images array, in one call", async () => {
    updatePublishedListingMock.mockResolvedValue({ outcome: "saved", listing: sampleState(), changed: true });
    renderEditor({ initialState: sampleState({ images: [image()], coverImageId: "img-1" }) });

    uploadImageMock.mockResolvedValue({ ok: true, path: "listing-images/u1/listing-1/new.jpg" });
    selectFile();
    await waitFor(() => expect(screen.getByText("2 of 8 photos")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(updatePublishedListingMock).toHaveBeenCalled());
    const [, , patch, images] = updatePublishedListingMock.mock.calls[0];
    expect(patch).toEqual({});
    expect(images).not.toBeNull();
    expect(images).toHaveLength(2);
  });

  it("changing text fields AND the gallery together saves both in ONE atomic RPC call", async () => {
    updatePublishedListingMock.mockResolvedValue({ outcome: "saved", listing: sampleState(), changed: true });
    uploadImageMock.mockResolvedValue({ ok: true, path: "listing-images/u1/listing-1/new.jpg" });
    renderEditor({ initialState: sampleState({ images: [image()], coverImageId: "img-1" }) });

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "New Title" } });
    selectFile();
    await waitFor(() => expect(screen.getByText("2 of 8 photos")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(updatePublishedListingMock).toHaveBeenCalledTimes(1));
    const [, , patch, images] = updatePublishedListingMock.mock.calls[0];
    expect(patch).toEqual({ title: "New Title" });
    expect(images).toHaveLength(2);
  });

  it("an unchanged gallery keeps images: null even when other fields change", async () => {
    updatePublishedListingMock.mockResolvedValue({
      outcome: "saved",
      listing: sampleState({ title: "New Title", images: [image()], coverImageId: "img-1" }),
      changed: true,
    });
    renderEditor({ initialState: sampleState({ title: "Old Title", images: [image()], coverImageId: "img-1" }) });

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "New Title" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(updatePublishedListingMock).toHaveBeenCalledWith("listing-1", "1", { title: "New Title" }, null));
  });

  it("a successful gallery-inclusive atomic save notifies 'Changes saved' exactly once (not once per image), and an immediate second save with no further edits is a no-op with no further notification", async () => {
    uploadImageMock.mockResolvedValue({ ok: true, path: "listing-images/u1/listing-1/new.jpg" });
    const savedImages = [image(), image({ id: "img-2", storagePath: "listing-images/u1/listing-1/new.jpg", position: 1 })];
    updatePublishedListingMock.mockResolvedValue({
      outcome: "saved",
      listing: sampleState({ images: savedImages, coverImageId: "img-1", revision: "2" }),
      changed: true,
    });
    renderEditor({ initialState: sampleState({ images: [image()], coverImageId: "img-1" }) });

    selectFile();
    await waitFor(() => expect(screen.getByText("2 of 8 photos")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(notifySuccessMock).toHaveBeenCalledWith("Changes saved"));
    expect(notifySuccessMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
    expect(updatePublishedListingMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("No changes to save")).toBeInTheDocument();
    expect(updatePublishedListingMock).toHaveBeenCalledTimes(1);
    expect(notifySuccessMock).toHaveBeenCalledTimes(1);
  });

  it("enforces a maximum of 8 photos -- Add photo is unavailable at the cap", () => {
    const images = Array.from({ length: 8 }, (_, i) => image({ id: `img-${i}`, storagePath: `listing-images/u1/listing-1/${i}.jpg`, position: i }));
    renderEditor({ initialState: sampleState({ images, coverImageId: "img-0" }) });

    expect(screen.getByText("8 of 8 photos")).toBeInTheDocument();
    expect(screen.queryByLabelText("Add a listing photo")).not.toBeInTheDocument();
  });

  it("enforces a minimum of 1 photo -- Save is blocked with a friendly message when the gallery is emptied", async () => {
    renderEditor({ initialState: sampleState({ images: [image()], coverImageId: "img-1" }) });

    fireEvent.click(screen.getByRole("button", { name: "Remove image 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText("Add at least one photo before saving.")).toBeInTheDocument();
    expect(updatePublishedListingMock).not.toHaveBeenCalled();
  });

  it("two uploads always get distinct generated paths, so a duplicate path can never reach the save payload", async () => {
    uploadImageMock.mockResolvedValueOnce({ ok: true, path: "listing-images/u1/listing-1/one.jpg" });
    uploadImageMock.mockResolvedValueOnce({ ok: true, path: "listing-images/u1/listing-1/two.jpg" });
    updatePublishedListingMock.mockResolvedValue({ outcome: "saved", listing: sampleState(), changed: true });
    renderEditor({ initialState: sampleState({ images: [], coverImageId: null }) });

    selectFile("one.jpg");
    await waitFor(() => expect(screen.getByText("1 of 8 photos")).toBeInTheDocument());
    selectFile("two.jpg");
    await waitFor(() => expect(screen.getByText("2 of 8 photos")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(updatePublishedListingMock).toHaveBeenCalled());
    const images = updatePublishedListingMock.mock.calls[0][3] as { storage_path?: string }[];
    const paths = images.map((entry) => entry.storage_path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("a failed upload shows a sanitized message and is excluded from the save payload -- a failed-only 'change' still leaves the gallery unchanged", async () => {
    uploadImageMock.mockResolvedValue({ ok: false, code: "UPLOAD_FAILED" });
    updatePublishedListingMock.mockResolvedValue({ outcome: "saved", listing: sampleState({ title: "New Title" }), changed: true });
    renderEditor({ initialState: sampleState({ images: [image()], coverImageId: "img-1" }) });

    selectFile();

    expect(await screen.findByText("Upload failed. Please try again.")).toBeInTheDocument();
    expect(screen.queryByText(/postgres|23505/i)).not.toBeInTheDocument();

    // A failed upload alone never counts as a gallery change (it never
    // became "ready"), so pair it with a real text edit to prove that real
    // save still proceeds -- and that the failed upload is excluded from
    // the payload so thoroughly that `images` stays `null` entirely.
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "New Title" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(updatePublishedListingMock).toHaveBeenCalled());
    const [, , patch, images] = updatePublishedListingMock.mock.calls[0];
    expect(patch).toEqual({ title: "New Title" });
    expect(images).toBeNull();
  });

  it("Pre-loved: an existing reference-tagged photo blocks Save with a friendly message, even without touching the toggle", async () => {
    renderEditor({
      initialState: sampleState({
        listingType: "preloved",
        images: [image({ isReferenceImage: true })],
        coverImageId: "img-1",
      }),
    });

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(
      await screen.findByText(/pre-loved listings may only include actual-item photos/i),
    ).toBeInTheDocument();
    expect(updatePublishedListingMock).not.toHaveBeenCalled();
  });

  it("Brand New: a gallery with only reference photos blocks Save until at least one is marked Actual", async () => {
    renderEditor({
      initialState: sampleState({
        listingType: "brand_new",
        condition: "brand_new",
        images: [image({ isReferenceImage: true })],
        coverImageId: "img-1",
      }),
    });

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText(/brand new listings need at least one actual-item photo/i)).toBeInTheDocument();
    expect(updatePublishedListingMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Mark image 1 as actual item" }));
    updatePublishedListingMock.mockResolvedValue({ outcome: "saved", listing: sampleState(), changed: true });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(updatePublishedListingMock).toHaveBeenCalled());
  });

  it("Reload latest discards pending gallery changes together with pending text changes", async () => {
    uploadImageMock.mockResolvedValue({ ok: true, path: "listing-images/u1/listing-1/new.jpg" });
    updatePublishedListingMock.mockResolvedValue({ outcome: "stale_revision" });
    getPublishedListingEditStateMock.mockResolvedValue({
      status: "found",
      listing: sampleState({ images: [image({ id: "img-server", storagePath: "listing-images/u1/listing-1/server.jpg" })], coverImageId: "img-server", revision: "9" }),
    });
    renderEditor({ initialState: sampleState({ images: [image()], coverImageId: "img-1" }) });

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Unsaved Text Edit" } });
    selectFile();
    await waitFor(() => expect(screen.getByText("2 of 8 photos")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByRole("alert");

    fireEvent.click(screen.getByRole("button", { name: "Reload latest" }));

    await waitFor(() => expect(screen.getByText("1 of 8 photos")).toBeInTheDocument());
    expect(screen.getByLabelText("Title")).not.toHaveValue("Unsaved Text Edit");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("published gallery -- no Storage UPDATE/DELETE path", () => {
  it("PublishedListingEditor never imports deleteUploadedImage or any Storage update/remove helper", async () => {
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const source = readFileSync(path.join(process.cwd(), "components/seller/PublishedListingEditor.tsx"), "utf-8");
    // Checks the import line specifically (not bare prose) -- this file's
    // own header comment explains, in words, why deleteUploadedImage is
    // never called; that explanation must not itself trip this assertion.
    expect(source).not.toMatch(/import\s*\{[^}]*deleteUploadedImage/);
    expect(source).not.toMatch(/storage\s*\.\s*(update|remove)/i);
    expect(source).not.toMatch(/\.upload\(/); // uploadImage (the shared helper) is used, never a raw insert/upsert call
  });
});
