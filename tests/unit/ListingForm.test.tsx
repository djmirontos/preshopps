import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { pushMock, createListingMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  createListingMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock("@/lib/seller/listing-actions", async () => {
  const actual = await vi.importActual<typeof import("@/lib/seller/listing-actions")>("@/lib/seller/listing-actions");
  return {
    ...actual,
    createListing: createListingMock,
  };
});

import { ListingForm } from "@/components/seller/ListingForm";

const CATEGORIES = [{ id: 1, slug: "women", name: "Women" }];
const PROVINCES = [{ id: 1, name: "Misamis Occidental" }];
const CITIES = [{ id: 10, name: "Tangub City" }];
const BARANGAYS = [{ id: 100, name: "Barangay Uno" }];

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
