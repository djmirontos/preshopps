import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUser } from "@/lib/auth/session";

const { rpcMock, createClientMock, getAuthUserMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  createClientMock: vi.fn(),
  getAuthUserMock: vi.fn<() => Promise<AuthUser | null>>(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: createClientMock,
}));

vi.mock("@/lib/auth/session", () => ({
  getAuthUser: getAuthUserMock,
}));

createClientMock.mockResolvedValue({ rpc: rpcMock });

import { getMyActiveRestrictions } from "@/lib/moderation/get-my-active-restrictions";

beforeEach(() => {
  rpcMock.mockReset();
  getAuthUserMock.mockReset();
});

describe("getMyActiveRestrictions", () => {
  it("returns an empty, error-free result for a guest without ever calling the RPC (no round trip)", async () => {
    getAuthUserMock.mockResolvedValue(null);
    const result = await getMyActiveRestrictions();
    expect(result).toEqual({ restrictions: [], hadError: false });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("calls get_my_active_restrictions with no arguments for an authenticated user", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: "buyer@example.com" });
    rpcMock.mockResolvedValue({ data: [], error: null });
    await getMyActiveRestrictions();
    expect(rpcMock).toHaveBeenCalledWith("get_my_active_restrictions");
  });

  it("maps zero rows to an empty restrictions array", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: "buyer@example.com" });
    rpcMock.mockResolvedValue({ data: [], error: null });
    const result = await getMyActiveRestrictions();
    expect(result).toEqual({ restrictions: [], hadError: false });
  });

  it("maps all three restriction types correctly, field-for-field", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: "buyer@example.com" });
    rpcMock.mockResolvedValue({
      data: [
        { restriction_id: "r1", restriction_type: "seller_suspended", reason: "Repeated late shipments.", created_at: "2026-09-01T00:00:00.000Z" },
        { restriction_id: "r2", restriction_type: "buyer_restricted", reason: "Multiple order no-shows.", created_at: "2026-09-05T00:00:00.000Z" },
        { restriction_id: "r3", restriction_type: "account_suspended", reason: "Policy violation.", created_at: "2026-09-10T00:00:00.000Z" },
      ],
      error: null,
    });
    const result = await getMyActiveRestrictions();
    expect(result).toEqual({
      restrictions: [
        { restrictionId: "r1", restrictionType: "seller_suspended", reason: "Repeated late shipments.", createdAt: "2026-09-01T00:00:00.000Z" },
        { restrictionId: "r2", restrictionType: "buyer_restricted", reason: "Multiple order no-shows.", createdAt: "2026-09-05T00:00:00.000Z" },
        { restrictionId: "r3", restrictionType: "account_suspended", reason: "Policy violation.", createdAt: "2026-09-10T00:00:00.000Z" },
      ],
      hadError: false,
    });
  });

  it("fails open to an empty list (not a thrown error) on an RPC error", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: "buyer@example.com" });
    rpcMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    const result = await getMyActiveRestrictions();
    expect(result).toEqual({ restrictions: [], hadError: true });
  });

  it("fails open to an empty list when the RPC throws (network failure)", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: "buyer@example.com" });
    rpcMock.mockRejectedValue(new Error("network down"));
    const result = await getMyActiveRestrictions();
    expect(result).toEqual({ restrictions: [], hadError: true });
  });
});
