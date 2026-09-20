import { describe, expect, it } from "vitest";
import { selectInteractionBlockedPresentation } from "@/lib/moderation/select-interaction-blocked-presentation";

describe("selectInteractionBlockedPresentation", () => {
  it("returns the seller-suspended message and the fixed CTA/href", () => {
    const result = selectInteractionBlockedPresentation(["seller_suspended"], ["account_suspended", "seller_suspended"]);
    expect(result).toEqual({
      message: "Your selling access is currently suspended.",
      ctaLabel: "View account status",
      href: "/account#account-status",
    });
  });

  it("returns the account-suspended message and the fixed CTA/href", () => {
    const result = selectInteractionBlockedPresentation(["account_suspended"], ["account_suspended", "seller_suspended"]);
    expect(result).toEqual({
      message: "Your account is currently suspended.",
      ctaLabel: "View account status",
      href: "/account#account-status",
    });
  });

  it("returns the buyer-restricted message and the fixed CTA/href", () => {
    const result = selectInteractionBlockedPresentation(["buyer_restricted"], ["account_suspended", "buyer_restricted"]);
    expect(result).toEqual({
      message: "Your buying access is currently restricted.",
      ctaLabel: "View account status",
      href: "/account#account-status",
    });
  });

  it("honors caller-supplied precedence -- account_suspended wins when listed first, regardless of active-list order", () => {
    const result = selectInteractionBlockedPresentation(
      ["seller_suspended", "account_suspended"],
      ["account_suspended", "seller_suspended"],
    );
    expect(result?.message).toBe("Your account is currently suspended.");
  });

  it("honors a different precedence order for a different caller -- seller_suspended wins when listed first", () => {
    const result = selectInteractionBlockedPresentation(
      ["seller_suspended", "account_suspended"],
      ["seller_suspended", "account_suspended"],
    );
    expect(result?.message).toBe("Your selling access is currently suspended.");
  });

  it("ignores an active restriction type that is not in the caller's own relevant list", () => {
    const result = selectInteractionBlockedPresentation(["buyer_restricted"], ["account_suspended", "seller_suspended"]);
    expect(result).toBeNull();
  });

  it("returns null for an empty active-restrictions list", () => {
    const result = selectInteractionBlockedPresentation([], ["account_suspended", "seller_suspended"]);
    expect(result).toBeNull();
  });

  it("returns null when the relevant-types list is empty, even with active restrictions", () => {
    const result = selectInteractionBlockedPresentation(["account_suspended"], []);
    expect(result).toBeNull();
  });
});
