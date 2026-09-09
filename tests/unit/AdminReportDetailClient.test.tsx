import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

const { resolveAdminReportMock, applyUserRestrictionMock, liftUserRestrictionMock } = vi.hoisted(() => ({
  resolveAdminReportMock: vi.fn(),
  applyUserRestrictionMock: vi.fn(),
  liftUserRestrictionMock: vi.fn(),
}));

vi.mock("@/lib/admin/moderation-actions", async () => {
  const actual = await vi.importActual<typeof import("@/lib/admin/moderation-actions")>("@/lib/admin/moderation-actions");
  return {
    ...actual,
    resolveAdminReport: resolveAdminReportMock,
    applyUserRestriction: applyUserRestrictionMock,
    liftUserRestriction: liftUserRestrictionMock,
  };
});

import { AdminReportDetailClient } from "@/components/admin/AdminReportDetailClient";
import type { AdminReportDetail } from "@/lib/admin/get-admin-report-detail";
import type { AdminTargetUser } from "@/app/admin/reports/[reportId]/page";

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

function makeTarget(overrides: Partial<AdminTargetUser> = {}): AdminTargetUser {
  return {
    userId: "owner-1",
    displayName: "Anne S.",
    roleLabel: "Shop owner",
    restrictions: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AdminReportDetailClient -- resolve/dismiss", () => {
  it("shows Mark Resolved and Dismiss only while pending", () => {
    render(<AdminReportDetailClient report={makeReport()} targetUsers={[]} />);
    expect(screen.getByRole("button", { name: "Mark Resolved" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
  });

  it("hides resolve/dismiss controls once already resolved", () => {
    render(<AdminReportDetailClient report={makeReport({ status: "resolved", resolvedByDisplayName: "Admin A." })} targetUsers={[]} />);
    expect(screen.queryByRole("button", { name: "Mark Resolved" })).not.toBeInTheDocument();
    expect(screen.getByText(/Admin A\./)).toBeInTheDocument();
  });

  it("clicking Mark Resolved calls resolve_admin_report and updates the badge", async () => {
    resolveAdminReportMock.mockResolvedValue({ ok: true, reportId: "report-1", status: "resolved", wasAlreadyInStatus: false, resolvedAt: "now" });
    render(<AdminReportDetailClient report={makeReport()} targetUsers={[]} />);

    fireEvent.click(screen.getByRole("button", { name: "Mark Resolved" }));

    await waitFor(() => expect(resolveAdminReportMock).toHaveBeenCalledWith("report-1", "resolved", null));
    expect(await screen.findByText("Resolved")).toBeInTheDocument();
  });

  it("clicking Dismiss calls resolve_admin_report with dismissed", async () => {
    resolveAdminReportMock.mockResolvedValue({ ok: true, reportId: "report-1", status: "dismissed", wasAlreadyInStatus: false, resolvedAt: "now" });
    render(<AdminReportDetailClient report={makeReport()} targetUsers={[]} />);

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    await waitFor(() => expect(resolveAdminReportMock).toHaveBeenCalledWith("report-1", "dismissed", null));
  });

  it("shows a friendly error on failure, without crashing", async () => {
    resolveAdminReportMock.mockResolvedValue({ ok: false, code: "NOT_ADMIN" });
    render(<AdminReportDetailClient report={makeReport()} targetUsers={[]} />);

    fireEvent.click(screen.getByRole("button", { name: "Mark Resolved" }));

    expect(await screen.findByText(/admin access is required/i)).toBeInTheDocument();
  });
});

describe("AdminReportDetailClient -- restriction apply/lift", () => {
  it("shows 'No active restrictions' for a target with none", () => {
    render(<AdminReportDetailClient report={makeReport()} targetUsers={[makeTarget()]} />);
    expect(screen.getByText("No active restrictions.")).toBeInTheDocument();
  });

  it("Apply is disabled until a restriction type is chosen", () => {
    render(<AdminReportDetailClient report={makeReport()} targetUsers={[makeTarget()]} />);
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Restriction type for Anne S."), { target: { value: "seller_suspended" } });
    expect(screen.getByRole("button", { name: "Apply" })).not.toBeDisabled();
  });

  it("clicking Apply opens a confirmation dialog requiring a reason before applying", async () => {
    render(<AdminReportDetailClient report={makeReport()} targetUsers={[makeTarget()]} />);

    fireEvent.change(screen.getByLabelText("Restriction type for Anne S."), { target: { value: "seller_suspended" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "Apply Restriction" })).toBeDisabled();
    expect(applyUserRestrictionMock).not.toHaveBeenCalled();
  });

  it("confirming with a reason calls apply_user_restriction and shows the new restriction", async () => {
    applyUserRestrictionMock.mockResolvedValue({
      ok: true,
      restrictionId: "r1",
      userId: "owner-1",
      restrictionType: "seller_suspended",
      wasAlreadyActive: false,
      createdAt: "2026-01-05T00:00:00.000Z",
    });
    render(<AdminReportDetailClient report={makeReport()} targetUsers={[makeTarget()]} />);

    fireEvent.change(screen.getByLabelText("Restriction type for Anne S."), { target: { value: "seller_suspended" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Reason"), { target: { value: "Repeated scam reports." } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Apply Restriction" }));

    await waitFor(() => expect(applyUserRestrictionMock).toHaveBeenCalledWith("owner-1", "seller_suspended", "Repeated scam reports."));
    expect(within(await screen.findByRole("list")).getByText("Seller Suspended")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("Cancel closes the apply dialog without calling apply_user_restriction", async () => {
    render(<AdminReportDetailClient report={makeReport()} targetUsers={[makeTarget()]} />);

    fireEvent.change(screen.getByLabelText("Restriction type for Anne S."), { target: { value: "seller_suspended" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(applyUserRestrictionMock).not.toHaveBeenCalled();
  });

  it("shows a Lift button for an active restriction, gated behind a confirmation dialog", async () => {
    liftUserRestrictionMock.mockResolvedValue({
      ok: true,
      restrictionId: "r1",
      userId: "owner-1",
      restrictionType: "seller_suspended",
      wasAlreadyLifted: false,
      liftedAt: "2026-01-06T00:00:00.000Z",
    });
    const target = makeTarget({
      restrictions: [
        {
          restrictionId: "r1",
          restrictionType: "seller_suspended",
          reason: "Scam reports",
          issuedBy: "admin-1",
          issuedByDisplayName: "Admin A.",
          createdAt: "2026-01-05T00:00:00.000Z",
          liftedAt: null,
          liftedBy: null,
          liftedByDisplayName: null,
        },
      ],
    });
    render(<AdminReportDetailClient report={makeReport()} targetUsers={[target]} />);

    expect(within(screen.getByRole("list")).getByText("Seller Suspended")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Lift" }));

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Lift Restriction" }));

    await waitFor(() => expect(liftUserRestrictionMock).toHaveBeenCalledWith("r1", null));
    expect(await screen.findByText("No active restrictions.")).toBeInTheDocument();
  });
});
