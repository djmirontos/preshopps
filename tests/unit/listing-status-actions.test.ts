import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock, fromMock, createClientMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  // Throws if ever called -- updateListingStatus must only ever call
  // supabase.rpc(...), never read/write listings directly.
  fromMock: vi.fn(() => {
    throw new Error("must not access .from() directly -- use the RPC only");
  }),
  createClientMock: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: createClientMock,
}));

createClientMock.mockReturnValue({ rpc: rpcMock, from: fromMock });

import { updateListingStatus } from "@/lib/seller/listing-actions";

beforeEach(() => {
  rpcMock.mockReset();
  fromMock.mockClear();
});

describe("updateListingStatus", () => {
  it("calls update_listing_status with only the listing id and target status", async () => {
    rpcMock.mockResolvedValue({
      data: [{ listing_id: "listing-1", status: "paused", was_already_in_status: false, updated_at: "2026-01-05T00:00:00.000Z" }],
      error: null,
    });

    await updateListingStatus("listing-1", "paused");

    expect(rpcMock).toHaveBeenCalledWith("update_listing_status", { p_listing_id: "listing-1", p_status: "paused" });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("returns the updated status/idempotency flag on success", async () => {
    rpcMock.mockResolvedValue({
      data: [{ listing_id: "listing-1", status: "available", was_already_in_status: true, updated_at: "2026-01-05T00:00:00.000Z" }],
      error: null,
    });

    const result = await updateListingStatus("listing-1", "available");

    expect(result).toEqual({
      ok: true,
      listingId: "listing-1",
      status: "available",
      wasAlreadyInStatus: true,
      updatedAt: "2026-01-05T00:00:00.000Z",
    });
  });

  it.each([
    "TARGET_STATUS_NOT_ALLOWED",
    "LISTING_HAS_ACTIVE_RESERVATION",
    "INVALID_STATUS_TRANSITION",
    "LISTING_NOT_FOUND",
    "NOT_LISTING_OWNER",
    "INTERACTION_BLOCKED",
    "SHOP_NOT_FOUND",
    "NOT_AUTHENTICATED",
  ])("maps the live update_listing_status error code %s", async (code) => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "failed", details: code } });
    const result = await updateListingStatus("listing-1", "archived");
    expect(result).toEqual({ ok: false, code });
  });

  it("maps an unrecognized error detail to UNKNOWN rather than leaking it", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "raw postgres error", details: "23505" } });
    const result = await updateListingStatus("listing-1", "sold");
    expect(result).toEqual({ ok: false, code: "UNKNOWN" });
  });

  it("returns UNKNOWN when the RPC throws", async () => {
    rpcMock.mockRejectedValue(new Error("network down"));
    const result = await updateListingStatus("listing-1", "archived");
    expect(result).toEqual({ ok: false, code: "UNKNOWN" });
  });

  it("never sends a shop/seller/user id -- only listing id and target status", async () => {
    rpcMock.mockResolvedValue({
      data: [{ listing_id: "listing-1", status: "sold", was_already_in_status: false, updated_at: "now" }],
      error: null,
    });
    await updateListingStatus("listing-1", "sold");
    const args = rpcMock.mock.calls[0][1];
    expect(Object.keys(args).sort()).toEqual(["p_listing_id", "p_status"]);
  });
});
