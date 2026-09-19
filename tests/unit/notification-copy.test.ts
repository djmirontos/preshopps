import { describe, expect, it } from "vitest";
import { getNotificationTitle, getNotificationMessage, getNotificationHref } from "@/lib/notifications/notification-copy";
import type { NotificationItem, NotificationType } from "@/lib/notifications/get-my-notifications";

/** Every value this frontend module's NotificationType union currently
 * covers (the order/messaging/review lifecycle set from
 * 0040_notifications.sql, plus the two moderation restriction values
 * added by A2.1). dispute_opened/dispute_resolved remain a separate,
 * pre-existing, out-of-scope gap -- not added here. */
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
  "moderation_restriction_applied",
  "moderation_restriction_lifted",
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
  it("has a non-empty title and message for every one of this module's covered types", () => {
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

  describe("moderation_restriction_applied / moderation_restriction_lifted (A2.1)", () => {
    it("has the exact expected titles", () => {
      expect(getNotificationTitle("moderation_restriction_applied")).toBe("Account restriction applied");
      expect(getNotificationTitle("moderation_restriction_lifted")).toBe("Account restriction lifted");
    });

    it("applied message tells the user to review Account status", () => {
      const message = getNotificationMessage(item({ type: "moderation_restriction_applied" }));
      expect(message).toMatch(/account status/i);
    });

    it("lifted message says a restriction has been removed", () => {
      const message = getNotificationMessage(item({ type: "moderation_restriction_lifted" }));
      expect(message).toMatch(/removed/i);
    });

    it("never infers or names a specific restriction type -- get_my_notifications returns no restriction_id/type on this row", () => {
      const applied = getNotificationMessage(item({ type: "moderation_restriction_applied" }));
      const lifted = getNotificationMessage(item({ type: "moderation_restriction_lifted" }));
      for (const message of [applied, lifted]) {
        expect(message).not.toMatch(/seller_suspended|buyer_restricted|account_suspended/);
      }
    });

    it("applied routes to /account#account-status", () => {
      expect(getNotificationHref(item({ type: "moderation_restriction_applied" }))).toBe("/account#account-status");
    });

    it("lifted routes to plain /account, never the #account-status anchor -- a lift can leave zero active restrictions, in which case AccountStatusSection renders nothing and that element wouldn't exist", () => {
      expect(getNotificationHref(item({ type: "moderation_restriction_lifted" }))).toBe("/account");
    });
  });

  describe("existing notification types are unchanged by the A2.1 additions", () => {
    it("order_accepted title/message/href are byte-identical to before", () => {
      expect(getNotificationTitle("order_accepted")).toBe("Order accepted");
      expect(getNotificationMessage(item({ type: "order_accepted", orderPublicCode: "PSO-ABC12345" }))).toBe(
        "Your order PSO-ABC12345 was accepted.",
      );
      expect(getNotificationHref(item({ type: "order_accepted", orderPublicCode: "PSO-ABC12345" }))).toBe("/orders/PSO-ABC12345");
    });

    it("new_message title/message/href are byte-identical to before", () => {
      expect(getNotificationTitle("new_message")).toBe("New message");
      expect(getNotificationHref(item({ type: "new_message", conversationId: "conv-1" }))).toBe("/messages/conv-1");
    });
  });
});
