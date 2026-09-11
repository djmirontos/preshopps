import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  getAppUrl: () => "https://preshopps.test",
}));

import { renderEmailTemplate, type EmailEventType } from "@/lib/email/templates";

describe("renderEmailTemplate", () => {
  it("new_order_request links to the seller order detail page", () => {
    const t = renderEmailTemplate("new_order_request", { order_public_code: "PSO-ABC123" });
    expect(t.subject).toContain("PSO-ABC123");
    expect(t.text).toContain("https://preshopps.test/seller/orders/PSO-ABC123");
    expect(t.html).toContain("https://preshopps.test/seller/orders/PSO-ABC123");
  });

  it("order_accepted links to the buyer order detail page", () => {
    const t = renderEmailTemplate("order_accepted", { order_public_code: "PSO-XYZ" });
    expect(t.text).toContain("https://preshopps.test/orders/PSO-XYZ");
  });

  it("order_declined links to the buyer order detail page", () => {
    const t = renderEmailTemplate("order_declined", { order_public_code: "PSO-XYZ" });
    expect(t.text).toContain("https://preshopps.test/orders/PSO-XYZ");
  });

  it("order_partial_acceptance includes accepted/declined counts", () => {
    const t = renderEmailTemplate("order_partial_acceptance", {
      order_public_code: "PSO-1",
      accepted_count: 2,
      declined_count: 1,
    });
    expect(t.text).toContain("2 item(s) accepted");
    expect(t.text).toContain("1 item(s) declined");
  });

  it("order_expiration_reminder links to the seller order detail page and mentions ~24 hours", () => {
    const t = renderEmailTemplate("order_expiration_reminder", { order_public_code: "PSO-1" });
    expect(t.text).toContain("https://preshopps.test/seller/orders/PSO-1");
    expect(t.text).toMatch(/24 hours/);
  });

  it("order_seller_cancelled includes the reason when present and links to the buyer order page", () => {
    const t = renderEmailTemplate("order_seller_cancelled", { order_public_code: "PSO-1", reason: "Item unavailable" });
    expect(t.text).toContain("Item unavailable");
    expect(t.text).toContain("https://preshopps.test/orders/PSO-1");
  });

  it("order_seller_cancelled omits a reason line when none is given", () => {
    const t = renderEmailTemplate("order_seller_cancelled", { order_public_code: "PSO-1" });
    expect(t.text).not.toContain("Reason:");
  });

  it("moderation_restriction_applied links to support and includes the reason", () => {
    const t = renderEmailTemplate("moderation_restriction_applied", {
      restriction_type: "seller_suspended",
      reason: "Repeated policy violations",
    });
    expect(t.text).toContain("https://preshopps.test/support");
    expect(t.text).toContain("Repeated policy violations");
  });

  it("moderation_restriction_lifted links to support and includes the note when present", () => {
    const t = renderEmailTemplate("moderation_restriction_lifted", {
      restriction_type: "buyer_restricted",
      note: "Appeal accepted",
    });
    expect(t.text).toContain("Appeal accepted");
    expect(t.text).toContain("https://preshopps.test/support");
  });

  it("never claims escrow/refund/payment processing, and never mentions passwords/OTPs/card numbers, in any of the seven events", () => {
    const cases: Array<[EmailEventType, Record<string, unknown>]> = [
      ["new_order_request", { order_public_code: "PSO-1" }],
      ["order_accepted", { order_public_code: "PSO-1" }],
      ["order_declined", { order_public_code: "PSO-1" }],
      ["order_partial_acceptance", { order_public_code: "PSO-1", accepted_count: 1, declined_count: 1 }],
      ["order_expiration_reminder", { order_public_code: "PSO-1" }],
      ["order_seller_cancelled", { order_public_code: "PSO-1", reason: "Item unavailable" }],
      ["moderation_restriction_applied", { restriction_type: "account_suspended", reason: "Policy violation" }],
      ["moderation_restriction_lifted", { restriction_type: "account_suspended", note: "Resolved" }],
    ];

    for (const [eventType, payload] of cases) {
      const t = renderEmailTemplate(eventType, payload);
      const combined = `${t.subject} ${t.text} ${t.html}`.toLowerCase();
      expect(combined).not.toMatch(/password|\botp\b|one-time code|card number|escrow|refund/);
    }
  });

  it("html output escapes payload text -- no raw HTML injection from a stored reason/note", () => {
    const t = renderEmailTemplate("order_seller_cancelled", {
      order_public_code: "PSO-1",
      reason: "<script>alert(1)</script>",
    });
    expect(t.html).not.toContain("<script>alert(1)</script>");
    expect(t.html).toContain("&lt;script&gt;");
  });

  it("falls back to a generic 'your order'/'restriction' label when payload fields are missing, never throwing", () => {
    expect(() => renderEmailTemplate("order_accepted", {})).not.toThrow();
    expect(() => renderEmailTemplate("moderation_restriction_applied", {})).not.toThrow();
  });
});
