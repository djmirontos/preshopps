import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ rpc: rpcMock }),
}));

import { getMyActiveRestrictionsClient } from "@/lib/moderation/get-my-active-restrictions-client";

beforeEach(() => {
  rpcMock.mockReset();
});

describe("getMyActiveRestrictionsClient", () => {
  it("calls the exact scalar RPC with no arguments", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    await getMyActiveRestrictionsClient();

    expect(rpcMock).toHaveBeenCalledWith("get_my_active_restrictions");
  });

  it("maps rows to camelCase restrictions on success", async () => {
    rpcMock.mockResolvedValue({
      data: [{ restriction_id: "r1", restriction_type: "buyer_restricted", reason: "abuse", created_at: "2026-01-01T00:00:00.000Z" }],
      error: null,
    });

    const result = await getMyActiveRestrictionsClient();

    expect(result).toEqual({
      ok: true,
      restrictions: [{ restrictionId: "r1", restrictionType: "buyer_restricted", reason: "abuse", createdAt: "2026-01-01T00:00:00.000Z" }],
    });
  });

  it("returns { ok: true, restrictions: [] } for a genuinely empty result", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    const result = await getMyActiveRestrictionsClient();
    expect(result).toEqual({ ok: true, restrictions: [] });
  });

  it("returns { ok: false } (never throws) when the RPC returns an error", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    const result = await getMyActiveRestrictionsClient();
    expect(result).toEqual({ ok: false });
  });

  it("returns { ok: false } (never throws) when the RPC call itself throws", async () => {
    rpcMock.mockRejectedValue(new Error("network error"));
    const result = await getMyActiveRestrictionsClient();
    expect(result).toEqual({ ok: false });
  });

  it("never exposes the raw Supabase error message in the returned result", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "raw backend detail that must never reach the UI" } });
    const result = await getMyActiveRestrictionsClient();
    expect(JSON.stringify(result)).not.toMatch(/raw backend detail/);
  });
});
