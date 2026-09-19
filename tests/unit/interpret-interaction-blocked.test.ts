import { beforeEach, describe, expect, it, vi } from "vitest";

const { getMyActiveRestrictionsClientMock } = vi.hoisted(() => ({
  getMyActiveRestrictionsClientMock: vi.fn(),
}));
vi.mock("@/lib/moderation/get-my-active-restrictions-client", () => ({
  getMyActiveRestrictionsClient: getMyActiveRestrictionsClientMock,
}));

import { interpretInteractionBlocked } from "@/lib/moderation/interpret-interaction-blocked";
import type { RestrictionType } from "@/lib/moderation/get-my-active-restrictions";

const CHECKOUT_RELEVANT: RestrictionType[] = ["account_suspended", "buyer_restricted"];

function restriction(restrictionType: RestrictionType) {
  return { restrictionId: "r1", restrictionType, reason: "reason", createdAt: "2026-01-01T00:00:00.000Z" };
}

beforeEach(() => {
  getMyActiveRestrictionsClientMock.mockReset();
});

describe("interpretInteractionBlocked", () => {
  it("buyer restriction returns the buying-access message and the account-status link", async () => {
    getMyActiveRestrictionsClientMock.mockResolvedValue({ ok: true, restrictions: [restriction("buyer_restricted")] });

    const result = await interpretInteractionBlocked("INTERACTION_BLOCKED", CHECKOUT_RELEVANT);

    expect(result).toEqual({
      message: "Your buying access is currently restricted.",
      ctaLabel: "View account status",
      href: "/account#account-status",
    });
  });

  it("account suspension returns the account-suspended message and the account-status link", async () => {
    getMyActiveRestrictionsClientMock.mockResolvedValue({ ok: true, restrictions: [restriction("account_suspended")] });

    const result = await interpretInteractionBlocked("INTERACTION_BLOCKED", CHECKOUT_RELEVANT);

    expect(result).toEqual({
      message: "Your account is currently suspended.",
      ctaLabel: "View account status",
      href: "/account#account-status",
    });
  });

  it("account suspension wins when both buyer_restricted and account_suspended are active", async () => {
    getMyActiveRestrictionsClientMock.mockResolvedValue({
      ok: true,
      restrictions: [restriction("buyer_restricted"), restriction("account_suspended")],
    });

    const result = await interpretInteractionBlocked("INTERACTION_BLOCKED", CHECKOUT_RELEVANT);

    expect(result?.message).toBe("Your account is currently suspended.");
  });

  it("returns null when only an unrelated restriction (seller_suspended) exists -- seller-only suspension is ignored for checkout", async () => {
    getMyActiveRestrictionsClientMock.mockResolvedValue({ ok: true, restrictions: [restriction("seller_suspended")] });

    const result = await interpretInteractionBlocked("INTERACTION_BLOCKED", CHECKOUT_RELEVANT);

    expect(result).toBeNull();
  });

  it("returns null when the restriction result is empty, preserving the existing generic error", async () => {
    getMyActiveRestrictionsClientMock.mockResolvedValue({ ok: true, restrictions: [] });

    const result = await interpretInteractionBlocked("INTERACTION_BLOCKED", CHECKOUT_RELEVANT);

    expect(result).toBeNull();
  });

  it("returns null (never throws) when the restriction lookup fails", async () => {
    getMyActiveRestrictionsClientMock.mockResolvedValue({ ok: false });

    const result = await interpretInteractionBlocked("INTERACTION_BLOCKED", CHECKOUT_RELEVANT);

    expect(result).toBeNull();
  });

  it("returns null and never calls the lookup for a non-INTERACTION_BLOCKED error code", async () => {
    const result = await interpretInteractionBlocked("PRICE_CHANGED", CHECKOUT_RELEVANT);

    expect(result).toBeNull();
    expect(getMyActiveRestrictionsClientMock).not.toHaveBeenCalled();
  });

  it("never throws (returns null) even if the underlying lookup call rejects unexpectedly", async () => {
    getMyActiveRestrictionsClientMock.mockRejectedValue(new Error("unexpected"));

    const result = await interpretInteractionBlocked("INTERACTION_BLOCKED", CHECKOUT_RELEVANT);

    expect(result).toBeNull();
  });
});
