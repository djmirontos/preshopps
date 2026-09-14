import { describe, expect, it } from "vitest";
import {
  getOrderStatusLabel,
  getOrderStatusGuidance,
  getSellerOrderStatusGuidance,
  getSellerMarkReadyActionLabel,
  getSellerMarkHandedOverActionLabel,
  getSellerReadyTransitionModalCopy,
  getSellerHandedOverTransitionModalCopy,
  getAllowedSellerActions,
  getAllowedBuyerActions,
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

  describe("getSellerMarkReadyActionLabel -- locked fulfillment-specific wording for the accepted -> ready button", () => {
    it("returns the exact locked label for each of the four fulfillment methods", () => {
      expect(getSellerMarkReadyActionLabel("pickup")).toBe("Ready for Pickup");
      expect(getSellerMarkReadyActionLabel("shipping")).toBe("Ready to Ship");
      expect(getSellerMarkReadyActionLabel("meetup")).toBe("Ready for Meetup");
      expect(getSellerMarkReadyActionLabel("local_delivery")).toBe("Ready for Delivery");
    });
  });

  describe("getSellerMarkHandedOverActionLabel -- locked fulfillment-specific wording for the ready -> handed_over_or_shipped button", () => {
    it("returns the exact locked label for each of the four fulfillment methods", () => {
      expect(getSellerMarkHandedOverActionLabel("pickup")).toBe("Mark as Picked Up");
      expect(getSellerMarkHandedOverActionLabel("shipping")).toBe("Mark as Shipped");
      expect(getSellerMarkHandedOverActionLabel("meetup")).toBe("Item Handed Over");
      expect(getSellerMarkHandedOverActionLabel("local_delivery")).toBe("Mark as Delivered");
    });
  });

  describe("getSellerReadyTransitionModalCopy -- locked confirmation-modal copy shown before mark_order_ready", () => {
    it("returns the exact locked title/body/primary label for each of the four fulfillment methods", () => {
      expect(getSellerReadyTransitionModalCopy("pickup")).toEqual({
        title: "Is the item ready for pickup?",
        body: "Let your buyer know the item is ready and coordinate the pickup through Preshopps chat.",
        primaryLabel: "Mark Ready for Pickup",
      });
      expect(getSellerReadyTransitionModalCopy("shipping")).toEqual({
        title: "Is the item ready to ship?",
        body: "Make sure the item is packed and coordinate shipping details with your buyer before continuing.",
        primaryLabel: "Ready to Ship",
      });
      expect(getSellerReadyTransitionModalCopy("meetup")).toEqual({
        title: "Ready to meet your buyer?",
        body: "Coordinate the meetup time and location with your buyer before handing over the item.",
        primaryLabel: "Ready for Meetup",
      });
      expect(getSellerReadyTransitionModalCopy("local_delivery")).toEqual({
        title: "Ready to deliver the item?",
        body: "Coordinate the delivery details with your buyer before starting the delivery.",
        primaryLabel: "Ready for Delivery",
      });
    });
  });

  describe("getSellerHandedOverTransitionModalCopy -- locked confirmation-modal copy shown before mark_order_handed_over_or_shipped", () => {
    it("returns the exact locked title/body/primary label for each of the four fulfillment methods", () => {
      expect(getSellerHandedOverTransitionModalCopy("pickup")).toEqual({
        title: "Has the buyer collected the item?",
        body: "Only confirm this after the item has actually been handed to the buyer.",
        primaryLabel: "Confirm Picked Up",
      });
      expect(getSellerHandedOverTransitionModalCopy("shipping")).toEqual({
        title: "Has the item been shipped?",
        body: "Confirm only after the parcel has actually been handed to the courier or shipping provider.",
        primaryLabel: "Confirm Shipped",
      });
      expect(getSellerHandedOverTransitionModalCopy("meetup")).toEqual({
        title: "Was the item handed over?",
        body: "Confirm only after the buyer has received the item in person.",
        primaryLabel: "Confirm Handover",
      });
      expect(getSellerHandedOverTransitionModalCopy("local_delivery")).toEqual({
        title: "Has the item been delivered?",
        body: "Confirm only after the buyer has actually received the item.",
        primaryLabel: "Confirm Delivered",
      });
    });
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

  describe("getAllowedBuyerActions", () => {
    it("allows only cancel_pending for a pending order", () => {
      expect(getAllowedBuyerActions("pending", false)).toEqual(["cancel_pending"]);
    });

    it("allows confirm_changes and cancel_changes for a changes_pending order", () => {
      expect(getAllowedBuyerActions("changes_pending", false)).toEqual(["confirm_changes", "cancel_changes"]);
    });

    it("allows request_cancellation for an accepted order with no pending request", () => {
      expect(getAllowedBuyerActions("accepted", false)).toEqual(["request_cancellation"]);
    });

    it("allows request_cancellation for a ready order with no pending request", () => {
      expect(getAllowedBuyerActions("ready", false)).toEqual(["request_cancellation"]);
    });

    it("hides request_cancellation once a cancellation request is already pending, to prevent duplicates", () => {
      expect(getAllowedBuyerActions("accepted", true)).toEqual([]);
      expect(getAllowedBuyerActions("ready", true)).toEqual([]);
    });

    it("allows only confirm_receipt for a handed_over_or_shipped order", () => {
      expect(getAllowedBuyerActions("handed_over_or_shipped", false)).toEqual(["confirm_receipt"]);
    });

    it("allows no buyer action for received_confirmed -- it is a fleeting state immediately superseded by completed", () => {
      expect(getAllowedBuyerActions("received_confirmed", false)).toEqual([]);
    });

    it("allows no buyer action for every terminal status", () => {
      for (const status of ["completed", "declined", "cancelled", "expired", "disputed"] as const) {
        expect(getAllowedBuyerActions(status, false)).toEqual([]);
      }
    });
  });
});
