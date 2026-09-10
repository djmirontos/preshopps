import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { AuthUser } from "@/lib/auth/session";
import type { AdminReportSummary, GetAdminReportsResult } from "@/lib/admin/get-admin-reports";

const { getAuthUserMock, getAdminReportsMock, getMyAdminRoleMock, redirectMock, notFoundMock } = vi.hoisted(() => ({
  getAuthUserMock: vi.fn<() => Promise<AuthUser | null>>(),
  getAdminReportsMock: vi.fn<() => Promise<GetAdminReportsResult>>(),
  getMyAdminRoleMock: vi.fn<() => Promise<"admin" | "super_admin" | null>>(),
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

vi.mock("@/lib/admin/get-admin-reports", () => ({
  getAdminReports: getAdminReportsMock,
}));

vi.mock("@/lib/admin/get-my-admin-role", () => ({
  getMyAdminRole: getMyAdminRoleMock,
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
  notFound: notFoundMock,
}));

import AdminReportsPage from "@/app/admin/page";

function makeReport(overrides: Partial<AdminReportSummary> = {}): AdminReportSummary {
  return {
    reportId: "report-1",
    targetType: "listing",
    targetLabel: "Nike Air Max 270",
    reason: "spam",
    status: "pending",
    reporterDisplayName: "Jane D.",
    createdAt: "2026-01-05T00:00:00.000Z",
    ...overrides,
  };
}

function params(searchParams: Record<string, string> = {}) {
  return { searchParams: Promise.resolve(searchParams) };
}

describe("AdminReportsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMyAdminRoleMock.mockResolvedValue("admin");
  });

  it("redirects a guest to sign-in with next=/admin before checking admin status", async () => {
    getAuthUserMock.mockResolvedValue(null);
    await expect(AdminReportsPage(params())).rejects.toThrow("NEXT_REDIRECT:/sign-in?next=%2Fadmin");
    expect(getAdminReportsMock).not.toHaveBeenCalled();
  });

  it("calls notFound() for a signed-in ordinary (non-admin) user -- never a distinguishable access-denied page", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: "user@example.com" });
    getAdminReportsMock.mockResolvedValue({ reports: [], hadError: false, notAdmin: true, nextCursor: null });

    await expect(AdminReportsPage(params())).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("renders the reports queue for an admin", async () => {
    getAuthUserMock.mockResolvedValue({ id: "admin-1", email: "admin@example.com" });
    getAdminReportsMock.mockResolvedValue({ reports: [makeReport()], hadError: false, notAdmin: false, nextCursor: null });

    render(await AdminReportsPage(params()));

    expect(screen.getByRole("heading", { level: 1, name: "Reports" })).toBeInTheDocument();
    expect(screen.getByText("Nike Air Max 270")).toBeInTheDocument();
  });

  it("passes the status query param through to get_admin_reports", async () => {
    getAuthUserMock.mockResolvedValue({ id: "admin-1", email: "admin@example.com" });
    getAdminReportsMock.mockResolvedValue({ reports: [], hadError: false, notAdmin: false, nextCursor: null });

    render(await AdminReportsPage(params({ status: "resolved" })));

    expect(getAdminReportsMock).toHaveBeenCalledWith(20, "resolved");
    expect(screen.getByRole("link", { name: "Resolved" })).toHaveAttribute("aria-current", "page");
  });

  it("falls back to All for an invalid status query param", async () => {
    getAuthUserMock.mockResolvedValue({ id: "admin-1", email: "admin@example.com" });
    getAdminReportsMock.mockResolvedValue({ reports: [], hadError: false, notAdmin: false, nextCursor: null });

    render(await AdminReportsPage(params({ status: "not-a-real-status" })));

    expect(getAdminReportsMock).toHaveBeenCalledWith(20, null);
  });

  it("shows an empty state when there are no reports", async () => {
    getAuthUserMock.mockResolvedValue({ id: "admin-1", email: "admin@example.com" });
    getAdminReportsMock.mockResolvedValue({ reports: [], hadError: false, notAdmin: false, nextCursor: null });

    render(await AdminReportsPage(params()));

    expect(screen.getByText("No reports yet.")).toBeInTheDocument();
  });

  it("does not show the Admins nav link for an ordinary admin", async () => {
    getAuthUserMock.mockResolvedValue({ id: "admin-1", email: "admin@example.com" });
    getAdminReportsMock.mockResolvedValue({ reports: [], hadError: false, notAdmin: false, nextCursor: null });
    getMyAdminRoleMock.mockResolvedValue("admin");

    render(await AdminReportsPage(params()));

    expect(screen.queryByRole("link", { name: "Admins" })).not.toBeInTheDocument();
  });

  it("shows the Admins nav link for a super_admin", async () => {
    getAuthUserMock.mockResolvedValue({ id: "super-1", email: "super@example.com" });
    getAdminReportsMock.mockResolvedValue({ reports: [], hadError: false, notAdmin: false, nextCursor: null });
    getMyAdminRoleMock.mockResolvedValue("super_admin");

    render(await AdminReportsPage(params()));

    expect(screen.getByRole("link", { name: "Admins" })).toHaveAttribute("href", "/admin/admins");
  });
});
