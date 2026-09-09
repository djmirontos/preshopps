import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { pushMock, refreshMock, createListingMock, updateListingMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  refreshMock: vi.fn(),
  createListingMock: vi.fn(),
  updateListingMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

vi.mock("@/lib/seller/listing-actions", async () => {
  const actual = await vi.importActual<typeof import("@/lib/seller/listing-actions")>("@/lib/seller/listing-actions");
  return {
    ...actual,
    createListing: createListingMock,
    updateListing: updateListingMock,
  };
});

import { ListingForm, type ListingFieldValues } from "@/components/seller/ListingForm";
import { EMPTY_VEHICLE_VALUES } from "@/components/seller/ListingVehicleFields";
import { EMPTY_RENTAL_VALUES } from "@/components/seller/ListingRentalFields";

const CATEGORIES = [
  { id: 1, slug: "women", name: "Women" },
  { id: 2, slug: "cars", name: "Cars" },
  { id: 3, slug: "motorcycles", name: "Motorcycles" },
  { id: 4, slug: "for-rent", name: "For Rent" },
];
const PROVINCES = [{ id: 1, name: "Misamis Occidental" }];
const CITIES = [{ id: 10, name: "Tangub City" }];
const BARANGAYS = [{ id: 100, name: "Barangay Uno" }];

const EMPTY_VALUES: ListingFieldValues = {
  title: "Existing Title",
  description: null,
  categoryId: null,
  listingType: null,
  condition: null,
  priceCents: null,
  originalPriceCents: null,
  isNegotiable: false,
  brand: null,
  knownFlaws: null,
  stockQuantity: 1,
  meetupNote: null,
  fulfillmentMethods: [],
};

function renderForm(overrides: Partial<React.ComponentProps<typeof ListingForm>> = {}) {
  return render(
    <ListingForm
      mode="create"
      categories={CATEGORIES}
      provinces={PROVINCES}
      initialCities={[]}
      initialBarangays={[]}
      loadCities={vi.fn().mockResolvedValue(CITIES)}
      loadBarangays={vi.fn().mockResolvedValue(BARANGAYS)}
      {...overrides}
    />,
  );
}

function renderEditForm(overrides: Partial<React.ComponentProps<typeof ListingForm>> = {}) {
  return render(
    <ListingForm
      mode="edit"
      listingId="listing-1"
      categories={CATEGORIES}
      provinces={PROVINCES}
      initialCities={[]}
      initialBarangays={[]}
      loadCities={vi.fn().mockResolvedValue(CITIES)}
      loadBarangays={vi.fn().mockResolvedValue(BARANGAYS)}
      initialValues={EMPTY_VALUES}
      {...overrides}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ListingForm -- create mode", () => {
  it("requires only a title -- no RPC call when title is blank", async () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));

    expect(await screen.findByText("Please enter a title for your listing.")).toBeInTheDocument();
    expect(createListingMock).not.toHaveBeenCalled();
  });

  it("submits a title-only Draft with every optional field sent as null/empty", async () => {
    createListingMock.mockResolvedValue({ ok: true, listingId: "listing-1", publicCode: "PSL-ABC", slug: "my-item", status: "draft", createdAt: "2026-01-01T00:00:00.000Z" });
    renderForm();

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Nike Air Max 270" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));

    await waitFor(() =>
      expect(createListingMock).toHaveBeenCalledWith({
        title: "Nike Air Max 270",
        description: null,
        categoryId: null,
        listingType: null,
        condition: null,
        priceCents: null,
        originalPriceCents: null,
        isNegotiable: false,
        brand: null,
        knownFlaws: null,
        stockQuantity: 1,
        provinceId: null,
        cityId: null,
        barangayId: null,
        meetupNote: null,
        fulfillmentMethods: [],
        vehicleDetails: null,
        rentalDetails: null,
      }),
    );
  });

  it("redirects to /sell/{listingId}/edit on successful save", async () => {
    createListingMock.mockResolvedValue({ ok: true, listingId: "listing-42", publicCode: "PSL-XYZ", slug: "my-item", status: "draft", createdAt: "2026-01-01T00:00:00.000Z" });
    renderForm();

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Something" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/sell/listing-42/edit"));
  });

  it("converts pesos to integer cents without floating-point drift", async () => {
    createListingMock.mockResolvedValue({ ok: true, listingId: "listing-1", publicCode: "PSL-ABC", slug: "x", status: "draft", createdAt: "now" });
    renderForm();

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Item" } });
    fireEvent.change(screen.getByLabelText(/^price \(optional\)/i), { target: { value: "19.99" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));

    await waitFor(() => expect(createListingMock).toHaveBeenCalledWith(expect.objectContaining({ priceCents: 1999 })));
  });

  it("accepts ₱0 as a valid price", async () => {
    createListingMock.mockResolvedValue({ ok: true, listingId: "listing-1", publicCode: "PSL-ABC", slug: "x", status: "draft", createdAt: "now" });
    renderForm();

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Item" } });
    fireEvent.change(screen.getByLabelText(/^price \(optional\)/i), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));

    await waitFor(() => expect(createListingMock).toHaveBeenCalledWith(expect.objectContaining({ priceCents: 0 })));
  });

  it("rejects a malformed price client-side, before ever calling create_listing", async () => {
    renderForm();
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Item" } });
    fireEvent.change(screen.getByLabelText(/^price \(optional\)/i), { target: { value: "abc" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));

    expect(await screen.findByText("Please enter a valid price.")).toBeInTheDocument();
    expect(createListingMock).not.toHaveBeenCalled();
  });

  it("rejects an original price lower than price client-side, before calling create_listing", async () => {
    renderForm();
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Item" } });
    fireEvent.change(screen.getByLabelText(/^price \(optional\)/i), { target: { value: "100" } });
    fireEvent.change(screen.getByLabelText(/original price/i), { target: { value: "50" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));

    expect(await screen.findByText("Original price must not be lower than the current price.")).toBeInTheDocument();
    expect(createListingMock).not.toHaveBeenCalled();
  });

  it("surfaces a server-side ORIGINAL_PRICE_INVALID rejection clearly", async () => {
    createListingMock.mockResolvedValue({ ok: false, code: "ORIGINAL_PRICE_INVALID" });
    renderForm();

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Item" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));

    expect(await screen.findByText("Original price must not be lower than the current price.")).toBeInTheDocument();
  });

  it("maps an unknown/other server error code to safe generic copy", async () => {
    createListingMock.mockResolvedValue({ ok: false, code: "SHOP_NOT_FOUND" });
    renderForm();

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Item" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));

    expect(await screen.findByText("Please set up your shop first.")).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("does not require a fulfillment method -- empty selection is valid for Draft", async () => {
    createListingMock.mockResolvedValue({ ok: true, listingId: "listing-1", publicCode: "PSL-ABC", slug: "x", status: "draft", createdAt: "now" });
    renderForm();

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Item" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));

    await waitFor(() => expect(createListingMock).toHaveBeenCalledWith(expect.objectContaining({ fulfillmentMethods: [] })));
  });

  it("submits the checked fulfillment methods", async () => {
    createListingMock.mockResolvedValue({ ok: true, listingId: "listing-1", publicCode: "PSL-ABC", slug: "x", status: "draft", createdAt: "now" });
    renderForm();

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Item" } });
    fireEvent.click(screen.getByLabelText("Meetup"));
    fireEvent.click(screen.getByLabelText("Shipping"));
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));

    await waitFor(() =>
      expect(createListingMock).toHaveBeenCalledWith(expect.objectContaining({ fulfillmentMethods: ["meetup", "shipping"] })),
    );
  });

  it("shows the meetup note field only once Meetup is checked", () => {
    renderForm();
    expect(screen.queryByLabelText(/meetup note/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Meetup"));
    expect(screen.getByLabelText(/meetup note/i)).toBeInTheDocument();
  });

  it("does not force a condition value when listing type is Brand New -- the condition select is replaced with an explanatory note, not an auto-filled value", () => {
    renderForm();
    fireEvent.change(screen.getByLabelText(/listing type/i), { target: { value: "brand_new" } });
    expect(screen.queryByLabelText(/^condition/i)).not.toBeInTheDocument();
    expect(screen.getByText(/set automatically when you publish/i)).toBeInTheDocument();
  });

  it("saves a Draft with listing type Brand New and condition left null (backend permits this pairing)", async () => {
    createListingMock.mockResolvedValue({ ok: true, listingId: "listing-1", publicCode: "PSL-ABC", slug: "x", status: "draft", createdAt: "now" });
    renderForm();

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Item" } });
    fireEvent.change(screen.getByLabelText(/listing type/i), { target: { value: "brand_new" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));

    await waitFor(() =>
      expect(createListingMock).toHaveBeenCalledWith(expect.objectContaining({ listingType: "brand_new", condition: null })),
    );
  });

  it("clears an existing preloved condition when switching listing type to Brand New, avoiding a doomed mismatched pair -- without setting any new value", async () => {
    createListingMock.mockResolvedValue({ ok: true, listingId: "listing-1", publicCode: "PSL-ABC", slug: "x", status: "draft", createdAt: "now" });
    renderForm();

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Item" } });
    fireEvent.change(screen.getByLabelText(/listing type/i), { target: { value: "preloved" } });
    fireEvent.change(screen.getByLabelText(/^condition/i), { target: { value: "good" } });
    fireEvent.change(screen.getByLabelText(/listing type/i), { target: { value: "brand_new" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));

    await waitFor(() =>
      expect(createListingMock).toHaveBeenCalledWith(expect.objectContaining({ listingType: "brand_new", condition: null })),
    );
  });

  it("Fair condition does NOT require known flaws to Save Draft -- title remains the only required field", async () => {
    createListingMock.mockResolvedValue({ ok: true, listingId: "listing-1", publicCode: "PSL-ABC", slug: "x", status: "draft", createdAt: "now" });
    renderForm();

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Item" } });
    fireEvent.change(screen.getByLabelText(/listing type/i), { target: { value: "preloved" } });
    fireEvent.change(screen.getByLabelText(/^condition/i), { target: { value: "fair" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));

    expect(screen.queryByText(/please describe the known flaws/i)).not.toBeInTheDocument();
    await waitFor(() =>
      expect(createListingMock).toHaveBeenCalledWith(expect.objectContaining({ condition: "fair", knownFlaws: null })),
    );
  });

  it("still shows the known-flaws field for Fair, with copy noting it becomes required before publishing -- no Publish validation leaks into Save Draft", () => {
    renderForm();
    fireEvent.change(screen.getByLabelText(/listing type/i), { target: { value: "preloved" } });
    fireEvent.change(screen.getByLabelText(/^condition/i), { target: { value: "fair" } });

    expect(screen.getByLabelText(/known flaws/i)).toBeInTheDocument();
    expect(screen.getByText(/required before publishing/i)).toBeInTheDocument();
  });

  it("submits known flaws once supplied for Fair condition", async () => {
    createListingMock.mockResolvedValue({ ok: true, listingId: "listing-1", publicCode: "PSL-ABC", slug: "x", status: "draft", createdAt: "now" });
    renderForm();

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Item" } });
    fireEvent.change(screen.getByLabelText(/listing type/i), { target: { value: "preloved" } });
    fireEvent.change(screen.getByLabelText(/^condition/i), { target: { value: "fair" } });
    fireEvent.change(screen.getByLabelText(/known flaws/i), { target: { value: "Small scratch on the back." } });
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));

    await waitFor(() =>
      expect(createListingMock).toHaveBeenCalledWith(expect.objectContaining({ condition: "fair", knownFlaws: "Small scratch on the back." })),
    );
  });

  it("prefills location from the initial value (e.g. the seller's shop)", () => {
    renderForm({
      initialCities: CITIES,
      initialBarangays: [],
      initialLocation: { provinceId: 1, cityId: 10, barangayId: null },
    });

    expect(screen.getByLabelText("Province")).toHaveValue("1");
    expect(screen.getByLabelText("City / Municipality")).toHaveValue("10");
  });

  it("lets the seller change the prefilled location before saving", async () => {
    createListingMock.mockResolvedValue({ ok: true, listingId: "listing-1", publicCode: "PSL-ABC", slug: "x", status: "draft", createdAt: "now" });
    const loadCities = vi.fn().mockResolvedValue([{ id: 20, name: "Ozamiz City" }]);
    renderForm({
      initialCities: CITIES,
      initialBarangays: [],
      initialLocation: { provinceId: 1, cityId: 10, barangayId: null },
      loadCities,
    });

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Item" } });
    fireEvent.change(screen.getByLabelText("Province"), { target: { value: "1" } });
    await waitFor(() => expect(screen.getByRole("option", { name: "Ozamiz City" })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("City / Municipality"), { target: { value: "20" } });

    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));

    await waitFor(() => expect(createListingMock).toHaveBeenCalledWith(expect.objectContaining({ provinceId: 1, cityId: 20 })));
  });

  it("submits optional text fields trimmed, and blank as null", async () => {
    createListingMock.mockResolvedValue({ ok: true, listingId: "listing-1", publicCode: "PSL-ABC", slug: "x", status: "draft", createdAt: "now" });
    renderForm();

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "  Item  " } });
    fireEvent.change(screen.getByLabelText(/description/i), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));

    await waitFor(() =>
      expect(createListingMock).toHaveBeenCalledWith(expect.objectContaining({ title: "Item", description: null })),
    );
  });

  it("never writes to a database table directly -- only the create_listing RPC wrapper is called", async () => {
    createListingMock.mockResolvedValue({ ok: true, listingId: "listing-1", publicCode: "PSL-ABC", slug: "x", status: "draft", createdAt: "now" });
    renderForm();

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Item" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));

    await waitFor(() => expect(createListingMock).toHaveBeenCalledTimes(1));
  });

  it("renders no Publish button, no image picker, and no vehicle/rental fields in this slice", () => {
    renderForm();
    expect(screen.queryByRole("button", { name: /publish/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/upload.*photo/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/mileage/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/rental price/i)).not.toBeInTheDocument();
  });

  it("uses a single-column layout with every field individually labeled for mobile/basic accessibility", () => {
    renderForm();
    expect(screen.getByLabelText("Title")).toBeInTheDocument();
    expect(screen.getByLabelText(/description/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^price \(optional\)/i)).toBeInTheDocument();
    const submit = screen.getByRole("button", { name: "Save Draft" });
    expect(submit.className).toContain("h-11");
  });
});

describe("ListingForm -- edit mode: patch-diff semantics", () => {
  it("prefills every field from initialValues", () => {
    renderEditForm({
      initialValues: { ...EMPTY_VALUES, title: "Nike Air Max 270", description: "Great shoes", brand: "Nike", stockQuantity: 3 },
    });

    expect(screen.getByLabelText("Title")).toHaveValue("Nike Air Max 270");
    expect(screen.getByLabelText(/description/i)).toHaveValue("Great shoes");
    expect(screen.getByLabelText(/brand/i)).toHaveValue("Nike");
    expect(screen.getByLabelText(/stock quantity/i)).toHaveValue("3");
  });

  it("does not call update_listing when nothing changed -- shows 'No changes to save' instead, and never refreshes", async () => {
    renderEditForm();
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));

    expect(await screen.findByText("No changes to save")).toBeInTheDocument();
    expect(updateListingMock).not.toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("sends only the changed field in the patch, omitting every untouched key", async () => {
    updateListingMock.mockResolvedValue({ ok: true, listingId: "listing-1", publicCode: "PSL-ABC", slug: "x", status: "draft", updatedAt: "now" });
    renderEditForm();

    fireEvent.change(screen.getByLabelText(/brand/i), { target: { value: "Adidas" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));

    await waitFor(() => expect(updateListingMock).toHaveBeenCalledWith("listing-1", { brand: "Adidas" }));
  });

  it("sends an explicit null when a previously-set nullable field is cleared", async () => {
    updateListingMock.mockResolvedValue({ ok: true, listingId: "listing-1", publicCode: "PSL-ABC", slug: "x", status: "draft", updatedAt: "now" });
    renderEditForm({ initialValues: { ...EMPTY_VALUES, brand: "Nike" } });

    fireEvent.change(screen.getByLabelText(/brand/i), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));

    await waitFor(() => expect(updateListingMock).toHaveBeenCalledWith("listing-1", { brand: null }));
  });

  it("sends a changed price as cents, and omits price entirely when unchanged", async () => {
    updateListingMock.mockResolvedValue({ ok: true, listingId: "listing-1", publicCode: "PSL-ABC", slug: "x", status: "draft", updatedAt: "now" });
    renderEditForm({ initialValues: { ...EMPTY_VALUES, priceCents: 1000 } });

    fireEvent.change(screen.getByLabelText(/^price \(optional\)/i), { target: { value: "19.99" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));

    await waitFor(() => expect(updateListingMock).toHaveBeenCalledWith("listing-1", { price_cents: 1999 }));
  });

  it("clears a previously-set price back to null when blanked", async () => {
    updateListingMock.mockResolvedValue({ ok: true, listingId: "listing-1", publicCode: "PSL-ABC", slug: "x", status: "draft", updatedAt: "now" });
    renderEditForm({ initialValues: { ...EMPTY_VALUES, priceCents: 1999 } });

    expect(screen.getByLabelText(/^price \(optional\)/i)).toHaveValue("19.99");
    fireEvent.change(screen.getByLabelText(/^price \(optional\)/i), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));

    await waitFor(() => expect(updateListingMock).toHaveBeenCalledWith("listing-1", { price_cents: null }));
  });

  it("an unchanged blank price is omitted from the patch entirely", async () => {
    updateListingMock.mockResolvedValue({ ok: true, listingId: "listing-1", publicCode: "PSL-ABC", slug: "x", status: "draft", updatedAt: "now" });
    renderEditForm();

    fireEvent.change(screen.getByLabelText(/brand/i), { target: { value: "Something" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));

    await waitFor(() => expect(updateListingMock).toHaveBeenCalledWith("listing-1", { brand: "Something" }));
    const [, patch] = updateListingMock.mock.calls[0];
    expect(patch).not.toHaveProperty("price_cents");
  });

  it("preserves the original-price relational error using the current values", async () => {
    renderEditForm({ initialValues: { ...EMPTY_VALUES, priceCents: 1000 } });

    fireEvent.change(screen.getByLabelText(/original price/i), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));

    expect(await screen.findByText("Original price must not be lower than the current price.")).toBeInTheDocument();
    expect(updateListingMock).not.toHaveBeenCalled();
  });

  it("title cannot be cleared -- blanking it blocks Save Draft client-side", async () => {
    renderEditForm();

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));

    expect(await screen.findByText("Please enter a title for your listing.")).toBeInTheDocument();
    expect(updateListingMock).not.toHaveBeenCalled();
  });

  it("stock quantity cannot be blanked in edit mode -- a blank field is invalid, not 'leave unchanged'", async () => {
    renderEditForm({ initialValues: { ...EMPTY_VALUES, stockQuantity: 5 } });

    fireEvent.change(screen.getByLabelText(/stock quantity/i), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));

    expect(await screen.findByText("Stock quantity must be at least 1.")).toBeInTheDocument();
    expect(updateListingMock).not.toHaveBeenCalled();
  });

  it("sends a changed stock quantity", async () => {
    updateListingMock.mockResolvedValue({ ok: true, listingId: "listing-1", publicCode: "PSL-ABC", slug: "x", status: "draft", updatedAt: "now" });
    renderEditForm({ initialValues: { ...EMPTY_VALUES, stockQuantity: 5 } });

    fireEvent.change(screen.getByLabelText(/stock quantity/i), { target: { value: "8" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));

    await waitFor(() => expect(updateListingMock).toHaveBeenCalledWith("listing-1", { stock_quantity: 8 }));
  });

  it("fulfillment methods unchanged: omitted from the patch", async () => {
    updateListingMock.mockResolvedValue({ ok: true, listingId: "listing-1", publicCode: "PSL-ABC", slug: "x", status: "draft", updatedAt: "now" });
    renderEditForm({ initialValues: { ...EMPTY_VALUES, fulfillmentMethods: ["meetup"], brand: "changed-anchor" } });

    fireEvent.change(screen.getByLabelText(/brand/i), { target: { value: "Something else" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));

    await waitFor(() => expect(updateListingMock).toHaveBeenCalled());
    const [, patch] = updateListingMock.mock.calls[0];
    expect(patch).not.toHaveProperty("fulfillment_methods");
  });

  it("fulfillment methods changed to empty: sends an explicit empty array", async () => {
    updateListingMock.mockResolvedValue({ ok: true, listingId: "listing-1", publicCode: "PSL-ABC", slug: "x", status: "draft", updatedAt: "now" });
    renderEditForm({ initialValues: { ...EMPTY_VALUES, fulfillmentMethods: ["meetup"] } });

    fireEvent.click(screen.getByLabelText("Meetup"));
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));

    await waitFor(() => expect(updateListingMock).toHaveBeenCalledWith("listing-1", { fulfillment_methods: [] }));
  });

  it("fulfillment methods replaced with a new selection: sends the new array", async () => {
    updateListingMock.mockResolvedValue({ ok: true, listingId: "listing-1", publicCode: "PSL-ABC", slug: "x", status: "draft", updatedAt: "now" });
    renderEditForm({ initialValues: { ...EMPTY_VALUES, fulfillmentMethods: ["meetup"] } });

    fireEvent.click(screen.getByLabelText("Shipping"));
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));

    await waitFor(() =>
      expect(updateListingMock).toHaveBeenCalledWith("listing-1", { fulfillment_methods: expect.arrayContaining(["meetup", "shipping"]) }),
    );
  });

  it("clearing barangay alone sends only barangay_id: null", async () => {
    updateListingMock.mockResolvedValue({ ok: true, listingId: "listing-1", publicCode: "PSL-ABC", slug: "x", status: "draft", updatedAt: "now" });
    renderEditForm({
      initialCities: CITIES,
      initialBarangays: BARANGAYS,
      initialLocation: { provinceId: 1, cityId: 10, barangayId: 100 },
    });

    fireEvent.change(screen.getByLabelText(/barangay/i), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));

    await waitFor(() => expect(updateListingMock).toHaveBeenCalledWith("listing-1", { barangay_id: null }));
  });

  it("clearing city sends city_id: null and cascades barangay_id: null too", async () => {
    updateListingMock.mockResolvedValue({ ok: true, listingId: "listing-1", publicCode: "PSL-ABC", slug: "x", status: "draft", updatedAt: "now" });
    renderEditForm({
      initialCities: CITIES,
      initialBarangays: BARANGAYS,
      initialLocation: { provinceId: 1, cityId: 10, barangayId: 100 },
    });

    fireEvent.change(screen.getByLabelText("City / Municipality"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));

    await waitFor(() => expect(updateListingMock).toHaveBeenCalledWith("listing-1", { city_id: null, barangay_id: null }));
  });

  it("clearing province sends province_id: null and cascades city_id/barangay_id: null too", async () => {
    updateListingMock.mockResolvedValue({ ok: true, listingId: "listing-1", publicCode: "PSL-ABC", slug: "x", status: "draft", updatedAt: "now" });
    renderEditForm({
      initialCities: CITIES,
      initialBarangays: BARANGAYS,
      initialLocation: { provinceId: 1, cityId: 10, barangayId: 100 },
    });

    fireEvent.change(screen.getByLabelText("Province"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));

    await waitFor(() =>
      expect(updateListingMock).toHaveBeenCalledWith("listing-1", { province_id: null, city_id: null, barangay_id: null }),
    );
  });

  it("selecting a new coherent province/city sends both changed ids", async () => {
    updateListingMock.mockResolvedValue({ ok: true, listingId: "listing-1", publicCode: "PSL-ABC", slug: "x", status: "draft", updatedAt: "now" });
    const loadCities = vi.fn().mockResolvedValue([{ id: 20, name: "Ozamiz City" }]);
    renderEditForm({
      initialCities: CITIES,
      initialLocation: { provinceId: 1, cityId: 10, barangayId: null },
      loadCities,
    });

    fireEvent.change(screen.getByLabelText("Province"), { target: { value: "1" } });
    await waitFor(() => expect(screen.getByRole("option", { name: "Ozamiz City" })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("City / Municipality"), { target: { value: "20" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));

    await waitFor(() => expect(updateListingMock).toHaveBeenCalledWith("listing-1", { city_id: 20 }));
  });

  it("shows 'Draft saved' after a successful save, refreshes the page, and does not redirect away", async () => {
    updateListingMock.mockResolvedValue({ ok: true, listingId: "listing-1", publicCode: "PSL-ABC", slug: "x", status: "draft", updatedAt: "now" });
    renderEditForm();

    fireEvent.change(screen.getByLabelText(/brand/i), { target: { value: "Nike" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));

    expect(await screen.findByText("Draft saved")).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
    expect(refreshMock).toHaveBeenCalledTimes(1);
    // router.refresh() re-reads server data for the route -- it must never
    // itself trigger another update_listing call.
    expect(updateListingMock).toHaveBeenCalledTimes(1);
  });

  it("resets the baseline after a successful save -- an immediate second Save with no further edits sends no patch and does not refresh again", async () => {
    updateListingMock.mockResolvedValue({ ok: true, listingId: "listing-1", publicCode: "PSL-ABC", slug: "x", status: "draft", updatedAt: "now" });
    renderEditForm();

    fireEvent.change(screen.getByLabelText(/brand/i), { target: { value: "Nike" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));
    await waitFor(() => expect(updateListingMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));

    expect(await screen.findByText("No changes to save")).toBeInTheDocument();
    expect(updateListingMock).toHaveBeenCalledTimes(1);
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("maps an update_listing failure to a friendly message without redirecting or refreshing", async () => {
    updateListingMock.mockResolvedValue({ ok: false, code: "LISTING_NOT_DRAFT" });
    renderEditForm();

    fireEvent.change(screen.getByLabelText(/brand/i), { target: { value: "Nike" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));

    expect(await screen.findByText("Only Draft listings can be edited right now.")).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("Pre-loved -> Brand New -> Save Draft: saves the new type/condition and refreshes so sibling server data (e.g. the images picker) picks up the change", async () => {
    updateListingMock.mockResolvedValue({ ok: true, listingId: "listing-1", publicCode: "PSL-ABC", slug: "x", status: "draft", updatedAt: "now" });
    renderEditForm({ initialValues: { ...EMPTY_VALUES, listingType: "preloved", condition: "good" } });

    fireEvent.change(screen.getByLabelText(/listing type/i), { target: { value: "brand_new" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));

    await waitFor(() =>
      expect(updateListingMock).toHaveBeenCalledWith("listing-1", { listing_type: "brand_new", condition: null }),
    );
    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
  });

  it("Brand New -> Pre-loved -> Save Draft: saves the new type/condition and refreshes so sibling server data picks up the change", async () => {
    updateListingMock.mockResolvedValue({ ok: true, listingId: "listing-1", publicCode: "PSL-ABC", slug: "x", status: "draft", updatedAt: "now" });
    renderEditForm({ initialValues: { ...EMPTY_VALUES, listingType: "brand_new", condition: "brand_new" } });

    fireEvent.change(screen.getByLabelText(/listing type/i), { target: { value: "preloved" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));

    await waitFor(() =>
      expect(updateListingMock).toHaveBeenCalledWith("listing-1", { listing_type: "preloved", condition: null }),
    );
    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
  });

  it("create mode never calls router.refresh() on success -- only router.push()", async () => {
    createListingMock.mockResolvedValue({ ok: true, listingId: "listing-99", publicCode: "PSL-ABC", slug: "x", status: "draft", createdAt: "now" });
    renderForm();

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Item" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/sell/listing-99/edit"));
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("never calls create_listing in edit mode", async () => {
    updateListingMock.mockResolvedValue({ ok: true, listingId: "listing-1", publicCode: "PSL-ABC", slug: "x", status: "draft", updatedAt: "now" });
    renderEditForm();

    fireEvent.change(screen.getByLabelText(/brand/i), { target: { value: "Nike" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));

    await waitFor(() => expect(updateListingMock).toHaveBeenCalled());
    expect(createListingMock).not.toHaveBeenCalled();
  });

  it("renders no Publish button and no image/vehicle/rental UI in edit mode either", () => {
    renderEditForm();
    expect(screen.queryByRole("button", { name: /publish/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/upload.*photo/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/mileage/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/rental price/i)).not.toBeInTheDocument();
  });

  it("loading a listing with condition already 'brand_new' and then switching listing type away clears the now-conflicting condition", async () => {
    updateListingMock.mockResolvedValue({ ok: true, listingId: "listing-1", publicCode: "PSL-ABC", slug: "x", status: "draft", updatedAt: "now" });
    renderEditForm({ initialValues: { ...EMPTY_VALUES, listingType: "brand_new", condition: "brand_new" } });

    fireEvent.change(screen.getByLabelText(/listing type/i), { target: { value: "preloved" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));

    await waitFor(() =>
      expect(updateListingMock).toHaveBeenCalledWith("listing-1", { listing_type: "preloved", condition: null }),
    );
  });
});

describe("ListingForm -- vehicle/rental conditional fields", () => {
  it("shows vehicle fields only for Cars/Motorcycles categories", () => {
    renderForm();
    expect(screen.queryByRole("heading", { name: "Vehicle details" })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/^category/i), { target: { value: "2" } });
    expect(screen.getByRole("heading", { name: "Vehicle details" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/^category/i), { target: { value: "3" } });
    expect(screen.getByRole("heading", { name: "Vehicle details" })).toBeInTheDocument();
  });

  it("shows rental fields only for For Rent category", () => {
    renderForm();
    fireEvent.change(screen.getByLabelText(/^category/i), { target: { value: "4" } });
    expect(screen.getByRole("heading", { name: "Rental details" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Vehicle details" })).not.toBeInTheDocument();
  });

  it("shows neither vehicle nor rental fields for an ordinary category, or no category at all", () => {
    renderForm();
    expect(screen.queryByRole("heading", { name: "Vehicle details" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Rental details" })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/^category/i), { target: { value: "1" } });
    expect(screen.queryByRole("heading", { name: "Vehicle details" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Rental details" })).not.toBeInTheDocument();
  });

  it("category changes update the conditional fields immediately, in the same render -- no server round trip needed", () => {
    renderForm();
    fireEvent.change(screen.getByLabelText(/^category/i), { target: { value: "2" } });
    expect(screen.getByRole("heading", { name: "Vehicle details" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/^category/i), { target: { value: "4" } });
    expect(screen.queryByRole("heading", { name: "Vehicle details" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Rental details" })).toBeInTheDocument();
  });

  it("every vehicle/rental field remains optional -- Save Draft succeeds with the category chosen but nothing else filled in", async () => {
    createListingMock.mockResolvedValue({ ok: true, listingId: "listing-1", publicCode: "PSL-ABC", slug: "x", status: "draft", createdAt: "now" });
    renderForm();

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Item" } });
    fireEvent.change(screen.getByLabelText(/^category/i), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));

    await waitFor(() => expect(createListingMock).toHaveBeenCalledWith(expect.objectContaining({ vehicleDetails: null, rentalDetails: null })));
  });

  it("create mode builds the vehicle_details JSON from filled-in fields", async () => {
    createListingMock.mockResolvedValue({ ok: true, listingId: "listing-1", publicCode: "PSL-ABC", slug: "x", status: "draft", createdAt: "now" });
    renderForm();

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Item" } });
    fireEvent.change(screen.getByLabelText(/^category/i), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText(/^brand/i, { selector: "#vehicle-brand" }), { target: { value: "Toyota" } });
    fireEvent.change(screen.getByLabelText(/^year/i), { target: { value: "2020" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));

    await waitFor(() =>
      expect(createListingMock).toHaveBeenCalledWith(
        expect.objectContaining({ vehicleDetails: { brand: "Toyota", year: 2020 }, rentalDetails: null }),
      ),
    );
  });

  it("create mode builds the rental_details JSON from filled-in fields", async () => {
    createListingMock.mockResolvedValue({ ok: true, listingId: "listing-1", publicCode: "PSL-ABC", slug: "x", status: "draft", createdAt: "now" });
    renderForm();

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Item" } });
    fireEvent.change(screen.getByLabelText(/^category/i), { target: { value: "4" } });
    fireEvent.change(screen.getByLabelText(/rental price/i), { target: { value: "500" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));

    await waitFor(() =>
      expect(createListingMock).toHaveBeenCalledWith(
        expect.objectContaining({ vehicleDetails: null, rentalDetails: { rental_price_cents: 50000 } }),
      ),
    );
  });

  it("edit mode prefills vehicle details from initialVehicleDetails", () => {
    renderEditForm({
      initialValues: { ...EMPTY_VALUES, categoryId: 2 },
      initialVehicleDetails: { ...EMPTY_VEHICLE_VALUES, brand: "Toyota", year: "2020" },
    });

    expect(screen.getByLabelText(/^brand/i, { selector: "#vehicle-brand" })).toHaveValue("Toyota");
    expect(screen.getByLabelText(/^year/i)).toHaveValue("2020");
  });

  it("edit mode prefills rental details from initialRentalDetails", () => {
    renderEditForm({
      initialValues: { ...EMPTY_VALUES, categoryId: 4 },
      initialRentalDetails: { ...EMPTY_RENTAL_VALUES, priceInput: "19.99", period: "daily" },
    });

    expect(screen.getByLabelText(/^rental price/i)).toHaveValue("19.99");
    expect(screen.getByLabelText(/^rental period/i)).toHaveValue("daily");
  });

  it("unchanged vehicle_details is omitted from the patch", async () => {
    updateListingMock.mockResolvedValue({ ok: true, listingId: "listing-1", publicCode: "PSL-ABC", slug: "x", status: "draft", updatedAt: "now" });
    renderEditForm({
      initialValues: { ...EMPTY_VALUES, categoryId: 2 },
      initialVehicleDetails: { ...EMPTY_VEHICLE_VALUES, brand: "Toyota" },
    });

    fireEvent.change(screen.getByLabelText(/^brand/i, { selector: "#listing-brand" }), { target: { value: "Something else" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));

    await waitFor(() => expect(updateListingMock).toHaveBeenCalled());
    const [, patch] = updateListingMock.mock.calls[0];
    expect(patch).not.toHaveProperty("vehicle_details");
    expect(patch).toHaveProperty("brand", "Something else");
  });

  it("a changed vehicle_details field sends the COMPLETE current object, not just the changed sub-field", async () => {
    updateListingMock.mockResolvedValue({ ok: true, listingId: "listing-1", publicCode: "PSL-ABC", slug: "x", status: "draft", updatedAt: "now" });
    renderEditForm({
      initialValues: { ...EMPTY_VALUES, categoryId: 2 },
      initialVehicleDetails: { ...EMPTY_VEHICLE_VALUES, brand: "Toyota", model: "Vios" },
    });

    fireEvent.change(screen.getByLabelText(/^year/i), { target: { value: "2020" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));

    await waitFor(() =>
      expect(updateListingMock).toHaveBeenCalledWith("listing-1", {
        vehicle_details: { brand: "Toyota", model: "Vios", year: 2020 },
      }),
    );
  });

  it("clearing every vehicle field sends vehicle_details: null", async () => {
    updateListingMock.mockResolvedValue({ ok: true, listingId: "listing-1", publicCode: "PSL-ABC", slug: "x", status: "draft", updatedAt: "now" });
    renderEditForm({
      initialValues: { ...EMPTY_VALUES, categoryId: 2 },
      initialVehicleDetails: { ...EMPTY_VEHICLE_VALUES, brand: "Toyota" },
    });

    fireEvent.change(screen.getByLabelText(/^brand/i, { selector: "#vehicle-brand" }), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));

    await waitFor(() => expect(updateListingMock).toHaveBeenCalledWith("listing-1", { vehicle_details: null }));
  });

  it("clearing every rental field sends rental_details: null", async () => {
    updateListingMock.mockResolvedValue({ ok: true, listingId: "listing-1", publicCode: "PSL-ABC", slug: "x", status: "draft", updatedAt: "now" });
    renderEditForm({
      initialValues: { ...EMPTY_VALUES, categoryId: 4 },
      initialRentalDetails: { ...EMPTY_RENTAL_VALUES, priceInput: "500" },
    });

    fireEvent.change(screen.getByLabelText(/^rental price/i), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));

    await waitFor(() => expect(updateListingMock).toHaveBeenCalledWith("listing-1", { rental_details: null }));
  });

  it("changing category away from Cars sends an explicit vehicle_details: null clear for the old incompatible extension", async () => {
    updateListingMock.mockResolvedValue({ ok: true, listingId: "listing-1", publicCode: "PSL-ABC", slug: "x", status: "draft", updatedAt: "now" });
    renderEditForm({
      initialValues: { ...EMPTY_VALUES, categoryId: 2 },
      initialVehicleDetails: { ...EMPTY_VEHICLE_VALUES, brand: "Toyota" },
    });

    fireEvent.change(screen.getByLabelText(/^category/i), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));

    await waitFor(() =>
      expect(updateListingMock).toHaveBeenCalledWith("listing-1", { category_id: 1, vehicle_details: null }),
    );
  });

  it("no stale hidden vehicle state survives a category change back and forth -- fields start empty again, not restored", () => {
    renderEditForm({
      initialValues: { ...EMPTY_VALUES, categoryId: 2 },
      initialVehicleDetails: { ...EMPTY_VEHICLE_VALUES, brand: "Toyota" },
    });

    fireEvent.change(screen.getByLabelText(/^category/i), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText(/^category/i), { target: { value: "2" } });

    expect(screen.getByLabelText(/^brand/i, { selector: "#vehicle-brand" })).toHaveValue("");
  });

  it("never introduces Publish behavior alongside vehicle/rental fields", () => {
    renderForm();
    fireEvent.change(screen.getByLabelText(/^category/i), { target: { value: "2" } });
    expect(screen.queryByRole("button", { name: /publish/i })).not.toBeInTheDocument();
  });
});
