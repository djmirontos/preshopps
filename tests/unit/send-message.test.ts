import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock, createClientMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  createClientMock: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: createClientMock,
}));

createClientMock.mockReturnValue({ rpc: rpcMock });

import { sendMessage } from "@/lib/messaging/send-message";

beforeEach(() => {
  rpcMock.mockReset();
});

describe("sendMessage", () => {
  it("calls send_message with only conversation id and body (no client-supplied sender id)", async () => {
    rpcMock.mockResolvedValue({ data: [{ message_id: "msg-1", conversation_id: "conv-1", message_created_at: "2026-01-05T00:00:00.000Z" }], error: null });
    await sendMessage("conv-1", "Hello there");
    expect(rpcMock).toHaveBeenCalledWith("send_message", { p_conversation_id: "conv-1", p_body: "Hello there" });
    const args = rpcMock.mock.calls[0][1];
    expect(Object.keys(args).sort()).toEqual(["p_body", "p_conversation_id"]);
  });

  it("returns the message id and timestamp on success", async () => {
    rpcMock.mockResolvedValue({ data: [{ message_id: "msg-1", conversation_id: "conv-1", message_created_at: "2026-01-05T00:00:00.000Z" }], error: null });
    const result = await sendMessage("conv-1", "hi");
    expect(result).toEqual({ ok: true, messageId: "msg-1", createdAt: "2026-01-05T00:00:00.000Z" });
  });

  it("maps INTERACTION_BLOCKED", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "denied", details: "INTERACTION_BLOCKED" } });
    const result = await sendMessage("conv-1", "hi");
    expect(result).toEqual({ ok: false, code: "INTERACTION_BLOCKED" });
  });

  it("maps MESSAGE_EMPTY", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "invalid", details: "MESSAGE_EMPTY" } });
    const result = await sendMessage("conv-1", "   ");
    expect(result).toEqual({ ok: false, code: "MESSAGE_EMPTY" });
  });

  it("maps MESSAGE_TOO_LONG", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "invalid", details: "MESSAGE_TOO_LONG" } });
    const result = await sendMessage("conv-1", "x".repeat(4001));
    expect(result).toEqual({ ok: false, code: "MESSAGE_TOO_LONG" });
  });

  it("maps NOT_CONVERSATION_PARTICIPANT", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "denied", details: "NOT_CONVERSATION_PARTICIPANT" } });
    const result = await sendMessage("conv-1", "hi");
    expect(result).toEqual({ ok: false, code: "NOT_CONVERSATION_PARTICIPANT" });
  });

  it("maps an unrecognized error detail to UNKNOWN rather than leaking a raw database error", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "relation messages does not exist", details: "42P01" } });
    const result = await sendMessage("conv-1", "hi");
    expect(result).toEqual({ ok: false, code: "UNKNOWN" });
  });

  it("returns UNKNOWN when the RPC throws (network failure)", async () => {
    rpcMock.mockRejectedValue(new Error("network down"));
    const result = await sendMessage("conv-1", "hi");
    expect(result).toEqual({ ok: false, code: "UNKNOWN" });
  });
});
