import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ rpc: rpcMock }),
}));

import { getLatestConversationMessages } from "@/lib/messaging/get-latest-conversation-messages";

beforeEach(() => {
  rpcMock.mockReset();
});

/**
 * Browser-callable counterpart to get-conversation-messages.ts (server-
 * only) -- same get_conversation_messages RPC (0046), called with no
 * before-cursor to fetch the current newest page. Used only for Realtime
 * reconnect reconciliation (see ConversationThread.tsx); this file proves
 * the wrapper's own contract in isolation, independent of that caller.
 */
describe("getLatestConversationMessages", () => {
  it("calls get_conversation_messages with the conversation id, limit 30, and no before cursor", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    await getLatestConversationMessages("conv-1");

    expect(rpcMock).toHaveBeenCalledWith("get_conversation_messages", {
      p_conversation_id: "conv-1",
      p_limit: 30,
      p_before_created_at: null,
      p_before_id: null,
    });
  });

  it("returns { ok: true, messages } in chronological (oldest-first) order, reversed from the RPC's own newest-first rows", async () => {
    rpcMock.mockResolvedValue({
      data: [
        { message_id: "m2", is_mine: false, body: "Second", created_at: "2026-02-01T12:01:00.000Z" },
        { message_id: "m1", is_mine: true, body: "First", created_at: "2026-02-01T12:00:00.000Z" },
      ],
      error: null,
    });

    const result = await getLatestConversationMessages("conv-1");

    expect(result).toEqual({
      ok: true,
      messages: [
        { messageId: "m1", isMine: true, body: "First", createdAt: "2026-02-01T12:00:00.000Z" },
        { messageId: "m2", isMine: false, body: "Second", createdAt: "2026-02-01T12:01:00.000Z" },
      ],
    });
  });

  it("returns { ok: true, messages: [] } for a genuinely empty newest page -- never treated as a failure", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    const result = await getLatestConversationMessages("conv-1");
    expect(result).toEqual({ ok: true, messages: [] });
  });

  it("returns { ok: false } (never a fabricated empty page) when the RPC returns an error", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    const result = await getLatestConversationMessages("conv-1");
    expect(result).toEqual({ ok: false });
  });

  it("returns { ok: false } when the RPC call itself throws", async () => {
    rpcMock.mockRejectedValue(new Error("network error"));
    const result = await getLatestConversationMessages("conv-1");
    expect(result).toEqual({ ok: false });
  });

  it("returns { ok: false } for a non-array response instead of trusting an unexpected shape", async () => {
    rpcMock.mockResolvedValue({ data: { unexpected: true }, error: null });
    const result = await getLatestConversationMessages("conv-1");
    expect(result).toEqual({ ok: false });
  });

  it("never exposes the raw Supabase error message in the returned result", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "raw backend detail that must never reach the UI" } });
    const result = await getLatestConversationMessages("conv-1");
    expect(result).toEqual({ ok: false });
    expect(JSON.stringify(result)).not.toMatch(/raw backend detail/);
  });
});
