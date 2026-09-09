import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock, createClientMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  createClientMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: createClientMock,
}));

createClientMock.mockResolvedValue({ rpc: rpcMock });

import { getAdminReportDetail } from "@/lib/admin/get-admin-report-detail";

function row(overrides: Record<string, unknown> = {}) {
  return {
    report_id: "report-1",
    target_type: "listing",
    reason: "spam",
    description: "Looks fake.",
    status: "pending",
    created_at: "2026-01-05T00:00:00.000Z",
    reporter_id: "u1",
    reporter_display_name: "Jane D.",
    resolved_by: null,
    resolved_by_display_name: null,
    resolved_at: null,
    resolution_note: null,
    listing_id: "listing-1",
    listing_title: "Nike Air Max 270",
    listing_shop_id: "shop-1",
    listing_shop_owner_id: "owner-1",
    listing_shop_owner_display_name: "Anne S.",
    shop_id: null,
    shop_name: null,
    shop_owner_id: null,
    shop_owner_display_name: null,
    review_id: null,
    review_rating: null,
    review_body: null,
    review_author_id: null,
    review_author_display_name: null,
    conversation_id: null,
    conversation_buyer_id: null,
    conversation_buyer_display_name: null,
    conversation_shop_id: null,
    conversation_shop_owner_id: null,
    conversation_shop_owner_display_name: null,
    conversation_shop_name: null,
    ...overrides,
  };
}

beforeEach(() => {
  rpcMock.mockReset();
});

describe("getAdminReportDetail", () => {
  it("calls get_admin_report_detail with the report id", async () => {
    rpcMock.mockResolvedValue({ data: [row()], error: null });
    await getAdminReportDetail("report-1");
    expect(rpcMock).toHaveBeenCalledWith("get_admin_report_detail", { p_report_id: "report-1" });
  });

  it("maps a found row to AdminReportDetail", async () => {
    rpcMock.mockResolvedValue({ data: [row()], error: null });
    const result = await getAdminReportDetail("report-1");
    expect(result.status).toBe("found");
    if (result.status !== "found") return;
    expect(result.report.listingTitle).toBe("Nike Air Max 270");
    expect(result.report.listingShopOwnerId).toBe("owner-1");
    expect(result.report.listingShopOwnerDisplayName).toBe("Anne S.");
  });

  it("never exposes an email anywhere in the mapped result", async () => {
    rpcMock.mockResolvedValue({ data: [row()], error: null });
    const result = await getAdminReportDetail("report-1");
    expect(JSON.stringify(result)).not.toMatch(/@/);
  });

  it("returns not_admin for NOT_ADMIN, distinct from not_found", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "denied", details: "NOT_ADMIN" } });
    const result = await getAdminReportDetail("report-1");
    expect(result).toEqual({ status: "not_admin" });
  });

  it("returns not_found for REPORT_NOT_FOUND", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "missing", details: "REPORT_NOT_FOUND" } });
    const result = await getAdminReportDetail("report-1");
    expect(result).toEqual({ status: "not_found" });
  });

  it("returns error for any other failure", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "boom", details: "SOMETHING_ELSE" } });
    const result = await getAdminReportDetail("report-1");
    expect(result).toEqual({ status: "error" });
  });

  it("returns error when the RPC throws", async () => {
    rpcMock.mockRejectedValue(new Error("network down"));
    const result = await getAdminReportDetail("report-1");
    expect(result).toEqual({ status: "error" });
  });
});
