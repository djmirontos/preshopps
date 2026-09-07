import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { refreshMock, createShopMock, updateShopMock, uploadImageMock, deleteUploadedImageMock } = vi.hoisted(() => ({
  refreshMock: vi.fn(),
  createShopMock: vi.fn(),
  updateShopMock: vi.fn(),
  uploadImageMock: vi.fn(),
  deleteUploadedImageMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

vi.mock("@/lib/seller/shop-actions", async () => {
  const actual = await vi.importActual<typeof import("@/lib/seller/shop-actions")>("@/lib/seller/shop-actions");
  return {
    ...actual,
    createShop: createShopMock,
    updateShop: updateShopMock,
  };
});

vi.mock("@/lib/image-processing/upload-image", async () => {
  const actual = await vi.importActual<typeof import("@/lib/image-processing/upload-image")>("@/lib/image-processing/upload-image");
  return {
    ...actual,
    uploadImage: uploadImageMock,
    deleteUploadedImage: deleteUploadedImageMock,
  };
});

import { ShopForm } from "@/components/seller/ShopForm";

const PROVINCES = [{ id: 1, name: "Misamis Occidental" }];
const CITIES = [{ id: 10, name: "Tangub City" }];

beforeEach(() => {
  vi.clearAllMocks();
  deleteUploadedImageMock.mockResolvedValue(true);
  if (!("createObjectURL" in URL)) {
    // @ts-expect-error -- test-environment polyfill
    URL.createObjectURL = vi.fn(() => "blob:mock-preview");
  }
});

function selectFile(input: HTMLElement) {
  const file = new File(["fake-bytes"], "logo.jpg", { type: "image/jpeg" });
  fireEvent.change(input, { target: { files: [file] } });
}

describe("ShopForm -- create mode", () => {
  it("requires a shop name, province, and city before submitting -- no RPC call", async () => {
    render(
      <ShopForm
        mode="create"
        ownerId="owner-1"
        provinces={PROVINCES}
        initialCities={[]}
        initialBarangays={[]}
        loadCities={vi.fn()}
        loadBarangays={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Create Shop" }));

    expect(await screen.findByText("Please enter a shop name.")).toBeInTheDocument();
    expect(await screen.findByText("Please choose a province.")).toBeInTheDocument();
    expect(await screen.findByText("Please choose a city or municipality.")).toBeInTheDocument();
    expect(createShopMock).not.toHaveBeenCalled();
  });

  it("submits create_shop with the entered fields once required fields are filled", async () => {
    createShopMock.mockResolvedValue({ ok: true, shopId: "shop-1", slug: "annes-closet", createdAt: "2026-01-01T00:00:00.000Z" });
    const loadCities = vi.fn().mockResolvedValue(CITIES);
    render(
      <ShopForm
        mode="create"
        ownerId="owner-1"
        provinces={PROVINCES}
        initialCities={[]}
        initialBarangays={[]}
        loadCities={loadCities}
        loadBarangays={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText("Shop name"), { target: { value: "Anne's Closet" } });
    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "1" } });
    await waitFor(() => expect(screen.getByRole("option", { name: "Tangub City" })).toBeInTheDocument());
    fireEvent.change(screen.getAllByRole("combobox")[1], { target: { value: "10" } });

    fireEvent.click(screen.getByRole("button", { name: "Create Shop" }));

    await waitFor(() =>
      expect(createShopMock).toHaveBeenCalledWith(
        {
          name: "Anne's Closet",
          description: null,
          provinceId: 1,
          cityId: 10,
          barangayId: null,
          messengerLink: null,
          logoStoragePath: null,
        },
        "anne-s-closet",
      ),
    );
    expect(refreshMock).toHaveBeenCalled();
  });

  it("shows a duplicate-shop error safely and does not refresh on failure", async () => {
    createShopMock.mockResolvedValue({ ok: false, code: "SHOP_ALREADY_EXISTS" });
    render(
      <ShopForm
        mode="create"
        ownerId="owner-1"
        provinces={PROVINCES}
        initialCities={CITIES}
        initialBarangays={[]}
        loadCities={vi.fn()}
        loadBarangays={vi.fn()}
        initialLocation={{ provinceId: 1, cityId: 10, barangayId: null }}
      />,
    );

    fireEvent.change(screen.getByLabelText("Shop name"), { target: { value: "Anne's Closet" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Shop" }));

    expect(await screen.findByText("You already have a shop.")).toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("generates a default slug from the shop name and shows a URL preview", () => {
    render(
      <ShopForm mode="create" ownerId="owner-1" provinces={PROVINCES} initialCities={[]} initialBarangays={[]} loadCities={vi.fn()} loadBarangays={vi.fn()} />,
    );

    fireEvent.change(screen.getByLabelText("Shop name"), { target: { value: "Anne's Closet" } });

    expect(screen.getByLabelText("Shop URL")).toHaveValue("anne-s-closet");
    expect(screen.getByText("preshopps.com/shop/anne-s-closet")).toBeInTheDocument();
  });

  it("lets the seller edit the slug before creating the shop, and stops auto-following the name afterward", () => {
    render(
      <ShopForm mode="create" ownerId="owner-1" provinces={PROVINCES} initialCities={[]} initialBarangays={[]} loadCities={vi.fn()} loadBarangays={vi.fn()} />,
    );

    fireEvent.change(screen.getByLabelText("Shop name"), { target: { value: "Anne's Closet" } });
    fireEvent.change(screen.getByLabelText("Shop URL"), { target: { value: "custom-url" } });
    expect(screen.getByLabelText("Shop URL")).toHaveValue("custom-url");

    // Further name edits no longer overwrite the seller's own custom slug.
    fireEvent.change(screen.getByLabelText("Shop name"), { target: { value: "Anne's Closet Two" } });
    expect(screen.getByLabelText("Shop URL")).toHaveValue("custom-url");
  });

  it("submits the seller's own edited slug to create_shop", async () => {
    createShopMock.mockResolvedValue({ ok: true, shopId: "shop-1", slug: "custom-url", createdAt: "2026-01-01T00:00:00.000Z" });
    render(
      <ShopForm
        mode="create"
        ownerId="owner-1"
        provinces={PROVINCES}
        initialCities={CITIES}
        initialBarangays={[]}
        loadCities={vi.fn()}
        loadBarangays={vi.fn()}
        initialLocation={{ provinceId: 1, cityId: 10, barangayId: null }}
      />,
    );

    fireEvent.change(screen.getByLabelText("Shop name"), { target: { value: "Anne's Closet" } });
    fireEvent.change(screen.getByLabelText("Shop URL"), { target: { value: "custom-url" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Shop" }));

    await waitFor(() => expect(createShopMock).toHaveBeenCalledWith(expect.anything(), "custom-url"));
  });

  it("rejects an invalid custom slug client-side before ever calling create_shop", async () => {
    render(
      <ShopForm
        mode="create"
        ownerId="owner-1"
        provinces={PROVINCES}
        initialCities={CITIES}
        initialBarangays={[]}
        loadCities={vi.fn()}
        loadBarangays={vi.fn()}
        initialLocation={{ provinceId: 1, cityId: 10, barangayId: null }}
      />,
    );

    fireEvent.change(screen.getByLabelText("Shop name"), { target: { value: "Anne's Closet" } });
    fireEvent.change(screen.getByLabelText("Shop URL"), { target: { value: "Not A Valid Slug!" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Shop" }));

    expect(await screen.findByText("Shop URL must be lowercase letters, numbers, and hyphens only.")).toBeInTheDocument();
    expect(createShopMock).not.toHaveBeenCalled();
  });

  it("maps a server-rejected slug collision to safe copy", async () => {
    createShopMock.mockResolvedValue({ ok: false, code: "SLUG_UNAVAILABLE" });
    render(
      <ShopForm
        mode="create"
        ownerId="owner-1"
        provinces={PROVINCES}
        initialCities={CITIES}
        initialBarangays={[]}
        loadCities={vi.fn()}
        loadBarangays={vi.fn()}
        initialLocation={{ provinceId: 1, cityId: 10, barangayId: null }}
      />,
    );

    fireEvent.change(screen.getByLabelText("Shop name"), { target: { value: "Anne's Closet" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Shop" }));

    expect(await screen.findByText("That shop URL is already taken. Try another one.")).toBeInTheDocument();
  });

  it("does not render a Shop URL field in edit mode", () => {
    render(
      <ShopForm
        mode="edit"
        ownerId="owner-1"
        provinces={PROVINCES}
        initialCities={CITIES}
        initialBarangays={[]}
        loadCities={vi.fn()}
        loadBarangays={vi.fn()}
        initialName="Anne's Closet"
        initialLocation={{ provinceId: 1, cityId: 10, barangayId: null }}
        currentSlug="annes-closet"
      />,
    );

    expect(screen.queryByLabelText("Shop URL")).not.toBeInTheDocument();
  });

  it("disables submission and explains when location reference data is empty", () => {
    render(
      <ShopForm mode="create" ownerId="owner-1" provinces={[]} initialCities={[]} initialBarangays={[]} loadCities={vi.fn()} loadBarangays={vi.fn()} />,
    );

    expect(screen.getByRole("button", { name: "Create Shop" })).toBeDisabled();
    expect(screen.getByText(/requires location data that hasn.t been set up yet/i)).toBeInTheDocument();
  });

  it("does not show the Active/Away control in create mode", () => {
    render(
      <ShopForm mode="create" ownerId="owner-1" provinces={PROVINCES} initialCities={[]} initialBarangays={[]} loadCities={vi.fn()} loadBarangays={vi.fn()} />,
    );
    expect(screen.queryByRole("radiogroup", { name: /shop availability/i })).not.toBeInTheDocument();
  });

  it("best-effort deletes a newly-uploaded logo when create_shop fails", async () => {
    uploadImageMock.mockResolvedValue({ ok: true, path: "shop-images/owner-1/logo/a.jpg" });
    createShopMock.mockResolvedValue({ ok: false, code: "NAME_TOO_LONG" });
    render(
      <ShopForm
        mode="create"
        ownerId="owner-1"
        provinces={PROVINCES}
        initialCities={CITIES}
        initialBarangays={[]}
        loadCities={vi.fn()}
        loadBarangays={vi.fn()}
        initialLocation={{ provinceId: 1, cityId: 10, barangayId: null }}
      />,
    );

    fireEvent.change(screen.getByLabelText("Shop name"), { target: { value: "Anne's Closet" } });
    selectFile(screen.getByLabelText(/upload shop logo/i));
    await waitFor(() => expect(screen.getByRole("button", { name: "Create Shop" })).not.toBeDisabled());

    fireEvent.click(screen.getByRole("button", { name: "Create Shop" }));

    await waitFor(() => expect(deleteUploadedImageMock).toHaveBeenCalledWith("shop-images/owner-1/logo/a.jpg"));
  });
});

describe("ShopForm -- edit mode", () => {
  const editProps = {
    mode: "edit" as const,
    ownerId: "owner-1",
    provinces: PROVINCES,
    initialCities: CITIES,
    initialBarangays: [],
    loadCities: vi.fn(),
    loadBarangays: vi.fn(),
    initialName: "Anne's Closet",
    initialDescription: "Quality finds",
    initialLocation: { provinceId: 1, cityId: 10, barangayId: null },
    initialMessengerLink: "https://m.me/annescloset",
    initialStatus: "active" as const,
    currentSlug: "annes-closet",
  };

  it("prefills all existing values", () => {
    render(<ShopForm {...editProps} />);

    expect(screen.getByLabelText("Shop name")).toHaveValue("Anne's Closet");
    expect(screen.getByDisplayValue("Quality finds")).toBeInTheDocument();
    expect(screen.getByLabelText(/messenger link/i)).toHaveValue("https://m.me/annescloset");
    expect(screen.getByRole("radio", { name: "Active" })).toHaveAttribute("aria-checked", "true");
  });

  it("shows a link to view the public shop", () => {
    render(<ShopForm {...editProps} />);
    expect(screen.getByRole("link", { name: /view your shop/i })).toHaveAttribute("href", "/shop/annes-closet");
  });

  it("submits update_shop with edited fields and the selected status", async () => {
    updateShopMock.mockResolvedValue({ ok: true, shopId: "shop-1", slug: "annes-closet", updatedAt: "2026-01-02T00:00:00.000Z" });
    render(<ShopForm {...editProps} />);

    fireEvent.click(screen.getByRole("radio", { name: "Away" }));
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() =>
      expect(updateShopMock).toHaveBeenCalledWith(
        {
          name: "Anne's Closet",
          description: "Quality finds",
          provinceId: 1,
          cityId: 10,
          barangayId: null,
          messengerLink: "https://m.me/annescloset",
          logoStoragePath: null,
        },
        "away",
      ),
    );
  });

  it("only Active and Away are selectable -- no admin/suspended option exists", () => {
    render(<ShopForm {...editProps} />);
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(2);
    expect(radios.map((r) => r.textContent)).toEqual(["Active", "Away"]);
  });

  it("successful save with a removed persisted logo deletes only the old logo, after update_shop succeeds", async () => {
    updateShopMock.mockResolvedValue({ ok: true, shopId: "shop-1", slug: "annes-closet", updatedAt: "2026-01-02T00:00:00.000Z" });
    render(
      <ShopForm {...editProps} initialLogoPath="shop-images/owner-1/logo/old.jpg" initialLogoUrl="https://example.supabase.co/x/old.jpg" />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(deleteUploadedImageMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => expect(updateShopMock).toHaveBeenCalledWith(expect.objectContaining({ logoStoragePath: null }), "active"));
    await waitFor(() => expect(deleteUploadedImageMock).toHaveBeenCalledWith("shop-images/owner-1/logo/old.jpg"));
  });

  it("successful save with an unchanged persisted logo never calls delete", async () => {
    updateShopMock.mockResolvedValue({ ok: true, shopId: "shop-1", slug: "annes-closet", updatedAt: "2026-01-02T00:00:00.000Z" });
    render(
      <ShopForm {...editProps} initialLogoPath="shop-images/owner-1/logo/unchanged.jpg" initialLogoUrl="https://example.supabase.co/x/unchanged.jpg" />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => expect(updateShopMock).toHaveBeenCalled());
    expect(deleteUploadedImageMock).not.toHaveBeenCalled();
  });

  it("mutation failure preserves the old persisted logo -- no delete call at all", async () => {
    updateShopMock.mockResolvedValue({ ok: false, code: "SHOP_NOT_FOUND" });
    render(
      <ShopForm {...editProps} initialLogoPath="shop-images/owner-1/logo/keep.jpg" initialLogoUrl="https://example.supabase.co/x/keep.jpg" />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => expect(updateShopMock).toHaveBeenCalled());
    expect(deleteUploadedImageMock).not.toHaveBeenCalled();
  });

  it("a cleanup failure after a successful save still refreshes as a success (never surfaced as an error)", async () => {
    updateShopMock.mockResolvedValue({ ok: true, shopId: "shop-1", slug: "annes-closet", updatedAt: "2026-01-02T00:00:00.000Z" });
    deleteUploadedImageMock.mockRejectedValue(new Error("network down"));
    render(
      <ShopForm {...editProps} initialLogoPath="shop-images/owner-1/logo/old.jpg" initialLogoUrl="https://example.supabase.co/x/old.jpg" />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(screen.queryByText(/something went wrong/i)).not.toBeInTheDocument();
  });
});
