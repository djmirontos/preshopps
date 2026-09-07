import { describe, expect, it } from "vitest";
import { getNotificationTitle, getNotificationMessage, getNotificationHref } from "@/lib/notifications/notification-copy";
import type { NotificationItem, NotificationType } from "@/lib/notifications/get-my-notifications";

/** All fourteen values of the live notification_type_enum
 * (0040_notifications.sql) -- never invent a fifteenth. */
const ALL_TYPES: NotificationType[] = [
  "order_request_received",
  "order_accepted",
  "order_declined",
  "order_changes_pending",
  "order_ready",
  "order_handed_over_or_shipped",
  "order_completed",
  "order_cancelled",
  "order_cancellation_requested",
  "order_cancellation_rejected",
  "order_expired",
  "new_message",
  "new_review",
  "review_reply",
];

function item(overrides: Partial<NotificationItem> = {}): NotificationItem {
  return {
    notificationId: "notif-1",
    type: "order_accepted",
    createdAt: "2026-02-01T10:00:00.000Z",
    readAt: null,
    actorDisplayName: null,
    actorAvatarUrl: undefined,
    orderId: null,
    orderPublicCode: null,
    conversationId: null,
    conversationListingTitle: null,
    reviewId: null,
    ...overrides,
  };
}

describe("notification-copy", () => {
  it("has a non-empty title and message for every one of the fourteen canonical types", () => {
    for (const type of ALL_TYPES) {
      expect(getNotificationTitle(type).length).toBeGreaterThan(0);
      expect(getNotificationMessage(item({ type })).length).toBeGreaterThan(0);
    }
  });

  it("never exposes a raw enum value as the title", () => {
    for (const type of ALL_TYPES) {
      expect(getNotificationTitle(type)).not.toBe(type);
      expect(getNotificationTitle(type)).not.toContain("_");
    }
  });

  describe("getNotificationHref -- seller-only types route to /seller/orders/{code}", () => {
    it.each(["order_request_received", "order_cancellation_requested"] as const)("%s", (type) => {
      expect(getNotificationHref(item({ type, orderPublicCode: "PSO-ABC12345" }))).toBe("/seller/orders/PSO-ABC12345");
    });
  });

  describe("getNotificationHref -- buyer-only types route to /orders/{code}", () => {
    it.each([
      "order_accepted",
      "order_declined",
      "order_changes_pending",
      "order_ready",
      "order_handed_over_or_shipped",
      "order_cancelled",
      "order_cancellation_rejected",
      "order_expired",
    ] as const)("%s", (type) => {
      expect(getNotificationHref(item({ type, orderPublicCode: "PSO-ABC12345" }))).toBe("/orders/PSO-ABC12345");
    });
  });

  it("routes new_message to /messages/{conversationId} regardless of role", () => {
    expect(getNotificationHref(item({ type: "new_message", conversationId: "conv-1" }))).toBe("/messages/conv-1");
  });

  it("never fabricates a link for order_completed -- recipient role (buyer vs seller) cannot be determined from this notification alone", () => {
    expect(getNotificationHref(item({ type: "order_completed", orderPublicCode: "PSO-ABC12345" }))).toBeNull();
  });

  it("never fabricates a link for new_review or review_reply -- no shop slug or order code is available to route to", () => {
    expect(getNotificationHref(item({ type: "new_review", reviewId: "review-1" }))).toBeNull();
    expect(getNotificationHref(item({ type: "review_reply", reviewId: "review-1" }))).toBeNull();
  });

  it("returns null (never a broken link) when the expected id is missing for an otherwise-linkable type", () => {
    expect(getNotificationHref(item({ type: "order_accepted", orderPublicCode: null }))).toBeNull();
    expect(getNotificationHref(item({ type: "order_request_received", orderPublicCode: null }))).toBeNull();
    expect(getNotificationHref(item({ type: "new_message", conversationId: null }))).toBeNull();
  });

  it("includes the actor display name and order code in message text when available", () => {
    const message = getNotificationMessage(
      item({ type: "order_request_received", actorDisplayName: "Jane D.", orderPublicCode: "PSO-ABC12345" }),
    );
    expect(message).toContain("Jane D.");
    expect(message).toContain("PSO-ABC12345");
  });

  it("falls back to generic wording when the actor name is unavailable, never rendering null/undefined text", () => {
    const message = getNotificationMessage(item({ type: "order_request_received", actorDisplayName: null, orderPublicCode: "PSO-ABC12345" }));
    expect(message).not.toMatch(/null|undefined/i);
  });
});
