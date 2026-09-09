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

import { resolveAdminReport, applyUserRestriction, liftUserRestriction } from "@/lib/admin/moderation-actions";

beforeEach(() => {
  rpcMock.mockReset();
  fromMock.mockClear();
});

describe("resolveAdminReport", () => {
  it("calls resolve_admin_report with report id, status, and note", async () => {
    rpcMock.mockResolvedValue({
      data: [{ report_id: "report-1", status: "resolved", was_already_in_status: false, resolved_at: "now" }],
      error: null,
    });
    await resolveAdminReport("report-1", "resolved", "Handled.");
    expect(rpcMock).toHaveBeenCalledWith("resolve_admin_report", {
      p_report_id: "report-1",
      p_status: "resolved",
      p_resolution_note: "Handled.",
    });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it.each(["NOT_AUTHENTICATED", "NOT_ADMIN", "TARGET_STATUS_NOT_ALLOWED", "REPORT_NOT_FOUND", "RESOLUTION_NOTE_TOO_LONG"])(
    "maps the live error code %s",
    async (code) => {
      rpcMock.mockResolvedValue({ data: null, error: { message: "failed", details: code } });
      const result = await resolveAdminReport("report-1", "dismissed", null);
      expect(result).toEqual({ ok: false, code });
    },
  );

  it("returns UNKNOWN when the RPC throws", async () => {
    rpcMock.mockRejectedValue(new Error("network down"));
    const result = await resolveAdminReport("report-1", "resolved", null);
    expect(result).toEqual({ ok: false, code: "UNKNOWN" });
  });
});

describe("applyUserRestriction", () => {
  it("calls apply_user_restriction with user id, restriction type, and reason -- no admin/caller id", async () => {
    rpcMock.mockResolvedValue({
      data: [{ restriction_id: "r1", user_id: "user-1", restriction_type: "seller_suspended", was_already_active: false, created_at: "now" }],
      error: null,
    });
    await applyUserRestriction("user-1", "seller_suspended", "Repeated scam reports.");
    expect(rpcMock).toHaveBeenCalledWith("apply_user_restriction", {
      p_user_id: "user-1",
      p_restriction_type: "seller_suspended",
      p_reason: "Repeated scam reports.",
    });
    const args = rpcMock.mock.calls[0][1];
    expect(Object.keys(args).sort()).toEqual(["p_reason", "p_restriction_type", "p_user_id"]);
  });

  it("returns wasAlreadyActive on an idempotent apply", async () => {
    rpcMock.mockResolvedValue({
      data: [{ restriction_id: "r1", user_id: "user-1", restriction_type: "buyer_restricted", was_already_active: true, created_at: "now" }],
      error: null,
    });
    const result = await applyUserRestriction("user-1", "buyer_restricted", "test");
    expect(result).toEqual({ ok: true, restrictionId: "r1", userId: "user-1", restrictionType: "buyer_restricted", wasAlreadyActive: true, createdAt: "now" });
  });

  it.each(["NOT_AUTHENTICATED", "NOT_ADMIN", "RESTRICTION_TYPE_REQUIRED", "REASON_REQUIRED", "USER_NOT_FOUND"])(
    "maps the live error code %s",
    async (code) => {
      rpcMock.mockResolvedValue({ data: null, error: { message: "failed", details: code } });
      const result = await applyUserRestriction("user-1", "account_suspended", "");
      expect(result).toEqual({ ok: false, code });
    },
  );

  it("returns UNKNOWN when the RPC throws", async () => {
    rpcMock.mockRejectedValue(new Error("network down"));
    const result = await applyUserRestriction("user-1", "seller_suspended", "reason");
    expect(result).toEqual({ ok: false, code: "UNKNOWN" });
  });
});

describe("liftUserRestriction", () => {
  it("calls lift_user_restriction with restriction id and note", async () => {
    rpcMock.mockResolvedValue({
      data: [{ restriction_id: "r1", user_id: "user-1", restriction_type: "seller_suspended", was_already_lifted: false, lifted_at: "now" }],
      error: null,
    });
    await liftUserRestriction("r1", "Appeal approved.");
    expect(rpcMock).toHaveBeenCalledWith("lift_user_restriction", { p_restriction_id: "r1", p_note: "Appeal approved." });
  });

  it("allows a null note", async () => {
    rpcMock.mockResolvedValue({
      data: [{ restriction_id: "r1", user_id: "user-1", restriction_type: "seller_suspended", was_already_lifted: false, lifted_at: "now" }],
      error: null,
    });
    await liftUserRestriction("r1", null);
    expect(rpcMock).toHaveBeenCalledWith("lift_user_restriction", { p_restriction_id: "r1", p_note: null });
  });

  it("returns wasAlreadyLifted on an idempotent lift", async () => {
    rpcMock.mockResolvedValue({
      data: [{ restriction_id: "r1", user_id: "user-1", restriction_type: "seller_suspended", was_already_lifted: true, lifted_at: "now" }],
      error: null,
    });
    const result = await liftUserRestriction("r1", null);
    expect(result).toEqual({ ok: true, restrictionId: "r1", userId: "user-1", restrictionType: "seller_suspended", wasAlreadyLifted: true, liftedAt: "now" });
  });

  it.each(["NOT_AUTHENTICATED", "NOT_ADMIN", "RESTRICTION_NOT_FOUND", "RESOLUTION_NOTE_TOO_LONG"])("maps the live error code %s", async (code) => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "failed", details: code } });
    const result = await liftUserRestriction("r1", null);
    expect(result).toEqual({ ok: false, code });
  });

  it("returns UNKNOWN when the RPC throws", async () => {
    rpcMock.mockRejectedValue(new Error("network down"));
    const result = await liftUserRestriction("r1", null);
    expect(result).toEqual({ ok: false, code: "UNKNOWN" });
  });
});
