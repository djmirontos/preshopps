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

import { anonymizeUserAccount } from "@/lib/admin/account-anonymization-actions";

beforeEach(() => {
  rpcMock.mockReset();
  fromMock.mockClear();
});

describe("anonymizeUserAccount", () => {
  it("calls anonymize_user_account with the user id and reason, never touching .from()", async () => {
    rpcMock.mockResolvedValue({ data: [{ user_id: "user-1", was_already_anonymized: false, anonymized_at: "2026-02-01T00:00:00.000Z" }], error: null });
    await anonymizeUserAccount("user-1", "User requested deletion.");
    expect(rpcMock).toHaveBeenCalledWith("anonymize_user_account", { p_user_id: "user-1", p_reason: "User requested deletion." });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("returns ok:true with wasAlreadyAnonymized and anonymizedAt on success", async () => {
    rpcMock.mockResolvedValue({ data: [{ user_id: "user-1", was_already_anonymized: false, anonymized_at: "2026-02-01T00:00:00.000Z" }], error: null });
    const result = await anonymizeUserAccount("user-1", "reason");
    expect(result).toEqual({ ok: true, userId: "user-1", wasAlreadyAnonymized: false, anonymizedAt: "2026-02-01T00:00:00.000Z" });
  });

  it("surfaces wasAlreadyAnonymized:true for a repeat call, distinct from a fresh anonymization", async () => {
    rpcMock.mockResolvedValue({ data: [{ user_id: "user-1", was_already_anonymized: true, anonymized_at: "2026-01-15T00:00:00.000Z" }], error: null });
    const result = await anonymizeUserAccount("user-1", "reason");
    expect(result).toEqual({ ok: true, userId: "user-1", wasAlreadyAnonymized: true, anonymizedAt: "2026-01-15T00:00:00.000Z" });
  });

  it("maps NOT_ADMIN", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "denied", details: "NOT_ADMIN" } });
    const result = await anonymizeUserAccount("user-1", "reason");
    expect(result).toEqual({ ok: false, code: "NOT_ADMIN" });
  });

  it("maps REASON_REQUIRED", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "denied", details: "REASON_REQUIRED" } });
    const result = await anonymizeUserAccount("user-1", "");
    expect(result).toEqual({ ok: false, code: "REASON_REQUIRED" });
  });

  it("maps USER_NOT_FOUND", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "missing", details: "USER_NOT_FOUND" } });
    const result = await anonymizeUserAccount("user-1", "reason");
    expect(result).toEqual({ ok: false, code: "USER_NOT_FOUND" });
  });

  it("maps SUPER_ADMIN_REQUIRED_FOR_ADMIN_TARGET", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "denied", details: "SUPER_ADMIN_REQUIRED_FOR_ADMIN_TARGET" } });
    const result = await anonymizeUserAccount("user-1", "reason");
    expect(result).toEqual({ ok: false, code: "SUPER_ADMIN_REQUIRED_FOR_ADMIN_TARGET" });
  });

  it("maps LAST_SUPER_ADMIN", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "denied", details: "LAST_SUPER_ADMIN" } });
    const result = await anonymizeUserAccount("user-1", "reason");
    expect(result).toEqual({ ok: false, code: "LAST_SUPER_ADMIN" });
  });

  it("returns UNKNOWN when the RPC throws", async () => {
    rpcMock.mockRejectedValue(new Error("network down"));
    const result = await anonymizeUserAccount("user-1", "reason");
    expect(result).toEqual({ ok: false, code: "UNKNOWN" });
  });
});
