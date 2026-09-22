import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// This file closes a previously-real test-infrastructure gap: no test
// anywhere rendered ListingForm and PublishListingButton together, wired
// through the real ListingFormWithPublish composition (isDirty passed
// from the form to the button), the way the actual seller edit page does.
// That gap is exactly why the Brand New publication blocker (a legacy
// Draft with a NULL condition failing CONDITION_REQUIRED on Publish, with
// no update_listing call ever in between) went uncaught: a Publish-button
// test that only mocks publishListing as successful can't prove anything
// about whether the surrounding form ever put the listing into a
// publishable shape, or whether Publish is reachable at all without an
// intervening Save Draft.

const { pushMock, createListingMock, updateListingMock, publishListingMock, acceptSellerPoliciesMock, notifySuccessMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  createListingMock: vi.fn(),
  updateListingMock: vi.fn(),
  publishListingMock: vi.fn(),
  acceptSellerPoliciesMock: vi.fn(),
  notifySuccessMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
}));

vi.mock("@/lib/seller/listing-actions", async () => {
  const actual = await vi.importActual<typeof import("@/lib/seller/listing-actions")>("@/lib/seller/listing-actions");
  return {
    ...actual,
    createListing: createListingMock,
    updateListing: updateListingMock,
    publishListing: publishListingMock,
    acceptSellerPolicies: acceptSellerPoliciesMock,
  };
});

vi.mock("@/lib/notifications/toast", () => ({
  notifySuccess: notifySuccessMock,
}));

import { ListingFormWithPublish } from "@/components/seller/ListingFormWithPublish";
import type { ListingFieldValues } from "@/components/seller/ListingForm";
import { EMPTY_VEHICLE_VALUES } from "@/components/seller/ListingVehicleFields";
import { EMPTY_RENTAL_VALUES } from "@/components/seller/ListingRentalFields";

const CATEGORIES = [{ id: 1, slug: "women", name: "Women" }];
const PROVINCES = [{ id: 1, name: "Misamis Occidental" }];

const EMPTY_VALUES: ListingFieldValues = {
  title: "Existing Title",
  description: "A description",
  categoryId: 1,
  listingType: null,
  condition: null,
  priceCents: 5000,
  originalPriceCents: null,
  isNegotiable: false,
  brand: null,
  knownFlaws: null,
  stockQuantity: 1,
  meetupNote: null,
  fulfillmentMethods: ["meetup"],
};

function renderWithPublish(overrides: Partial<React.ComponentProps<typeof ListingFormWithPublish>> = {}) {
  return render(
    <ListingFormWithPublish
      listingId="listing-1"
      listingStatus="draft"
      categories={CATEGORIES}
      provinces={PROVINCES}
      initialCities={[]}
      initialBarangays={[]}
      loadCities={vi.fn().mockResolvedValue([])}
      loadBarangays={vi.fn().mockResolvedValue([])}
      initialLocation={{ provinceId: 1, cityId: null, barangayId: null }}
      initialValues={EMPTY_VALUES}
      initialVehicleDetails={EMPTY_VEHICLE_VALUES}
      initialRentalDetails={EMPTY_RENTAL_VALUES}
      {...overrides}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ListingFormWithPublish -- legacy Brand New Draft with a NULL condition (the exact bug this suite exists to prevent)", () => {
  it("renders Publish already enabled on load, with no edit required, for an existing Brand New Draft saved before condition auto-assignment existed", () => {
    renderWithPublish({ initialValues: { ...EMPTY_VALUES, listingType: "brand_new", condition: null } });

    expect(screen.getByRole("button", { name: "Publish Listing" })).toBeEnabled();
    expect(screen.queryByText(/save your draft changes before publishing/i)).not.toBeInTheDocument();
  });

  it("clicking Publish immediately calls publish_listing directly -- no update_listing/create_listing call precedes it", async () => {
    publishListingMock.mockResolvedValue({ ok: true, listingId: "listing-1", publicCode: "PSL-ABC", slug: "x", status: "available", publishedAt: "now" });
    renderWithPublish({ initialValues: { ...EMPTY_VALUES, listingType: "brand_new", condition: null } });

    fireEvent.click(screen.getByRole("button", { name: "Publish Listing" }));

    await waitFor(() => expect(publishListingMock).toHaveBeenCalledWith("listing-1"));
    expect(updateListingMock).not.toHaveBeenCalled();
    expect(createListingMock).not.toHaveBeenCalled();
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/item/PSL-ABC"));
  });

  it("does not show a Condition select for the loaded Brand New Draft, and shows the auto-assignment note instead", () => {
    renderWithPublish({ initialValues: { ...EMPTY_VALUES, listingType: "brand_new", condition: null } });

    expect(screen.queryByLabelText(/^condition/i)).not.toBeInTheDocument();
    expect(screen.getByText(/automatically use Brand New condition/i)).toBeInTheDocument();
  });
});

describe("ListingFormWithPublish -- isDirty bridging still works correctly around the Brand New fix", () => {
  it("a real edit after loading a legacy null-condition Brand New Draft disables Publish until Save Draft runs", async () => {
    updateListingMock.mockResolvedValue({ ok: true, listingId: "listing-1", publicCode: "PSL-ABC", slug: "x", status: "draft", updatedAt: "now" });
    renderWithPublish({ initialValues: { ...EMPTY_VALUES, listingType: "brand_new", condition: null } });

    expect(screen.getByRole("button", { name: "Publish Listing" })).toBeEnabled();

    fireEvent.change(screen.getByLabelText(/brand/i), { target: { value: "Nike" } });
    expect(screen.getByRole("button", { name: "Publish Listing" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Publish Listing" })).toBeEnabled());
  });

  it("switching listing type from Pre-loved to Brand New marks the form dirty, blocking Publish until saved", async () => {
    updateListingMock.mockResolvedValue({ ok: true, listingId: "listing-1", publicCode: "PSL-ABC", slug: "x", status: "draft", updatedAt: "now" });
    renderWithPublish({ initialValues: { ...EMPTY_VALUES, listingType: "preloved", condition: "good" } });

    expect(screen.getByRole("button", { name: "Publish Listing" })).toBeEnabled();

    fireEvent.change(screen.getByLabelText(/listing type/i), { target: { value: "brand_new" } });
    expect(screen.getByRole("button", { name: "Publish Listing" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));
    await waitFor(() =>
      expect(updateListingMock).toHaveBeenCalledWith("listing-1", { listing_type: "brand_new", condition: "brand_new" }),
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "Publish Listing" })).toBeEnabled());
  });
});

describe("ListingFormWithPublish -- an ordinary, already-valid Draft is unaffected", () => {
  it("a Pre-loved Draft with a real condition already set publishes with no surprises", async () => {
    publishListingMock.mockResolvedValue({ ok: true, listingId: "listing-1", publicCode: "PSL-ABC", slug: "x", status: "available", publishedAt: "now" });
    renderWithPublish({ initialValues: { ...EMPTY_VALUES, listingType: "preloved", condition: "good" } });

    fireEvent.click(screen.getByRole("button", { name: "Publish Listing" }));

    await waitFor(() => expect(publishListingMock).toHaveBeenCalledWith("listing-1"));
    expect(updateListingMock).not.toHaveBeenCalled();
  });
});
