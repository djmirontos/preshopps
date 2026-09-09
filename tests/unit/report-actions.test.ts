import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock, fromMock, createClientMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  fromMock: vi.fn(() => {
    throw new Error("must not access .from() directly -- use the RPC only");
  }),
  createClientMock: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: createClientMock,
}));

createClientMock.mockReturnValue({ rpc: rpcMock, from: fromMock });

import { submitReport } from "@/lib/moderation/report-actions";

beforeEach(() => {
  rpcMock.mockReset();
  fromMock.mockClear();
});

describe("submitReport", () => {
  it("calls submit_report with exactly target type, target id, reason, and description -- no reporter id", async () => {
    rpcMock.mockResolvedValue({ data: [{ report_id: "report-1", created_at: "2026-01-05T00:00:00.000Z" }], error: null });

    await submitReport("listing", "listing-1", "spam", "This looks fake.");

    expect(rpcMock).toHaveBeenCalledWith("submit_report", {
      p_target_type: "listing",
      p_target_id: "listing-1",
      p_reason: "spam",
      p_description: "This looks fake.",
    });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("passes a null description through unchanged", async () => {
    rpcMock.mockResolvedValue({ data: [{ report_id: "report-1", created_at: "now" }], error: null });
    await submitReport("shop", "shop-1", "other", null);
    expect(rpcMock).toHaveBeenCalledWith("submit_report", {
      p_target_type: "shop",
      p_target_id: "shop-1",
      p_reason: "other",
      p_description: null,
    });
  });

  it("returns the report id and created_at on success", async () => {
    rpcMock.mockResolvedValue({ data: [{ report_id: "report-1", created_at: "2026-01-05T00:00:00.000Z" }], error: null });
    const result = await submitReport("review", "review-1", "harassment", null);
    expect(result).toEqual({ ok: true, reportId: "report-1", createdAt: "2026-01-05T00:00:00.000Z" });
  });

  it.each([
    "NOT_AUTHENTICATED",
    "INTERACTION_BLOCKED",
    "TARGET_TYPE_INVALID",
    "REPORT_DESCRIPTION_TOO_LONG",
    "LISTING_NOT_FOUND",
    "SHOP_NOT_FOUND",
    "REVIEW_NOT_FOUND",
    "CONVERSATION_NOT_FOUND",
    "SELF_REPORT_NOT_ALLOWED",
    "NOT_CONVERSATION_PARTICIPANT",
  ])("maps the live submit_report error code %s", async (code) => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "failed", details: code } });
    const result = await submitReport("conversation", "conv-1", "other", null);
    expect(result).toEqual({ ok: false, code });
  });

  it("maps an unrecognized error detail to UNKNOWN", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "raw postgres error", details: "23505" } });
    const result = await submitReport("listing", "listing-1", "spam", null);
    expect(result).toEqual({ ok: false, code: "UNKNOWN" });
  });

  it("returns UNKNOWN when the RPC throws", async () => {
    rpcMock.mockRejectedValue(new Error("network down"));
    const result = await submitReport("listing", "listing-1", "spam", null);
    expect(result).toEqual({ ok: false, code: "UNKNOWN" });
  });
});
