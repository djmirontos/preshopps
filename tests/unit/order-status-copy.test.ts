import { describe, expect, it } from "vitest";
import {
  getOrderStatusLabel,
  getOrderStatusGuidance,
  isPositiveOrderStatus,
  type OrderStatus,
} from "@/lib/orders/order-status-copy";

const ALL_STATUSES: OrderStatus[] = [
  "pending",
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
  it("has a non-empty label and guidance string for every one of the ten canonical statuses", () => {
    for (const status of ALL_STATUSES) {
      expect(getOrderStatusLabel(status, "meetup").length).toBeGreaterThan(0);
      expect(getOrderStatusGuidance(status, "meetup").length).toBeGreaterThan(0);
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
});
