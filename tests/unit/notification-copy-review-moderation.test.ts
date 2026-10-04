import { describe, expect, it } from "vitest";
import { getNotificationHref, getNotificationMessage, getNotificationTitle } from "@/lib/notifications/notification-copy";
import type { NotificationItem } from "@/lib/notifications/get-my-notifications";

function item(overrides: Partial<NotificationItem>): NotificationItem {
  return {
    id: "n1",
    type: "review_removed",
    createdAt: "2026-01-05T00:00:00.000Z",
    readAt: null,
    actorDisplayName: null,
    orderPublicCode: null,
    conversationId: null,
    conversationListingTitle: null,
    reviewId: "review-1",
    ...overrides,
  } as unknown as NotificationItem;
}

describe("review moderation notification copy", () => {
  it("removed and restored types have titles", () => {
    expect(getNotificationTitle("review_removed")).toBe("Your review was removed");
    expect(getNotificationTitle("review_restored")).toBe("Your review was restored");
  });

  it("messages name the order code when one is projected, and never a raw id", () => {
    expect(getNotificationMessage(item({ type: "review_removed", orderPublicCode: "ORD-123" }))).toBe(
      "Your review on order ORD-123 was removed after a moderation review. The reason is on the order page.",
    );
    expect(getNotificationMessage(item({ type: "review_restored", orderPublicCode: "ORD-123" }))).toBe(
      "Your review on order ORD-123 was restored and is visible again.",
    );
  });

  it("messages without an order code fall back to generic text", () => {
    expect(getNotificationMessage(item({ type: "review_removed", orderPublicCode: null }))).not.toMatch(/ORD-/);
    expect(getNotificationMessage(item({ type: "review_restored", orderPublicCode: null }))).toBe("Your review was restored and is visible again.");
  });

  it("both types route to the buyer's order page when the order code is projected, and nowhere otherwise", () => {
    expect(getNotificationHref(item({ type: "review_removed", orderPublicCode: "ORD-123" }))).toBe("/orders/ORD-123");
    expect(getNotificationHref(item({ type: "review_restored", orderPublicCode: "ORD-123" }))).toBe("/orders/ORD-123");
    expect(getNotificationHref(item({ type: "review_removed", orderPublicCode: null }))).toBeNull();
  });

  it("the copy never includes the admin's identity or a private note", () => {
    const copy = [
      getNotificationTitle("review_removed"),
      getNotificationMessage(item({ type: "review_removed", orderPublicCode: "ORD-1", actorDisplayName: "Admin A." })),
    ].join(" ");
    expect(copy).not.toMatch(/Admin A\./);
  });
});

describe("review moderation notification copy -- user-facing reason and note (plain text)", () => {
  it("the removal message includes the user-facing reason, matching the email's 'Reason:' wording", () => {
    const text = getNotificationMessage(item({ type: "review_removed", orderPublicCode: "ORD-9", publicMessage: "Scam listing." }));
    expect(text).toBe("Your review on order ORD-9 was removed after a moderation review. Reason: Scam listing.");
  });

  it("the removal message without an order code still includes the reason", () => {
    const text = getNotificationMessage(item({ type: "review_removed", orderPublicCode: null, publicMessage: "Abusive text." }));
    expect(text).toBe("Your review was removed after a moderation review. Reason: Abusive text.");
  });

  it("the restore message includes the optional note when supplied, matching the email's 'Note:' wording", () => {
    const text = getNotificationMessage(item({ type: "review_restored", orderPublicCode: "ORD-9", publicMessage: "Reviewed again." }));
    expect(text).toBe("Your review on order ORD-9 was restored and is visible again. Note: Reviewed again.");
  });

  it("the restore message without a note keeps the plain restored wording", () => {
    expect(getNotificationMessage(item({ type: "review_restored", orderPublicCode: "ORD-9", publicMessage: null }))).toBe(
      "Your review on order ORD-9 was restored and is visible again.",
    );
  });

  it("the copy is plain text: markup in the reason is returned verbatim for React to escape, never transformed", () => {
    const hostile = '<img src=x onerror="alert(1)"> & "quotes"';
    const text = getNotificationMessage(item({ type: "review_removed", orderPublicCode: "ORD-9", publicMessage: hostile }));
    expect(text.endsWith(`Reason: ${hostile}`)).toBe(true);
    expect(text).not.toMatch(/&lt;|&amp;|&quot;/);
  });

  it("a non-review notification never shows a publicMessage", () => {
    const text = getNotificationMessage(item({ type: "order_accepted", orderPublicCode: "ORD-9", publicMessage: "should not appear" }));
    expect(text).not.toMatch(/should not appear/);
  });
});
