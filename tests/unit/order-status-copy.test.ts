import { describe, expect, it } from "vitest";
import {
  getOrderStatusLabel,
  getOrderStatusGuidance,
  getSellerOrderStatusGuidance,
  getAllowedSellerActions,
  isPositiveOrderStatus,
  type OrderStatus,
} from "@/lib/orders/order-status-copy";

/** All eleven values of the LIVE order_status_enum -- confirmed directly
 * against the database, not just 0002_enums.sql's original ten-value
 * definition (changes_pending was added afterward by
 * 0015_partial_acceptance_state.sql). */
const ALL_STATUSES: OrderStatus[] = [
  "pending",
  "changes_pending",
  "accepted",
  "ready",
  "handed_over_or_shipped",
  "received_confirmed",
  "completed",
  "declined",
  "cancelled",
  "expired",
  "disputed",
];

describe("order-status-copy", () => {
  it("has a non-empty label and guidance string for every one of the eleven canonical statuses", () => {
    for (const status of ALL_STATUSES) {
      expect(getOrderStatusLabel(status, "meetup").length).toBeGreaterThan(0);
      expect(getOrderStatusGuidance(status, "meetup").length).toBeGreaterThan(0);
      expect(getSellerOrderStatusGuidance(status, "meetup").length).toBeGreaterThan(0);
    }
  });

  it("renders 'Shipped' for handed_over_or_shipped when fulfillment_method is shipping", () => {
    expect(getOrderStatusLabel("handed_over_or_shipped", "shipping")).toBe("Shipped");
    expect(getOrderStatusGuidance("handed_over_or_shipped", "shipping")).toMatch(/shipped/i);
  });

  it("renders 'Handed Over' for handed_over_or_shipped for every non-shipping fulfillment method", () => {
    for (const method of ["meetup", "pickup", "local_delivery"] as const) {
      expect(getOrderStatusLabel("handed_over_or_shipped", method)).toBe("Handed Over");
      expect(getOrderStatusGuidance("handed_over_or_shipped", method)).toMatch(/handed over/i);
    }
  });

  it("uses the exact canonical labels for the non-split statuses", () => {
    expect(getOrderStatusLabel("pending", "meetup")).toBe("Pending");
    expect(getOrderStatusLabel("changes_pending", "meetup")).toBe("Changes Pending");
    expect(getOrderStatusLabel("accepted", "meetup")).toBe("Accepted");
    expect(getOrderStatusLabel("ready", "meetup")).toBe("Ready");
    expect(getOrderStatusLabel("received_confirmed", "meetup")).toBe("Buyer Confirms Received");
    expect(getOrderStatusLabel("completed", "meetup")).toBe("Completed");
    expect(getOrderStatusLabel("declined", "meetup")).toBe("Declined");
    expect(getOrderStatusLabel("cancelled", "meetup")).toBe("Cancelled");
    expect(getOrderStatusLabel("expired", "meetup")).toBe("Expired");
    expect(getOrderStatusLabel("disputed", "meetup")).toBe("Disputed");
  });

  it("classifies terminal/negative and pending statuses as not positive", () => {
    expect(isPositiveOrderStatus("pending")).toBe(false);
    expect(isPositiveOrderStatus("changes_pending")).toBe(false);
    expect(isPositiveOrderStatus("declined")).toBe(false);
    expect(isPositiveOrderStatus("cancelled")).toBe(false);
    expect(isPositiveOrderStatus("expired")).toBe(false);
    expect(isPositiveOrderStatus("disputed")).toBe(false);
  });

  it("classifies progressing/positive statuses as positive", () => {
    expect(isPositiveOrderStatus("accepted")).toBe(true);
    expect(isPositiveOrderStatus("ready")).toBe(true);
    expect(isPositiveOrderStatus("handed_over_or_shipped")).toBe(true);
    expect(isPositiveOrderStatus("received_confirmed")).toBe(true);
    expect(isPositiveOrderStatus("completed")).toBe(true);
  });

  describe("getAllowedSellerActions", () => {
    it("allows only decide_items for a pending order", () => {
      expect(getAllowedSellerActions("pending", false)).toEqual(["decide_items"]);
    });

    it("allows mark_ready and cancel_accepted for an accepted order with no pending cancellation request", () => {
      expect(getAllowedSellerActions("accepted", false)).toEqual(["mark_ready", "cancel_accepted"]);
    });

    it("allows mark_handed_over_or_shipped and cancel_accepted for a ready order with no pending cancellation request", () => {
      expect(getAllowedSellerActions("ready", false)).toEqual(["mark_handed_over_or_shipped", "cancel_accepted"]);
    });

    it("swaps progression for resolve_cancellation when a cancellation request is pending on an accepted order", () => {
      expect(getAllowedSellerActions("accepted", true)).toEqual(["resolve_cancellation", "cancel_accepted"]);
    });

    it("swaps progression for resolve_cancellation when a cancellation request is pending on a ready order", () => {
      expect(getAllowedSellerActions("ready", true)).toEqual(["resolve_cancellation", "cancel_accepted"]);
    });

    it("allows no seller action for handed_over_or_shipped -- the next step (buyer confirmation) is not a seller action", () => {
      expect(getAllowedSellerActions("handed_over_or_shipped", false)).toEqual([]);
    });

    it("allows no seller action for received_confirmed -- completion is service-role only, no human caller", () => {
      expect(getAllowedSellerActions("received_confirmed", false)).toEqual([]);
    });

    it("allows no seller action for every terminal status", () => {
      for (const status of ["changes_pending", "completed", "declined", "cancelled", "expired", "disputed"] as const) {
        expect(getAllowedSellerActions(status, false)).toEqual([]);
      }
    });
  });
});
