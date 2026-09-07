import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createClientMock,
  fromMock,
  updateMock,
  updateEqMock,
  stateSelectMock,
  stateSelectEqMock,
  stateMaybeSingleMock,
  conversationsSelectMock,
  conversationsSelectEqMock,
  conversationsMaybeSingleMock,
} = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  fromMock: vi.fn(),
  updateMock: vi.fn(),
  updateEqMock: vi.fn(),
  stateSelectMock: vi.fn(),
  stateSelectEqMock: vi.fn(),
  stateMaybeSingleMock: vi.fn(),
  conversationsSelectMock: vi.fn(),
  conversationsSelectEqMock: vi.fn(),
  conversationsMaybeSingleMock: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: createClientMock,
}));

createClientMock.mockReturnValue({ from: fromMock });

// from("conversation_user_states") supports both the existing .update()
// chain (archive/mute/mark-read/mark-unread) and a new .select() chain
// (the read-before-write check for mark-read-on-open).
fromMock.mockImplementation((table: string) => {
  if (table === "conversation_user_states") {
    return { update: updateMock, select: stateSelectMock };
  }
  if (table === "conversations") {
    return { select: conversationsSelectMock };
  }
  throw new Error(`unexpected table in test: ${table}`);
});

updateMock.mockReturnValue({ eq: updateEqMock });
stateSelectMock.mockReturnValue({ eq: stateSelectEqMock });
stateSelectEqMock.mockReturnValue({ maybeSingle: stateMaybeSingleMock });
conversationsSelectMock.mockReturnValue({ eq: conversationsSelectEqMock });
conversationsSelectEqMock.mockReturnValue({ maybeSingle: conversationsMaybeSingleMock });

import {
  markConversationRead,
  markConversationReadIfUnread,
  markConversationUnread,
  setConversationArchived,
  setConversationMuted,
} from "@/lib/messaging/conversation-state";

beforeEach(() => {
  fromMock.mockClear();
  updateMock.mockClear();
  updateEqMock.mockReset();
  updateEqMock.mockResolvedValue({ error: null });
  stateSelectMock.mockClear();
  stateSelectEqMock.mockClear();
  stateMaybeSingleMock.mockReset();
  conversationsSelectMock.mockClear();
  conversationsSelectEqMock.mockClear();
  conversationsMaybeSingleMock.mockReset();
});

describe("conversation-state (direct table updates, no RPC, no client-supplied user id)", () => {
  it("markConversationRead updates last_read_at and clears marked_unread_at, filtered only by conversation_id", async () => {
    await markConversationRead("conv-1");
    expect(fromMock).toHaveBeenCalledWith("conversation_user_states");
    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ marked_unread_at: null }));
    const patch = updateMock.mock.calls[0][0];
    expect(typeof patch.last_read_at).toBe("string");
    expect(updateEqMock).toHaveBeenCalledWith("conversation_id", "conv-1");
  });

  it("markConversationUnread sets marked_unread_at and never touches last_read_at", async () => {
    await markConversationUnread("conv-1");
    const patch = updateMock.mock.calls[0][0];
    expect(typeof patch.marked_unread_at).toBe("string");
    expect(patch).not.toHaveProperty("last_read_at");
  });

  it("setConversationArchived(true) sets archived_at to a timestamp", async () => {
    await setConversationArchived("conv-1", true);
    const patch = updateMock.mock.calls[0][0];
    expect(typeof patch.archived_at).toBe("string");
  });

  it("setConversationArchived(false) clears archived_at to null", async () => {
    await setConversationArchived("conv-1", false);
    expect(updateMock).toHaveBeenCalledWith({ archived_at: null });
  });

  it("setConversationMuted toggles the muted boolean directly", async () => {
    await setConversationMuted("conv-1", true);
    expect(updateMock).toHaveBeenCalledWith({ muted: true });
  });

  it("never filters by an explicit user id -- RLS (conversation_user_states_update_own) scopes the row", async () => {
    await markConversationRead("conv-1");
    expect(updateEqMock).toHaveBeenCalledTimes(1);
    expect(updateEqMock).toHaveBeenCalledWith("conversation_id", "conv-1");
  });

  it("returns ok: false on an update error rather than throwing", async () => {
    updateEqMock.mockResolvedValue({ error: { message: "boom" } });
    const result = await markConversationRead("conv-1");
    expect(result).toEqual({ ok: false });
  });

  it("returns ok: false when the update throws (network failure)", async () => {
    updateEqMock.mockRejectedValue(new Error("network down"));
    const result = await setConversationMuted("conv-1", true);
    expect(result).toEqual({ ok: false });
  });
});

describe("markConversationReadIfUnread (mark-read-on-open)", () => {
  it("writes last_read_at/marked_unread_at when marked_unread_at is set, even if last_read_at is recent", async () => {
    stateMaybeSingleMock.mockResolvedValue({
      data: { last_read_at: "2026-02-01T09:00:00.000Z", marked_unread_at: "2026-02-01T09:30:00.000Z" },
      error: null,
    });
    conversationsMaybeSingleMock.mockResolvedValue({ data: { last_message_at: "2026-02-01T08:00:00.000Z" }, error: null });

    const result = await markConversationReadIfUnread("conv-1");

    expect(result).toEqual({ ok: true });
    expect(fromMock).toHaveBeenCalledWith("conversation_user_states");
    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ marked_unread_at: null }));
    expect(updateEqMock).toHaveBeenCalledWith("conversation_id", "conv-1");
  });

  it("writes when last_read_at is null (never read before)", async () => {
    stateMaybeSingleMock.mockResolvedValue({ data: { last_read_at: null, marked_unread_at: null }, error: null });
    conversationsMaybeSingleMock.mockResolvedValue({ data: { last_message_at: "2026-02-01T08:00:00.000Z" }, error: null });

    await markConversationReadIfUnread("conv-1");
    expect(updateMock).toHaveBeenCalled();
  });

  it("writes when the conversation's last_message_at is newer than last_read_at", async () => {
    stateMaybeSingleMock.mockResolvedValue({
      data: { last_read_at: "2026-02-01T08:00:00.000Z", marked_unread_at: null },
      error: null,
    });
    conversationsMaybeSingleMock.mockResolvedValue({ data: { last_message_at: "2026-02-01T09:00:00.000Z" }, error: null });

    await markConversationReadIfUnread("conv-1");
    expect(updateMock).toHaveBeenCalled();
  });

  it("performs no write at all when the conversation is already read (no unnecessary write)", async () => {
    stateMaybeSingleMock.mockResolvedValue({
      data: { last_read_at: "2026-02-01T10:00:00.000Z", marked_unread_at: null },
      error: null,
    });
    conversationsMaybeSingleMock.mockResolvedValue({ data: { last_message_at: "2026-02-01T09:00:00.000Z" }, error: null });

    const result = await markConversationReadIfUnread("conv-1");

    expect(result).toEqual({ ok: true });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("only reads/writes its own row -- filtered by conversation_id only, relying on RLS for the user scope", async () => {
    stateMaybeSingleMock.mockResolvedValue({ data: { last_read_at: null, marked_unread_at: null }, error: null });
    conversationsMaybeSingleMock.mockResolvedValue({ data: { last_message_at: "2026-02-01T09:00:00.000Z" }, error: null });

    await markConversationReadIfUnread("conv-1");

    expect(stateSelectEqMock).toHaveBeenCalledWith("conversation_id", "conv-1");
    expect(updateEqMock).toHaveBeenCalledWith("conversation_id", "conv-1");
    expect(stateSelectEqMock).not.toHaveBeenCalledWith("user_id", expect.anything());
  });

  it("never touches archived_at or muted", async () => {
    stateMaybeSingleMock.mockResolvedValue({ data: { last_read_at: null, marked_unread_at: null }, error: null });
    conversationsMaybeSingleMock.mockResolvedValue({ data: { last_message_at: "2026-02-01T09:00:00.000Z" }, error: null });

    await markConversationReadIfUnread("conv-1");

    const patch = updateMock.mock.calls[0][0];
    expect(patch).not.toHaveProperty("archived_at");
    expect(patch).not.toHaveProperty("muted");
  });

  it("works identically for a blocked conversation -- history/state access is unaffected by can_send", async () => {
    // markConversationReadIfUnread never queries blocking/restriction state
    // at all -- it only reads conversation_user_states + conversations.
    stateMaybeSingleMock.mockResolvedValue({ data: { last_read_at: null, marked_unread_at: null }, error: null });
    conversationsMaybeSingleMock.mockResolvedValue({ data: { last_message_at: "2026-02-01T09:00:00.000Z" }, error: null });

    const result = await markConversationReadIfUnread("conv-blocked");
    expect(result).toEqual({ ok: true });
    expect(updateEqMock).toHaveBeenCalledWith("conversation_id", "conv-blocked");
  });

  it("returns ok: false on a read error rather than throwing, and never writes", async () => {
    stateMaybeSingleMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    conversationsMaybeSingleMock.mockResolvedValue({ data: { last_message_at: "2026-02-01T09:00:00.000Z" }, error: null });

    const result = await markConversationReadIfUnread("conv-1");
    expect(result).toEqual({ ok: false });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("returns ok: false when a read throws (network failure)", async () => {
    stateMaybeSingleMock.mockRejectedValue(new Error("network down"));
    conversationsMaybeSingleMock.mockResolvedValue({ data: { last_message_at: "2026-02-01T09:00:00.000Z" }, error: null });

    const result = await markConversationReadIfUnread("conv-1");
    expect(result).toEqual({ ok: false });
  });
});
