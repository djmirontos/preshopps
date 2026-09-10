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

import { blockUser, unblockUser } from "@/lib/messaging/block-actions";

beforeEach(() => {
  rpcMock.mockReset();
  fromMock.mockClear();
});

describe("blockUser", () => {
  it("calls block_user with exactly the blocked id -- no blocker id sent", async () => {
    rpcMock.mockResolvedValue({ data: [{ blocked_id: "other-user-1", created_at: "2026-01-05T00:00:00.000Z" }], error: null });

    await blockUser("other-user-1");

    expect(rpcMock).toHaveBeenCalledWith("block_user", { p_blocked_id: "other-user-1" });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("returns the blocked id and created_at on success", async () => {
    rpcMock.mockResolvedValue({ data: [{ blocked_id: "other-user-1", created_at: "2026-01-05T00:00:00.000Z" }], error: null });
    const result = await blockUser("other-user-1");
    expect(result).toEqual({ ok: true, blockedId: "other-user-1", createdAt: "2026-01-05T00:00:00.000Z" });
  });

  it.each(["NOT_AUTHENTICATED", "INTERACTION_BLOCKED", "CANNOT_BLOCK_SELF", "USER_NOT_FOUND"])(
    "maps the live block_user error code %s",
    async (code) => {
      rpcMock.mockResolvedValue({ data: null, error: { message: "failed", details: code } });
      const result = await blockUser("other-user-1");
      expect(result).toEqual({ ok: false, code });
    },
  );

  it("maps an unrecognized error detail to UNKNOWN", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "raw postgres error", details: "23505" } });
    const result = await blockUser("other-user-1");
    expect(result).toEqual({ ok: false, code: "UNKNOWN" });
  });

  it("returns UNKNOWN when the RPC throws", async () => {
    rpcMock.mockRejectedValue(new Error("network down"));
    const result = await blockUser("other-user-1");
    expect(result).toEqual({ ok: false, code: "UNKNOWN" });
  });
});

describe("unblockUser", () => {
  it("calls unblock_user with exactly the blocked id, and never touches .from() directly", async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });

    await unblockUser("other-user-1");

    expect(rpcMock).toHaveBeenCalledWith("unblock_user", { p_blocked_id: "other-user-1" });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("returns ok: true on success", async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });
    const result = await unblockUser("other-user-1");
    expect(result).toEqual({ ok: true });
  });

  it.each(["NOT_AUTHENTICATED", "INTERACTION_BLOCKED"])("maps the live unblock_user error code %s", async (code) => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "failed", details: code } });
    const result = await unblockUser("other-user-1");
    expect(result).toEqual({ ok: false, code });
  });

  it("returns UNKNOWN when the RPC throws", async () => {
    rpcMock.mockRejectedValue(new Error("network down"));
    const result = await unblockUser("other-user-1");
    expect(result).toEqual({ ok: false, code: "UNKNOWN" });
  });
});
