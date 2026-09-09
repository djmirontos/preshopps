import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock, createClientMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  createClientMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: createClientMock,
}));

createClientMock.mockResolvedValue({ rpc: rpcMock });

import { getAdminReports } from "@/lib/admin/get-admin-reports";

function row(overrides: Record<string, unknown> = {}) {
  return {
    report_id: "report-1",
    target_type: "listing",
    target_label: "Nike Air Max 270",
    reason: "spam",
    status: "pending",
    reporter_display_name: "Jane D.",
    created_at: "2026-01-05T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  rpcMock.mockReset();
});

describe("getAdminReports", () => {
  it("calls get_admin_reports with limit, null status, and null cursor on the unfiltered first page", async () => {
    rpcMock.mockResolvedValue({ data: [row()], error: null });
    await getAdminReports(20);
    expect(rpcMock).toHaveBeenCalledWith("get_admin_reports", {
      p_status: null,
      p_limit: 20,
      p_before_created_at: null,
      p_before_id: null,
    });
  });

  it("passes the status filter through unchanged", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    await getAdminReports(20, "resolved");
    expect(rpcMock).toHaveBeenCalledWith("get_admin_reports", {
      p_status: "resolved",
      p_limit: 20,
      p_before_created_at: null,
      p_before_id: null,
    });
  });

  it("maps rows to AdminReportSummary", async () => {
    rpcMock.mockResolvedValue({ data: [row()], error: null });
    const result = await getAdminReports(20);
    expect(result.reports).toEqual([
      {
        reportId: "report-1",
        targetType: "listing",
        targetLabel: "Nike Air Max 270",
        reason: "spam",
        status: "pending",
        reporterDisplayName: "Jane D.",
        createdAt: "2026-01-05T00:00:00.000Z",
      },
    ]);
    expect(result.hadError).toBe(false);
    expect(result.notAdmin).toBe(false);
  });

  it("surfaces NOT_ADMIN as notAdmin: true, distinct from a generic error", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "denied", details: "NOT_ADMIN" } });
    const result = await getAdminReports(20);
    expect(result).toEqual({ reports: [], hadError: false, notAdmin: true, nextCursor: null });
  });

  it("returns hadError true for any other error", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "boom", details: "LIMIT_INVALID" } });
    const result = await getAdminReports(20);
    expect(result).toEqual({ reports: [], hadError: true, notAdmin: false, nextCursor: null });
  });

  it("returns hadError true when the RPC throws", async () => {
    rpcMock.mockRejectedValue(new Error("network down"));
    const result = await getAdminReports(20);
    expect(result).toEqual({ reports: [], hadError: true, notAdmin: false, nextCursor: null });
  });

  it("returns a nextCursor derived from the last row when a full page is returned", async () => {
    rpcMock.mockResolvedValue({
      data: [row({ report_id: "r1", created_at: "2026-01-05T00:00:00.000Z" }), row({ report_id: "r2", created_at: "2026-01-04T00:00:00.000Z" })],
      error: null,
    });
    const result = await getAdminReports(2);
    expect(result.nextCursor).toEqual({ createdAt: "2026-01-04T00:00:00.000Z", id: "r2" });
  });

  it("returns an empty list (not an error) when there are simply no matching reports", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    const result = await getAdminReports(20, "dismissed");
    expect(result).toEqual({ reports: [], hadError: false, notAdmin: false, nextCursor: null });
  });
});
