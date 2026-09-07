import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { AuthUser } from "@/lib/auth/session";
import type { MyShopProfile } from "@/lib/seller/get-my-shop-profile";
import type { LocationRef } from "@/lib/marketplace/reference-data";

const { getAuthUserMock, getMyShopProfileMock, getProvincesMock, getCitiesForProvinceMock, getBarangaysForCityMock, redirectMock } = vi.hoisted(() => ({
  getAuthUserMock: vi.fn<() => Promise<AuthUser | null>>(),
  getMyShopProfileMock: vi.fn<() => Promise<MyShopProfile | null>>(),
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
  getProvinces: getProvincesMock,
  getCitiesForProvince: getCitiesForProvinceMock,
  getBarangaysForCity: getBarangaysForCityMock,
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
  useRouter: () => ({ refresh: vi.fn() }),
}));

import SellerShopPage from "@/app/seller/shop/page";

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

describe("SellerShopPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getProvincesMock.mockResolvedValue([{ id: 1, name: "Misamis Occidental" }]);
    getCitiesForProvinceMock.mockResolvedValue([{ id: 10, name: "Tangub City" }]);
    getBarangaysForCityMock.mockResolvedValue([]);
  });

  it("redirects a guest to sign-in with next=%2Fseller%2Fshop", async () => {
    getAuthUserMock.mockResolvedValue(null);
    await expect(SellerShopPage()).rejects.toThrow("NEXT_REDIRECT:/sign-in?next=%2Fseller%2Fshop");
    expect(getMyShopProfileMock).not.toHaveBeenCalled();
  });

  it("renders the setup form (Create Shop) when the account has no shop yet", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: "seller@example.com" });
    getMyShopProfileMock.mockResolvedValue(null);

    render(await SellerShopPage());

    expect(screen.getByRole("heading", { level: 1, name: "Set up your shop" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create Shop" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save Changes" })).not.toBeInTheDocument();
  });

  it("renders the management form (Save Changes) prefilled when the account already has a shop", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: "seller@example.com" });
    getMyShopProfileMock.mockResolvedValue(sampleShop());

    render(await SellerShopPage());

    expect(screen.getByRole("heading", { level: 1, name: "My Shop" })).toBeInTheDocument();
    expect(screen.getByLabelText("Shop name")).toHaveValue("Anne's Closet");
    expect(screen.getByRole("button", { name: "Save Changes" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create Shop" })).not.toBeInTheDocument();
  });

  it("exactly one h1 renders on the page", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: "seller@example.com" });
    getMyShopProfileMock.mockResolvedValue(null);

    render(await SellerShopPage());
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });
});
