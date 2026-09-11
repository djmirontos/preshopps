import { getAppUrl } from "@/lib/env";

export type EmailEventType =
  | "new_order_request"
  | "order_accepted"
  | "order_declined"
  | "order_partial_acceptance"
  | "order_expiration_reminder"
  | "order_seller_cancelled"
  | "moderation_restriction_applied"
  | "moderation_restriction_lifted";

export type EmailTemplate = { subject: string; text: string; html: string };

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function wrapHtml(bodyLines: string[], linkHref: string, linkLabel: string): string {
  const paragraphs = bodyLines.map((line) => `<p style="margin:0 0 12px;">${escapeHtml(line)}</p>`).join("");
  const link = `<p style="margin:20px 0 0;"><a href="${escapeHtml(linkHref)}" style="color:#111827;">${escapeHtml(linkLabel)}</a></p>`;
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#111827;max-width:480px;"><p style="margin:0 0 20px;font-weight:600;">Preshopps</p>${paragraphs}${link}</div>`;
}

function sellerOrderLink(publicCode: string): string {
  return `${getAppUrl()}/seller/orders/${publicCode}`;
}

function buyerOrderLink(publicCode: string): string {
  return `${getAppUrl()}/orders/${publicCode}`;
}

function supportLink(): string {
  return `${getAppUrl()}/support`;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" ? value : fallback;
}

function formatRestrictionType(value: string): string {
  return value.replace(/_/g, " ");
}

function buildTemplate(subject: string, lines: string[], href: string, linkLabel: string): EmailTemplate {
  return {
    subject,
    text: `${lines.join("\n")}\n\n${linkLabel}: ${href}`,
    html: wrapHtml(lines, href, linkLabel),
  };
}

/**
 * Pure rendering function: (event type, payload) -> {subject, text, html}.
 * No I/O, no provider call -- fully unit-testable. Each template contains
 * only enough information to act (PRD/task instruction), never private
 * admin notes, OTPs, passwords, payment details, or any escrow/refund/
 * payment-processing claim. Links always use getAppUrl() (the canonical
 * app base URL from environment/config), never a hardcoded domain.
 */
export function renderEmailTemplate(eventType: EmailEventType, payload: Record<string, unknown>): EmailTemplate {
  switch (eventType) {
    case "new_order_request": {
      const code = asString(payload.order_public_code, "your order");
      return buildTemplate(
        `New order request -- ${code}`,
        [`You have a new order request (${code}).`, "Please review and respond -- accept, decline, or partially accept -- within 72 hours."],
        sellerOrderLink(code),
        "View order request",
      );
    }
    case "order_accepted": {
      const code = asString(payload.order_public_code, "your order");
      return buildTemplate(
        `Order accepted -- ${code}`,
        [`Good news -- your order (${code}) was accepted by the seller.`],
        buyerOrderLink(code),
        "View order",
      );
    }
    case "order_declined": {
      const code = asString(payload.order_public_code, "your order");
      return buildTemplate(
        `Order declined -- ${code}`,
        [`Your order (${code}) was declined by the seller.`],
        buyerOrderLink(code),
        "View order",
      );
    }
    case "order_partial_acceptance": {
      const code = asString(payload.order_public_code, "your order");
      const accepted = asNumber(payload.accepted_count);
      const declined = asNumber(payload.declined_count);
      return buildTemplate(
        `Order partially accepted -- ${code}`,
        [
          `Your order (${code}) was partially accepted: ${accepted} item(s) accepted, ${declined} item(s) declined.`,
          "Please confirm the changes to continue with the accepted items.",
        ],
        buyerOrderLink(code),
        "Review and confirm changes",
      );
    }
    case "order_expiration_reminder": {
      const code = asString(payload.order_public_code, "your order");
      return buildTemplate(
        `Order request expiring soon -- ${code}`,
        [
          `Your order request (${code}) has not been answered yet and will expire in about 24 hours.`,
          "Please respond soon -- accept, decline, or partially accept.",
        ],
        sellerOrderLink(code),
        "View order request",
      );
    }
    case "order_seller_cancelled": {
      const code = asString(payload.order_public_code, "your order");
      const reason = asString(payload.reason);
      return buildTemplate(
        `Order cancelled by seller -- ${code}`,
        [`The seller cancelled your order (${code}).`, ...(reason ? [`Reason: ${reason}`] : [])],
        buyerOrderLink(code),
        "View order",
      );
    }
    case "moderation_restriction_applied": {
      const restrictionType = formatRestrictionType(asString(payload.restriction_type, "restriction"));
      const reason = asString(payload.reason);
      return buildTemplate(
        "Action taken on your Preshopps account",
        [
          `An admin action was taken on your account (${restrictionType}).`,
          ...(reason ? [`Reason: ${reason}`] : []),
          "If you believe this is a mistake, please contact support.",
        ],
        supportLink(),
        "Contact support",
      );
    }
    case "moderation_restriction_lifted": {
      const restrictionType = formatRestrictionType(asString(payload.restriction_type, "restriction"));
      const note = asString(payload.note);
      return buildTemplate(
        "Your Preshopps account restriction was lifted",
        [`Your account restriction (${restrictionType}) has been lifted.`, ...(note ? [`Note: ${note}`] : [])],
        supportLink(),
        "Contact support",
      );
    }
    default: {
      const exhaustiveCheck: never = eventType;
      throw new Error(`Unhandled email event type: ${String(exhaustiveCheck)}`);
    }
  }
}
