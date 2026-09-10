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

import { findUserForRoleAssignment, grantAdminRole, revokeAdminRole } from "@/lib/admin/admin-role-actions";

beforeEach(() => {
  rpcMock.mockReset();
  fromMock.mockClear();
});

describe("findUserForRoleAssignment", () => {
  it("calls find_user_for_role_assignment with the email, never touching .from()", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    await findUserForRoleAssignment("jane@example.com");
    expect(rpcMock).toHaveBeenCalledWith("find_user_for_role_assignment", { p_email: "jane@example.com" });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("maps a found row to a minimal identity shape", async () => {
    rpcMock.mockResolvedValue({
      data: [{ user_id: "user-1", display_name: "Jane D.", email: "jane@example.com", existing_role: null }],
      error: null,
    });
    const result = await findUserForRoleAssignment("jane@example.com");
    expect(result).toEqual({
      ok: true,
      user: { userId: "user-1", displayName: "Jane D.", email: "jane@example.com", currentRole: null },
    });
  });

  it("returns ok:true with user:null for zero matching rows -- not an error", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    const result = await findUserForRoleAssignment("nobody@example.com");
    expect(result).toEqual({ ok: true, user: null });
  });

  it("maps NOT_SUPER_ADMIN", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "denied", details: "NOT_SUPER_ADMIN" } });
    const result = await findUserForRoleAssignment("jane@example.com");
    expect(result).toEqual({ ok: false, code: "NOT_SUPER_ADMIN" });
  });

  it("maps EMAIL_REQUIRED", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "denied", details: "EMAIL_REQUIRED" } });
    const result = await findUserForRoleAssignment("");
    expect(result).toEqual({ ok: false, code: "EMAIL_REQUIRED" });
  });
});

describe("grantAdminRole", () => {
  it("calls grant_admin_role with the user id, role, and reason (null when omitted)", async () => {
    rpcMock.mockResolvedValue({ data: [{ user_id: "user-1", role: "admin", previous_role: null }], error: null });
    await grantAdminRole("user-1", "admin");
    expect(rpcMock).toHaveBeenCalledWith("grant_admin_role", { p_user_id: "user-1", p_role: "admin", p_reason: null });
  });

  it("passes a supplied reason through", async () => {
    rpcMock.mockResolvedValue({ data: [{ user_id: "user-1", role: "admin", previous_role: null }], error: null });
    await grantAdminRole("user-1", "admin", "Trusted moderator");
    expect(rpcMock).toHaveBeenCalledWith("grant_admin_role", { p_user_id: "user-1", p_role: "admin", p_reason: "Trusted moderator" });
  });

  it("returns ok:true with the new and previous role", async () => {
    rpcMock.mockResolvedValue({ data: [{ user_id: "user-1", role: "super_admin", previous_role: "admin" }], error: null });
    const result = await grantAdminRole("user-1", "super_admin");
    expect(result).toEqual({ ok: true, userId: "user-1", role: "super_admin", previousRole: "admin" });
  });

  it("maps TARGET_USER_NOT_FOUND", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "missing", details: "TARGET_USER_NOT_FOUND" } });
    const result = await grantAdminRole("user-1", "admin");
    expect(result).toEqual({ ok: false, code: "TARGET_USER_NOT_FOUND" });
  });

  it("maps LAST_SUPER_ADMIN", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "denied", details: "LAST_SUPER_ADMIN" } });
    const result = await grantAdminRole("user-1", "admin");
    expect(result).toEqual({ ok: false, code: "LAST_SUPER_ADMIN" });
  });

  it("returns UNKNOWN when the RPC throws", async () => {
    rpcMock.mockRejectedValue(new Error("network down"));
    const result = await grantAdminRole("user-1", "admin");
    expect(result).toEqual({ ok: false, code: "UNKNOWN" });
  });
});

describe("revokeAdminRole", () => {
  it("calls revoke_admin_role with the user id and reason (null when omitted)", async () => {
    rpcMock.mockResolvedValue({ data: [{ user_id: "user-1", previous_role: "admin" }], error: null });
    await revokeAdminRole("user-1");
    expect(rpcMock).toHaveBeenCalledWith("revoke_admin_role", { p_user_id: "user-1", p_reason: null });
  });

  it("returns ok:true with the previous role", async () => {
    rpcMock.mockResolvedValue({ data: [{ user_id: "user-1", previous_role: "admin" }], error: null });
    const result = await revokeAdminRole("user-1", "No longer needed");
    expect(result).toEqual({ ok: true, userId: "user-1", previousRole: "admin" });
  });

  it("maps TARGET_HAS_NO_ROLE", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "denied", details: "TARGET_HAS_NO_ROLE" } });
    const result = await revokeAdminRole("user-1");
    expect(result).toEqual({ ok: false, code: "TARGET_HAS_NO_ROLE" });
  });

  it("maps LAST_SUPER_ADMIN", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "denied", details: "LAST_SUPER_ADMIN" } });
    const result = await revokeAdminRole("user-1");
    expect(result).toEqual({ ok: false, code: "LAST_SUPER_ADMIN" });
  });

  it("returns UNKNOWN when the RPC throws", async () => {
    rpcMock.mockRejectedValue(new Error("network down"));
    const result = await revokeAdminRole("user-1");
    expect(result).toEqual({ ok: false, code: "UNKNOWN" });
  });
});
