import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { AuthUser } from "@/lib/auth/session";
import type { GetMyProfileResult, MyProfile } from "@/lib/account/get-my-profile";
import type { LocationRef } from "@/lib/marketplace/reference-data";

const { getAuthUserMock, getMyProfileMock, getProvincesMock, getCitiesForProvinceMock, getBarangaysForCityMock, redirectMock, signOutActionMock } = vi.hoisted(
  () => ({
    getAuthUserMock: vi.fn<() => Promise<AuthUser | null>>(),
    getMyProfileMock: vi.fn<() => Promise<GetMyProfileResult>>(),
    getProvincesMock: vi.fn<() => Promise<LocationRef[]>>(),
    getCitiesForProvinceMock: vi.fn<(provinceId: number) => Promise<LocationRef[]>>(),
    getBarangaysForCityMock: vi.fn<(cityId: number) => Promise<LocationRef[]>>(),
    redirectMock: vi.fn((url: string) => {
      throw new Error(`NEXT_REDIRECT:${url}`);
    }),
    signOutActionMock: vi.fn(),
  }),
);

vi.mock("@/lib/auth/session", () => ({
  getAuthUser: getAuthUserMock,
}));

vi.mock("@/lib/auth/actions", () => ({
  signOutAction: signOutActionMock,
}));

vi.mock("@/lib/account/get-my-profile", () => ({
  getMyProfile: getMyProfileMock,
}));

vi.mock("@/lib/marketplace/reference-data", () => ({
  getProvinces: getProvincesMock,
  getCitiesForProvince: getCitiesForProvinceMock,
  getBarangaysForCity: getBarangaysForCityMock,
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

import AccountPage from "@/app/account/page";

function sampleProfile(overrides: Partial<MyProfile> = {}): MyProfile {
  return {
    id: "u1",
    displayName: "Anne",
    avatarStoragePath: null,
    avatarUrl: undefined,
    firstName: null,
    lastName: null,
    bio: null,
    mobileNumber: null,
    provinceId: null,
    cityId: null,
    barangayId: null,
    deletedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("AccountPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getProvincesMock.mockResolvedValue([]);
    getCitiesForProvinceMock.mockResolvedValue([]);
    getBarangaysForCityMock.mockResolvedValue([]);
  });

  it("redirects a guest to sign-in with next=/account before fetching any profile data", async () => {
    getAuthUserMock.mockResolvedValue(null);
    await expect(AccountPage()).rejects.toThrow("NEXT_REDIRECT:/sign-in?next=%2Faccount");
    expect(getMyProfileMock).not.toHaveBeenCalled();
  });

  it("loads profile data through get_my_profile (via getMyProfile), never a direct table read", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: "buyer@example.com" });
    getMyProfileMock.mockResolvedValue({ profile: sampleProfile(), hadError: false });

    render(await AccountPage());

    expect(getMyProfileMock).toHaveBeenCalledTimes(1);
  });

  it("shows a safe retry state (not a crash, no raw error) when the profile load fails", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: "buyer@example.com" });
    getMyProfileMock.mockResolvedValue({ profile: null, hadError: true });

    render(await AccountPage());

    expect(screen.getByText("We couldn’t load your account details. Please try again.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /try again/i })).toHaveAttribute("href", "/account");
  });

  it("shows the authenticated user's current email read-only from the session, not from get_my_profile's own return shape", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: "buyer@example.com" });
    getMyProfileMock.mockResolvedValue({ profile: sampleProfile(), hadError: false });

    render(await AccountPage());

    expect(screen.getByText("buyer@example.com")).toBeInTheDocument();
  });

  it("renders the display name prefilled from the loaded profile", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: "buyer@example.com" });
    getMyProfileMock.mockResolvedValue({ profile: sampleProfile({ displayName: "Anne's Closet" }), hadError: false });

    render(await AccountPage());

    expect(screen.getByLabelText(/display name/i)).toHaveValue("Anne's Closet");
  });

  describe("Marketplace section -- correct labels and routes", () => {
    beforeEach(() => {
      getAuthUserMock.mockResolvedValue({ id: "u1", email: "buyer@example.com" });
      getMyProfileMock.mockResolvedValue({ profile: sampleProfile(), hadError: false });
    });

    it("My Orders points at /orders", async () => {
      render(await AccountPage());
      expect(screen.getByRole("link", { name: "My Orders" })).toHaveAttribute("href", "/orders");
    });

    it("Customer Orders points at /seller/orders", async () => {
      render(await AccountPage());
      expect(screen.getByRole("link", { name: "Customer Orders" })).toHaveAttribute("href", "/seller/orders");
    });

    it("My Shop points at /seller/shop", async () => {
      render(await AccountPage());
      expect(screen.getByRole("link", { name: "My Shop" })).toHaveAttribute("href", "/seller/shop");
    });

    it("My Listings points at /seller/listings", async () => {
      render(await AccountPage());
      expect(screen.getByRole("link", { name: "My Listings" })).toHaveAttribute("href", "/seller/listings");
    });

    it("Favorites points at /favorites", async () => {
      render(await AccountPage());
      expect(screen.getByRole("link", { name: "Favorites" })).toHaveAttribute("href", "/favorites");
    });
  });

  describe("Account section", () => {
    beforeEach(() => {
      getAuthUserMock.mockResolvedValue({ id: "u1", email: "buyer@example.com" });
      getMyProfileMock.mockResolvedValue({ profile: sampleProfile(), hadError: false });
    });

    it("renders a Sign out control unchanged", async () => {
      render(await AccountPage());
      expect(screen.getByRole("button", { name: /sign out/i })).toBeInTheDocument();
    });

    it("Request account deletion links to the existing /support flow only -- no new query-param mechanism invented", async () => {
      render(await AccountPage());
      const supportLink = screen.getByRole("link", { name: /go to support/i });
      expect(supportLink).toHaveAttribute("href", "/support");
    });

    it("explains that deletion is handled through a support request", async () => {
      render(await AccountPage());
      expect(screen.getByText(/handled through a support request/i)).toBeInTheDocument();
    });

    it("does not add a Security section, Change Email, or Change Password UI", async () => {
      render(await AccountPage());
      expect(screen.queryByText(/security/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/change email/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/change password/i)).not.toBeInTheDocument();
    });
  });
});
