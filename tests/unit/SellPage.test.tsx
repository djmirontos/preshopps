import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { AuthUser } from "@/lib/auth/session";
import type { MyShopProfile } from "@/lib/seller/get-my-shop-profile";
import type { CategoryRef, LocationRef } from "@/lib/marketplace/reference-data";

const {
  getAuthUserMock,
  getMyShopProfileMock,
  getCategoriesMock,
  getProvincesMock,
  getCitiesForProvinceMock,
  getBarangaysForCityMock,
  redirectMock,
} = vi.hoisted(() => ({
  getAuthUserMock: vi.fn<() => Promise<AuthUser | null>>(),
  getMyShopProfileMock: vi.fn<() => Promise<MyShopProfile | null>>(),
  getCategoriesMock: vi.fn<() => Promise<CategoryRef[]>>(),
  getProvincesMock: vi.fn<() => Promise<LocationRef[]>>(),
  getCitiesForProvinceMock: vi.fn<(provinceId: number) => Promise<LocationRef[]>>(),
  getBarangaysForCityMock: vi.fn<(cityId: number) => Promise<LocationRef[]>>(),
  redirectMock: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

vi.mock("@/lib/auth/session", () => ({
  getAuthUser: getAuthUserMock,
}));

vi.mock("@/lib/seller/get-my-shop-profile", () => ({
  getMyShopProfile: getMyShopProfileMock,
}));

vi.mock("@/lib/marketplace/reference-data", () => ({
  getCategories: getCategoriesMock,
  getProvinces: getProvincesMock,
  getCitiesForProvince: getCitiesForProvinceMock,
  getBarangaysForCity: getBarangaysForCityMock,
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
  useRouter: () => ({ push: vi.fn() }),
}));

import SellPage from "@/app/sell/page";

function sampleShop(overrides: Partial<MyShopProfile> = {}): MyShopProfile {
  return {
    id: "shop-1",
    slug: "annes-closet",
    name: "Anne's Closet",
    description: "Quality finds",
    logoStoragePath: null,
    logoUrl: undefined,
    provinceId: 1,
    cityId: 10,
    barangayId: null,
    messengerLink: null,
    status: "active",
    featuredListingId: null,
    ...overrides,
  };
}

describe("SellPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCategoriesMock.mockResolvedValue([{ id: 1, slug: "women", name: "Women" }]);
    getProvincesMock.mockResolvedValue([{ id: 1, name: "Misamis Occidental" }]);
    getCitiesForProvinceMock.mockResolvedValue([{ id: 10, name: "Tangub City" }]);
    getBarangaysForCityMock.mockResolvedValue([]);
  });

  it("redirects a guest to sign-in with next=%2Fsell", async () => {
    getAuthUserMock.mockResolvedValue(null);
    await expect(SellPage()).rejects.toThrow("NEXT_REDIRECT:/sign-in?next=%2Fsell");
    expect(getMyShopProfileMock).not.toHaveBeenCalled();
  });

  it("redirects an authenticated account with no shop to /seller/shop", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: "seller@example.com" });
    getMyShopProfileMock.mockResolvedValue(null);

    await expect(SellPage()).rejects.toThrow("NEXT_REDIRECT:/seller/shop");
    expect(getCategoriesMock).not.toHaveBeenCalled();
  });

  it("renders the create-listing form for a seller who already has a shop", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: "seller@example.com" });
    getMyShopProfileMock.mockResolvedValue(sampleShop());

    render(await SellPage());

    expect(screen.getByRole("heading", { level: 1, name: "Sell an item" })).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save Draft" })).toBeInTheDocument();
  });

  it("prefills location from the shop's own province/city, and loads its barangays only when the shop has one", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: "seller@example.com" });
    getMyShopProfileMock.mockResolvedValue(sampleShop({ barangayId: null }));

    await SellPage();

    expect(getCitiesForProvinceMock).toHaveBeenCalledWith(1);
    expect(getBarangaysForCityMock).not.toHaveBeenCalled();
  });

  it("loads barangays for the shop's city when the shop itself has a barangay set", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: "seller@example.com" });
    getMyShopProfileMock.mockResolvedValue(sampleShop({ barangayId: 100 }));

    await SellPage();

    expect(getBarangaysForCityMock).toHaveBeenCalledWith(10);
  });

  it("exactly one h1 renders on the page", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: "seller@example.com" });
    getMyShopProfileMock.mockResolvedValue(sampleShop());

    render(await SellPage());
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });
});
