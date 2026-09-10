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

import { createDispute } from "@/lib/disputes/dispute-actions";

beforeEach(() => {
  rpcMock.mockReset();
  fromMock.mockClear();
});

describe("createDispute", () => {
  it("calls create_dispute with exactly order id, reason, explanation, and image paths -- never a user id", async () => {
    rpcMock.mockResolvedValue({ data: [{ dispute_id: "dispute-1", created_at: "2026-01-05T00:00:00.000Z" }], error: null });

    await createDispute("order-1", "Item never arrived", "I never received the package.", ["dispute-images/u1/order-1/a.jpg"]);

    expect(rpcMock).toHaveBeenCalledWith("create_dispute", {
      p_order_id: "order-1",
      p_reason: "Item never arrived",
      p_explanation: "I never received the package.",
      p_image_paths: ["dispute-images/u1/order-1/a.jpg"],
    });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("returns the dispute id and created_at on success", async () => {
    rpcMock.mockResolvedValue({ data: [{ dispute_id: "dispute-1", created_at: "2026-01-05T00:00:00.000Z" }], error: null });
    const result = await createDispute("order-1", "reason", "explanation", []);
    expect(result).toEqual({ ok: true, disputeId: "dispute-1", createdAt: "2026-01-05T00:00:00.000Z" });
  });

  it.each([
    "NOT_AUTHENTICATED",
    "INTERACTION_BLOCKED",
    "ORDER_NOT_FOUND",
    "NOT_ORDER_PARTICIPANT",
    "ORDER_NOT_DISPUTABLE",
    "DISPUTE_ALREADY_ACTIVE",
    "DISPUTE_REASON_REQUIRED",
    "DISPUTE_REASON_TOO_LONG",
    "DISPUTE_EXPLANATION_REQUIRED",
    "DISPUTE_EXPLANATION_TOO_LONG",
    "TOO_MANY_DISPUTE_IMAGES",
    "DISPUTE_IMAGE_PATH_INVALID",
  ])("maps the live create_dispute error code %s", async (code) => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "failed", details: code } });
    const result = await createDispute("order-1", "reason", "explanation", []);
    expect(result).toEqual({ ok: false, code });
  });

  it("maps an unrecognized error detail to UNKNOWN", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "raw postgres error", details: "23505" } });
    const result = await createDispute("order-1", "reason", "explanation", []);
    expect(result).toEqual({ ok: false, code: "UNKNOWN" });
  });

  it("returns UNKNOWN when the RPC throws", async () => {
    rpcMock.mockRejectedValue(new Error("network down"));
    const result = await createDispute("order-1", "reason", "explanation", []);
    expect(result).toEqual({ ok: false, code: "UNKNOWN" });
  });
});
