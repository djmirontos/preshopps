import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";

const { pushMock, refreshMock, getPublishedListingEditStateMock, updatePublishedListingMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  refreshMock: vi.fn(),
  getPublishedListingEditStateMock: vi.fn(),
  updatePublishedListingMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

vi.mock("@/lib/seller/published-listing-actions", async () => {
  const actual = await vi.importActual<typeof import("@/lib/seller/published-listing-actions")>("@/lib/seller/published-listing-actions");
  return {
    ...actual,
    getPublishedListingEditState: getPublishedListingEditStateMock,
    updatePublishedListing: updatePublishedListingMock,
  };
});

import { PublishedListingEditor } from "@/components/seller/PublishedListingEditor";
import type { PublishedListingEditState } from "@/lib/seller/published-listing-actions";

const CATEGORIES = [
  { id: 1, slug: "women", name: "Women" },
  { id: 2, slug: "cars", name: "Cars" },
  { id: 3, slug: "for-rent", name: "For Rent" },
];
const PROVINCES = [{ id: 1, name: "Misamis Occidental" }];
const CITIES = [{ id: 10, name: "Tangub City" }];
const BARANGAYS = [{ id: 100, name: "Barangay Uno" }];

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
    images: [],
    vehicleDetails: null,
    rentalDetails: null,
    revision: "1",
    availableQuantity: 5,
    reservedQuantity: 0,
    coverImageId: null,
    quantityEditable: true,
    ...overrides,
  };
}

function renderEditor(overrides: Partial<ComponentProps<typeof PublishedListingEditor>> = {}) {
  return render(
    <PublishedListingEditor
      listingId="listing-1"
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

beforeEach(() => {
  vi.clearAllMocks();
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

  it("always sends images: null -- this step never mutates the gallery", async () => {
    updatePublishedListingMock.mockResolvedValue({ outcome: "saved", listing: sampleState({ title: "New Title" }), changed: true });
    renderEditor();

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "New Title" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(updatePublishedListingMock).toHaveBeenCalled());
    expect(updatePublishedListingMock.mock.calls[0][3]).toBeNull();
  });

  it("renders no file input or other image-mutation control", () => {
    const { container } = renderEditor();
    expect(container.querySelector('input[type="file"]')).toBeNull();
  });

  it("a successful material save updates the held revision/baseline, so a second no-op save sends no further RPC call", async () => {
    updatePublishedListingMock.mockResolvedValue({
      outcome: "saved",
      listing: sampleState({ title: "New Title", revision: "2" }),
      changed: true,
    });
    renderEditor();

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "New Title" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText("Saved")).toBeInTheDocument();
    expect(updatePublishedListingMock).toHaveBeenCalledTimes(1);

    // Same title as what was just saved -- no further edits -- Save again.
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText("No changes to save")).toBeInTheDocument();
    expect(updatePublishedListingMock).toHaveBeenCalledTimes(1);
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

  it("save works for a Paused listing", async () => {
    updatePublishedListingMock.mockResolvedValue({
      outcome: "saved",
      listing: sampleState({ status: "paused", title: "New Title" }),
      changed: true,
    });
    renderEditor({ initialState: sampleState({ status: "paused" }) });

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "New Title" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText("Saved")).toBeInTheDocument();
  });
});

describe("PublishedListingEditor -- Available quantity rules", () => {
  it("Available cannot submit a quantity of 0", async () => {
    renderEditor({ initialState: sampleState({ status: "available", availableQuantity: 1 }) });

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
  it("shows a neutral 'No changes to save' state and never calls the RPC when nothing changed", async () => {
    renderEditor();

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText("No changes to save")).toBeInTheDocument();
    expect(updatePublishedListingMock).not.toHaveBeenCalled();
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

  it("maps an unrecognized code to the generic UNKNOWN message", async () => {
    updatePublishedListingMock.mockResolvedValue({ outcome: "failed", code: "UNKNOWN" });
    renderEditor();

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "New Title" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText("Something went wrong. Please try again.")).toBeInTheDocument();
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
