import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { AuthUser } from "@/lib/auth/session";
import type { AdminUserSummary, GetAdminUsersResult } from "@/lib/admin/get-admin-users";

const { getAuthUserMock, getAdminUsersMock, redirectMock, notFoundMock } = vi.hoisted(() => ({
  getAuthUserMock: vi.fn<() => Promise<AuthUser | null>>(),
  getAdminUsersMock: vi.fn<() => Promise<GetAdminUsersResult>>(),
  redirectMock: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  notFoundMock: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("@/lib/auth/session", () => ({
  getAuthUser: getAuthUserMock,
}));

vi.mock("@/lib/admin/get-admin-users", () => ({
  getAdminUsers: getAdminUsersMock,
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
  notFound: notFoundMock,
  useRouter: () => ({ refresh: vi.fn() }),
}));

import AdminAdminsPage from "@/app/admin/admins/page";

function makeUser(overrides: Partial<AdminUserSummary> = {}): AdminUserSummary {
  return {
    userId: "super-1",
    displayName: "Sam S.",
    email: "sam@example.com",
    role: "super_admin",
    grantedBy: null,
    grantedByDisplayName: null,
    createdAt: "2026-01-05T00:00:00.000Z",
    ...overrides,
  };
}

describe("AdminAdminsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects a guest to sign-in with next=/admin/admins before checking role", async () => {
    getAuthUserMock.mockResolvedValue(null);
    await expect(AdminAdminsPage()).rejects.toThrow("NEXT_REDIRECT:/sign-in?next=%2Fadmin%2Fadmins");
    expect(getAdminUsersMock).not.toHaveBeenCalled();
  });

  it("calls notFound() for a signed-in ordinary admin -- never a distinguishable access-denied page", async () => {
    getAuthUserMock.mockResolvedValue({ id: "admin-1", email: "admin@example.com" });
    getAdminUsersMock.mockResolvedValue({ status: "not_super_admin" });

    await expect(AdminAdminsPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("renders the roster for a super_admin", async () => {
    getAuthUserMock.mockResolvedValue({ id: "super-1", email: "super@example.com" });
    getAdminUsersMock.mockResolvedValue({ status: "found", users: [makeUser()] });

    render(await AdminAdminsPage());

    expect(screen.getByRole("heading", { level: 1, name: "Admins" })).toBeInTheDocument();
    expect(screen.getByText("Sam S.")).toBeInTheDocument();
  });

  it("shows an error state distinct from not-found", async () => {
    getAuthUserMock.mockResolvedValue({ id: "super-1", email: "super@example.com" });
    getAdminUsersMock.mockResolvedValue({ status: "error" });

    render(await AdminAdminsPage());

    expect(screen.getByText("Unable to load admins right now.")).toBeInTheDocument();
  });

  it("marks the Admins tab as the active nav link", async () => {
    getAuthUserMock.mockResolvedValue({ id: "super-1", email: "super@example.com" });
    getAdminUsersMock.mockResolvedValue({ status: "found", users: [] });

    render(await AdminAdminsPage());

    expect(screen.getByRole("link", { name: "Admins" })).toHaveAttribute("aria-current", "page");
  });
});
