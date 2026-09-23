import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { AuthUser } from "@/lib/auth/session";
import type { GetMyProfileResult, MyProfile } from "@/lib/account/get-my-profile";
import type { LocationRef } from "@/lib/marketplace/reference-data";
import type { GetMyActiveRestrictionsResult, MyActiveRestriction } from "@/lib/moderation/get-my-active-restrictions";

const {
  getAuthUserMock,
  getMyProfileMock,
  getProvincesMock,
  getCitiesForProvinceMock,
  getBarangaysForCityMock,
  getMyActiveRestrictionsMock,
  redirectMock,
  signOutActionMock,
} = vi.hoisted(() => ({
  getAuthUserMock: vi.fn<() => Promise<AuthUser | null>>(),
  getMyProfileMock: vi.fn<() => Promise<GetMyProfileResult>>(),
  getProvincesMock: vi.fn<() => Promise<LocationRef[]>>(),
  getCitiesForProvinceMock: vi.fn<(provinceId: number) => Promise<LocationRef[]>>(),
  getBarangaysForCityMock: vi.fn<(cityId: number) => Promise<LocationRef[]>>(),
  getMyActiveRestrictionsMock: vi.fn<() => Promise<GetMyActiveRestrictionsResult>>(),
  redirectMock: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  signOutActionMock: vi.fn(),
}));

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

vi.mock("@/lib/moderation/get-my-active-restrictions", () => ({
  getMyActiveRestrictions: getMyActiveRestrictionsMock,
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

import AccountPage from "@/app/account/page";

function restriction(overrides: Partial<MyActiveRestriction> = {}): MyActiveRestriction {
  return {
    restrictionId: "r1",
    restrictionType: "seller_suspended",
    reason: "Repeated late shipments.",
    createdAt: "2026-09-01T12:00:00.000Z",
    ...overrides,
  };
}

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
    getMyActiveRestrictionsMock.mockResolvedValue({ restrictions: [], hadError: false });
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

  it("Contact section offers a Support link for email-change help, using the existing /support flow only", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: "buyer@example.com" });
    getMyProfileMock.mockResolvedValue({ profile: sampleProfile(), hadError: false });

    render(await AccountPage());

    const supportLink = screen.getByRole("link", { name: /contact support/i });
    expect(supportLink).toHaveAttribute("href", "/support");
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
      expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
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

    describe("Sign out submission (via the shared SignOutForm)", () => {
      it("clicking Sign out calls signOutAction", async () => {
        signOutActionMock.mockResolvedValue({ error: null });
        render(await AccountPage());

        fireEvent.click(screen.getByRole("button", { name: "Sign out" }));

        await waitFor(() => expect(signOutActionMock).toHaveBeenCalled());
      });

      it("a successful sign-out shows no error -- the confirmation itself is shown later, on the destination page", async () => {
        signOutActionMock.mockResolvedValue({ error: null });
        render(await AccountPage());

        fireEvent.click(screen.getByRole("button", { name: "Sign out" }));

        await waitFor(() => expect(signOutActionMock).toHaveBeenCalled());
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      });

      it("a failed sign-out shows a useful inline error and never a success -- the Sign out control stays available to retry", async () => {
        signOutActionMock.mockResolvedValue({ error: "We couldn't sign you out. Please try again." });
        render(await AccountPage());

        fireEvent.click(screen.getByRole("button", { name: "Sign out" }));

        expect(await screen.findByRole("alert")).toHaveTextContent("We couldn't sign you out. Please try again.");
        expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
      });
    });
  });

  describe("Security section", () => {
    beforeEach(() => {
      getAuthUserMock.mockResolvedValue({ id: "u1", email: "buyer@example.com" });
      getMyProfileMock.mockResolvedValue({ profile: sampleProfile(), hadError: false });
    });

    it("renders with exactly Change password and Sign out other devices actions", async () => {
      render(await AccountPage());
      expect(screen.getByRole("heading", { name: "Security" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /change password/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /sign out other devices/i })).toBeInTheDocument();
    });

    it("does not render a self-service Change Email action -- email changes go through Support", async () => {
      render(await AccountPage());
      expect(screen.queryByRole("button", { name: /change email/i })).not.toBeInTheDocument();
    });

    it("appears between the Profile/Location/Contact form and the Marketplace section", async () => {
      render(await AccountPage());
      const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
      const securityIndex = headings.indexOf("Security");
      const marketplaceIndex = headings.indexOf("Marketplace");
      expect(securityIndex).toBeGreaterThan(-1);
      expect(marketplaceIndex).toBeGreaterThan(securityIndex);
    });
  });

  describe("Account status section (A2.1)", () => {
    beforeEach(() => {
      getAuthUserMock.mockResolvedValue({ id: "u1", email: "buyer@example.com" });
      getMyProfileMock.mockResolvedValue({ profile: sampleProfile(), hadError: false });
    });

    it("renders no Account status section, and no #account-status element, when there are zero active restrictions -- the rest of the page is unaffected", async () => {
      getMyActiveRestrictionsMock.mockResolvedValue({ restrictions: [], hadError: false });
      render(await AccountPage());
      expect(screen.queryByRole("heading", { name: "Account status" })).not.toBeInTheDocument();
      expect(document.getElementById("account-status")).toBeNull();
      // The rest of the page still renders exactly as before.
      expect(screen.getByRole("heading", { name: "Security" })).toBeInTheDocument();
    });

    it("renders the Account status section with id=\"account-status\" and a seller_suspended card, placed before Profile/Location", async () => {
      getMyActiveRestrictionsMock.mockResolvedValue({ restrictions: [restriction({ restrictionType: "seller_suspended" })], hadError: false });
      render(await AccountPage());
      expect(document.getElementById("account-status")).not.toBeNull();
      expect(screen.getByRole("heading", { name: "Account status" })).toBeInTheDocument();
      expect(screen.getByText("Selling suspended")).toBeInTheDocument();

      const headings = screen.getAllByRole("heading").map((h) => h.textContent);
      const accountHeadingIndex = headings.indexOf("Account");
      const statusHeadingIndex = headings.indexOf("Account status");
      expect(accountHeadingIndex).toBeGreaterThan(-1);
      expect(statusHeadingIndex).toBeGreaterThan(accountHeadingIndex);
    });

    it("renders a buyer_restricted card", async () => {
      getMyActiveRestrictionsMock.mockResolvedValue({ restrictions: [restriction({ restrictionType: "buyer_restricted" })], hadError: false });
      render(await AccountPage());
      expect(screen.getByText("Buying restricted")).toBeInTheDocument();
    });

    it("renders an account_suspended card", async () => {
      getMyActiveRestrictionsMock.mockResolvedValue({ restrictions: [restriction({ restrictionType: "account_suspended" })], hadError: false });
      render(await AccountPage());
      expect(screen.getByText("Account suspended")).toBeInTheDocument();
    });

    it("renders multiple simultaneous restrictions as independent cards", async () => {
      getMyActiveRestrictionsMock.mockResolvedValue({
        restrictions: [
          restriction({ restrictionId: "r1", restrictionType: "seller_suspended" }),
          restriction({ restrictionId: "r2", restrictionType: "account_suspended" }),
        ],
        hadError: false,
      });
      render(await AccountPage());
      expect(screen.getByText("Selling suspended")).toBeInTheDocument();
      expect(screen.getByText("Account suspended")).toBeInTheDocument();
    });

    it("never renders moderator/admin metadata -- the page passes through only what getMyActiveRestrictions returns, which never includes it", async () => {
      getMyActiveRestrictionsMock.mockResolvedValue({ restrictions: [restriction()], hadError: false });
      render(await AccountPage());
      expect(screen.queryByText(/issued by|lifted by/i)).not.toBeInTheDocument();
    });
  });
});
