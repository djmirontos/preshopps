import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { AuthUser } from "@/lib/auth/session";
import type { GetAdminReportDetailResult, AdminReportDetail } from "@/lib/admin/get-admin-report-detail";
import type { GetAdminUserRestrictionsResult } from "@/lib/admin/get-admin-user-restrictions";

const { getAuthUserMock, getAdminReportDetailMock, getAdminUserRestrictionsMock, redirectMock, notFoundMock } = vi.hoisted(() => ({
  getAuthUserMock: vi.fn<() => Promise<AuthUser | null>>(),
  getAdminReportDetailMock: vi.fn<() => Promise<GetAdminReportDetailResult>>(),
  getAdminUserRestrictionsMock: vi.fn<() => Promise<GetAdminUserRestrictionsResult>>(),
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

vi.mock("@/lib/admin/get-admin-report-detail", () => ({
  getAdminReportDetail: getAdminReportDetailMock,
}));

vi.mock("@/lib/admin/get-admin-user-restrictions", () => ({
  getAdminUserRestrictions: getAdminUserRestrictionsMock,
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
  notFound: notFoundMock,
}));

import AdminReportDetailPage from "@/app/admin/reports/[reportId]/page";

function makeReport(overrides: Partial<AdminReportDetail> = {}): AdminReportDetail {
  return {
    reportId: "report-1",
    targetType: "listing",
    reason: "spam",
    description: "Looks fake.",
    status: "pending",
    createdAt: "2026-01-05T00:00:00.000Z",
    reporterId: "u1",
    reporterDisplayName: "Jane D.",
    resolvedBy: null,
    resolvedByDisplayName: null,
    resolvedAt: null,
    resolutionNote: null,
    listingId: "listing-1",
    listingTitle: "Nike Air Max 270",
    listingShopId: "shop-1",
    listingShopOwnerId: "owner-1",
    listingShopOwnerDisplayName: "Anne S.",
    shopId: null,
    shopName: null,
    shopOwnerId: null,
    shopOwnerDisplayName: null,
    reviewId: null,
    reviewRating: null,
    reviewBody: null,
    reviewAuthorId: null,
    reviewAuthorDisplayName: null,
    conversationId: null,
    conversationBuyerId: null,
    conversationBuyerDisplayName: null,
    conversationShopId: null,
    conversationShopOwnerId: null,
    conversationShopOwnerDisplayName: null,
    conversationShopName: null,
    ...overrides,
  };
}

function params(reportId = "report-1") {
  return { params: Promise.resolve({ reportId }) };
}

describe("AdminReportDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAdminUserRestrictionsMock.mockResolvedValue({ status: "found", restrictions: [] });
  });

  it("redirects a guest to sign-in with the report-specific next path", async () => {
    getAuthUserMock.mockResolvedValue(null);
    await expect(AdminReportDetailPage(params("report-1"))).rejects.toThrow("NEXT_REDIRECT:/sign-in?next=%2Fadmin%2Freports%2Freport-1");
    expect(getAdminReportDetailMock).not.toHaveBeenCalled();
  });

  it("calls notFound() for a non-admin caller", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: "user@example.com" });
    getAdminReportDetailMock.mockResolvedValue({ status: "not_admin" });
    await expect(AdminReportDetailPage(params())).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("calls notFound() for a nonexistent report", async () => {
    getAuthUserMock.mockResolvedValue({ id: "admin-1", email: "admin@example.com" });
    getAdminReportDetailMock.mockResolvedValue({ status: "not_found" });
    await expect(AdminReportDetailPage(params())).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("shows a safe error state on an unexpected read error", async () => {
    getAuthUserMock.mockResolvedValue({ id: "admin-1", email: "admin@example.com" });
    getAdminReportDetailMock.mockResolvedValue({ status: "error" });
    render(await AdminReportDetailPage(params()));
    expect(screen.getByText(/unable to load this report/i)).toBeInTheDocument();
  });

  it("renders the report and resolves the listing's shop owner as the one involved user", async () => {
    getAuthUserMock.mockResolvedValue({ id: "admin-1", email: "admin@example.com" });
    getAdminReportDetailMock.mockResolvedValue({ status: "found", report: makeReport() });

    render(await AdminReportDetailPage(params()));

    expect(getAdminUserRestrictionsMock).toHaveBeenCalledWith("owner-1");
    expect(screen.getByText("Anne S.")).toBeInTheDocument();
    expect(screen.getByText(/Nike Air Max 270/)).toBeInTheDocument();
  });

  it("resolves two involved users (buyer and shop owner) for a conversation report", async () => {
    getAuthUserMock.mockResolvedValue({ id: "admin-1", email: "admin@example.com" });
    getAdminReportDetailMock.mockResolvedValue({
      status: "found",
      report: makeReport({
        targetType: "conversation",
        listingId: null,
        listingTitle: null,
        listingShopId: null,
        listingShopOwnerId: null,
        listingShopOwnerDisplayName: null,
        conversationId: "conv-1",
        conversationBuyerId: "buyer-1",
        conversationBuyerDisplayName: "Bob B.",
        conversationShopId: "shop-2",
        conversationShopOwnerId: "owner-2",
        conversationShopOwnerDisplayName: "Carla C.",
        conversationShopName: "Carla's Shop",
      }),
    });

    render(await AdminReportDetailPage(params()));

    expect(getAdminUserRestrictionsMock).toHaveBeenCalledWith("buyer-1");
    expect(getAdminUserRestrictionsMock).toHaveBeenCalledWith("owner-2");
    expect(screen.getByText("Bob B.")).toBeInTheDocument();
    expect(screen.getByText("Carla C.")).toBeInTheDocument();
  });
});
