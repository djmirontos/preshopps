import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock, createClientMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  createClientMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: createClientMock,
}));

createClientMock.mockResolvedValue({ rpc: rpcMock });

import { getConversationMessages } from "@/lib/messaging/get-conversation-messages";

function row(overrides: Record<string, unknown> = {}) {
  return {
    message_id: "msg-1",
    is_mine: true,
    body: "Hello",
    created_at: "2026-02-01T10:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  rpcMock.mockReset();
});

describe("getConversationMessages", () => {
  it("calls get_conversation_messages with the conversation id, limit, and null cursor on first page", async () => {
    rpcMock.mockResolvedValue({ data: [row()], error: null });
    await getConversationMessages("conv-1", 30);
    expect(rpcMock).toHaveBeenCalledWith("get_conversation_messages", {
      p_conversation_id: "conv-1",
      p_limit: 30,
      p_before_created_at: null,
      p_before_id: null,
    });
  });

  it("passes the cursor through on subsequent (Load earlier) pages", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    await getConversationMessages("conv-1", 30, { createdAt: "2026-01-01T00:00:00.000Z", id: "msg-5" });
    expect(rpcMock).toHaveBeenCalledWith("get_conversation_messages", {
      p_conversation_id: "conv-1",
      p_limit: 30,
      p_before_created_at: "2026-01-01T00:00:00.000Z",
      p_before_id: "msg-5",
    });
  });

  it("reverses the RPC's newest-first rows into chronological order for rendering", async () => {
    rpcMock.mockResolvedValue({
      data: [row({ message_id: "m2", created_at: "2026-02-01T10:05:00.000Z" }), row({ message_id: "m1", created_at: "2026-02-01T10:00:00.000Z" })],
      error: null,
    });
    const result = await getConversationMessages("conv-1", 30);
    expect(result.messages.map((m) => m.messageId)).toEqual(["m1", "m2"]);
  });

  it("never exposes a raw sender_id -- only is_mine", async () => {
    rpcMock.mockResolvedValue({ data: [row()], error: null });
    const result = await getConversationMessages("conv-1", 30);
    expect(result.messages[0]).toEqual({
      messageId: "msg-1",
      isMine: true,
      body: "Hello",
      createdAt: "2026-02-01T10:00:00.000Z",
    });
    expect(Object.keys(result.messages[0])).not.toContain("senderId");
  });

  it("returns a nextCursor derived from the oldest row of a full page (for Load earlier)", async () => {
    rpcMock.mockResolvedValue({
      data: [row({ message_id: "m2", created_at: "2026-02-01T10:05:00.000Z" }), row({ message_id: "m1", created_at: "2026-02-01T10:00:00.000Z" })],
      error: null,
    });
    const result = await getConversationMessages("conv-1", 2);
    expect(result.nextCursor).toEqual({ createdAt: "2026-02-01T10:00:00.000Z", id: "m1" });
  });

  it("returns nextCursor: null when fewer rows than the limit come back (no earlier messages)", async () => {
    rpcMock.mockResolvedValue({ data: [row()], error: null });
    const result = await getConversationMessages("conv-1", 30);
    expect(result.nextCursor).toBeNull();
  });

  it("returns hadError true, empty messages, on an RPC error", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    const result = await getConversationMessages("conv-1", 30);
    expect(result).toEqual({ messages: [], hadError: true, nextCursor: null });
  });

  it("returns hadError true when the RPC throws", async () => {
    rpcMock.mockRejectedValue(new Error("network down"));
    const result = await getConversationMessages("conv-1", 30);
    expect(result).toEqual({ messages: [], hadError: true, nextCursor: null });
  });
});
