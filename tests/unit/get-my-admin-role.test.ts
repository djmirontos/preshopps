import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock, createClientMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  createClientMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: createClientMock,
}));

createClientMock.mockResolvedValue({ rpc: rpcMock });

import { getMyAdminRole } from "@/lib/admin/get-my-admin-role";

beforeEach(() => {
  rpcMock.mockReset();
});

describe("getMyAdminRole", () => {
  it("calls get_my_admin_role with no arguments", async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });
    await getMyAdminRole();
    expect(rpcMock).toHaveBeenCalledWith("get_my_admin_role");
  });

  it("returns the caller's role when set", async () => {
    rpcMock.mockResolvedValue({ data: "super_admin", error: null });
    expect(await getMyAdminRole()).toBe("super_admin");
  });

  it("returns null for an ordinary user (no row)", async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });
    expect(await getMyAdminRole()).toBeNull();
  });

  it("returns null (never throws) when the RPC errors", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect(await getMyAdminRole()).toBeNull();
  });

  it("returns null (never throws) when the RPC itself throws", async () => {
    rpcMock.mockRejectedValue(new Error("network down"));
    expect(await getMyAdminRole()).toBeNull();
  });
});
