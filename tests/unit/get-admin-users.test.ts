import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock, createClientMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  createClientMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: createClientMock,
}));

createClientMock.mockResolvedValue({ rpc: rpcMock });

import { getAdminUsers } from "@/lib/admin/get-admin-users";

function row(overrides: Record<string, unknown> = {}) {
  return {
    user_id: "user-1",
    display_name: "Jane D.",
    email: "jane@example.com",
    role: "admin",
    granted_by: "super-1",
    granted_by_display_name: "Sam S.",
    created_at: "2026-01-05T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  rpcMock.mockReset();
});

describe("getAdminUsers", () => {
  it("calls get_admin_users with no arguments", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    await getAdminUsers();
    expect(rpcMock).toHaveBeenCalledWith("get_admin_users");
  });

  it("maps rows to AdminUserSummary", async () => {
    rpcMock.mockResolvedValue({ data: [row()], error: null });
    const result = await getAdminUsers();
    expect(result).toEqual({
      status: "found",
      users: [
        {
          userId: "user-1",
          displayName: "Jane D.",
          email: "jane@example.com",
          role: "admin",
          grantedBy: "super-1",
          grantedByDisplayName: "Sam S.",
          createdAt: "2026-01-05T00:00:00.000Z",
        },
      ],
    });
  });

  it("maps a bootstrap row (no granted_by) correctly", async () => {
    rpcMock.mockResolvedValue({ data: [row({ granted_by: null, granted_by_display_name: null })], error: null });
    const result = await getAdminUsers();
    expect(result.status).toBe("found");
    if (result.status !== "found") return;
    expect(result.users[0].grantedBy).toBeNull();
    expect(result.users[0].grantedByDisplayName).toBeNull();
  });

  it("returns not_super_admin for NOT_SUPER_ADMIN, distinct from a generic error", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "denied", details: "NOT_SUPER_ADMIN" } });
    const result = await getAdminUsers();
    expect(result).toEqual({ status: "not_super_admin" });
  });

  it("returns error for any other error", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "boom", details: "NOT_AUTHENTICATED" } });
    const result = await getAdminUsers();
    expect(result).toEqual({ status: "error" });
  });

  it("returns error when the RPC throws", async () => {
    rpcMock.mockRejectedValue(new Error("network down"));
    const result = await getAdminUsers();
    expect(result).toEqual({ status: "error" });
  });
});
