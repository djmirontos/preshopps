import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock, createClientMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  createClientMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: createClientMock,
}));

createClientMock.mockResolvedValue({ rpc: rpcMock });

import { getConversationBlockState } from "@/lib/messaging/get-conversation-block-state";

function row(overrides: Record<string, unknown> = {}) {
  return {
    other_party_id: "other-user-1",
    is_blocked_by_viewer: false,
    ...overrides,
  };
}

beforeEach(() => {
  rpcMock.mockReset();
});

describe("getConversationBlockState", () => {
  it("calls get_conversation_block_state with only the conversation id", async () => {
    rpcMock.mockResolvedValue({ data: [row()], error: null });
    await getConversationBlockState("conv-1");
    expect(rpcMock).toHaveBeenCalledWith("get_conversation_block_state", { p_conversation_id: "conv-1" });
  });

  it("maps a found row to ConversationBlockState", async () => {
    rpcMock.mockResolvedValue({ data: [row()], error: null });
    const result = await getConversationBlockState("conv-1");
    expect(result).toEqual({ status: "found", state: { otherPartyId: "other-user-1", isBlockedByViewer: false } });
  });

  it("surfaces isBlockedByViewer: true when the viewer has already blocked the other party", async () => {
    rpcMock.mockResolvedValue({ data: [row({ is_blocked_by_viewer: true })], error: null });
    const result = await getConversationBlockState("conv-1");
    expect(result.status).toBe("found");
    if (result.status !== "found") return;
    expect(result.state.isBlockedByViewer).toBe(true);
  });

  it("returns not_found for CONVERSATION_NOT_FOUND", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "missing", details: "CONVERSATION_NOT_FOUND" } });
    const result = await getConversationBlockState("conv-missing");
    expect(result).toEqual({ status: "not_found" });
  });

  it("returns not_found for NOT_CONVERSATION_PARTICIPANT", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "denied", details: "NOT_CONVERSATION_PARTICIPANT" } });
    const result = await getConversationBlockState("conv-1");
    expect(result).toEqual({ status: "not_found" });
  });

  it("returns not_found when the RPC succeeds but returns zero rows", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    const result = await getConversationBlockState("conv-1");
    expect(result).toEqual({ status: "not_found" });
  });

  it("returns status: error for any other failure", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    const result = await getConversationBlockState("conv-1");
    expect(result).toEqual({ status: "error" });
  });

  it("returns status: error when the RPC throws", async () => {
    rpcMock.mockRejectedValue(new Error("network down"));
    const result = await getConversationBlockState("conv-1");
    expect(result).toEqual({ status: "error" });
  });
});
