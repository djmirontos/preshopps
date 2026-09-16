import { describe, expect, it } from "vitest";
import { insertMessageInOrder } from "@/lib/messaging/message-list";
import type { ConversationMessage } from "@/lib/messaging/get-conversation-messages";

function msg(overrides: Partial<ConversationMessage> = {}): ConversationMessage {
  return { messageId: "m", isMine: false, body: "body", createdAt: "2026-02-01T10:00:00.000Z", ...overrides };
}

/**
 * insertMessageInOrder is the render-level merge helper for Realtime
 * reconnect reconciliation specifically -- see ConversationThread.tsx's
 * own comment for why appendMessageIfNew (still correct and unchanged for
 * ordinary live/sent messages) is not safe there: a message missed during
 * an outage can be older than one that already arrived live while the
 * reconciliation fetch was still pending.
 */
describe("insertMessageInOrder", () => {
  it("inserts into an empty list", () => {
    expect(insertMessageInOrder([], msg({ messageId: "a" }))).toEqual([msg({ messageId: "a" })]);
  });

  it("appends at the end when the incoming message is the newest", () => {
    const existing = [msg({ messageId: "a", createdAt: "2026-02-01T10:00:00.000Z" })];
    const incoming = msg({ messageId: "b", createdAt: "2026-02-01T11:00:00.000Z" });
    expect(insertMessageInOrder(existing, incoming)).toEqual([existing[0], incoming]);
  });

  it("inserts in the middle when the incoming message is older than a later existing message", () => {
    const existing = [
      msg({ messageId: "a", createdAt: "2026-02-01T10:00:00.000Z" }),
      msg({ messageId: "c", createdAt: "2026-02-01T12:00:00.000Z" }),
    ];
    const incoming = msg({ messageId: "b", createdAt: "2026-02-01T11:00:00.000Z" });
    expect(insertMessageInOrder(existing, incoming).map((m) => m.messageId)).toEqual(["a", "b", "c"]);
  });

  it("inserts at the front when the incoming message is the oldest", () => {
    const existing = [msg({ messageId: "b", createdAt: "2026-02-01T11:00:00.000Z" })];
    const incoming = msg({ messageId: "a", createdAt: "2026-02-01T10:00:00.000Z" });
    expect(insertMessageInOrder(existing, incoming).map((m) => m.messageId)).toEqual(["a", "b"]);
  });

  it("is a no-op when a message with the same id already exists, regardless of position", () => {
    const existing = [
      msg({ messageId: "a", createdAt: "2026-02-01T10:00:00.000Z" }),
      msg({ messageId: "b", createdAt: "2026-02-01T11:00:00.000Z" }),
    ];
    const duplicate = msg({ messageId: "a", createdAt: "2026-02-01T10:00:00.000Z", body: "different body" });
    expect(insertMessageInOrder(existing, duplicate)).toBe(existing);
  });

  it("breaks a tie on equal createdAt by ascending messageId", () => {
    const existing = [msg({ messageId: "b", createdAt: "2026-02-01T10:00:00.000Z" })];
    const incoming = msg({ messageId: "a", createdAt: "2026-02-01T10:00:00.000Z" });
    expect(insertMessageInOrder(existing, incoming).map((m) => m.messageId)).toEqual(["a", "b"]);
  });

  it("never mutates the original array", () => {
    const existing = [msg({ messageId: "a", createdAt: "2026-02-01T10:00:00.000Z" })];
    const snapshot = [...existing];
    insertMessageInOrder(existing, msg({ messageId: "b", createdAt: "2026-02-01T09:00:00.000Z" }));
    expect(existing).toEqual(snapshot);
  });
});
