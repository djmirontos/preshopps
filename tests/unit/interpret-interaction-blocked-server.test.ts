import { beforeEach, describe, expect, it, vi } from "vitest";

const { getMyActiveRestrictionsMock } = vi.hoisted(() => ({
  getMyActiveRestrictionsMock: vi.fn(),
}));
vi.mock("@/lib/moderation/get-my-active-restrictions", () => ({
  getMyActiveRestrictions: getMyActiveRestrictionsMock,
}));

import { interpretInteractionBlockedServer } from "@/lib/moderation/interpret-interaction-blocked-server";
import type { RestrictionType } from "@/lib/moderation/get-my-active-restrictions";

const PUBLISHED_LISTING_RELEVANT: RestrictionType[] = ["account_suspended", "seller_suspended"];

function restriction(restrictionType: RestrictionType) {
  return { restrictionId: "r1", restrictionType, reason: "reason", createdAt: "2026-01-01T00:00:00.000Z" };
}

beforeEach(() => {
  getMyActiveRestrictionsMock.mockReset();
});

describe("interpretInteractionBlockedServer", () => {
  it("uses the server restriction lookup (getMyActiveRestrictions), never the browser client", async () => {
    getMyActiveRestrictionsMock.mockResolvedValue({ restrictions: [restriction("seller_suspended")], hadError: false });

    await interpretInteractionBlockedServer("INTERACTION_BLOCKED", PUBLISHED_LISTING_RELEVANT);

    expect(getMyActiveRestrictionsMock).toHaveBeenCalledTimes(1);
    expect(getMyActiveRestrictionsMock).toHaveBeenCalledWith();
  });

  it("seller suspension returns the selling-access message and the account-status link", async () => {
    getMyActiveRestrictionsMock.mockResolvedValue({ restrictions: [restriction("seller_suspended")], hadError: false });

    const result = await interpretInteractionBlockedServer("INTERACTION_BLOCKED", PUBLISHED_LISTING_RELEVANT);

    expect(result).toEqual({
      message: "Your selling access is currently suspended.",
      ctaLabel: "View account status",
      href: "/account#account-status",
    });
  });

  it("account suspension returns the account-suspended message and the account-status link", async () => {
    getMyActiveRestrictionsMock.mockResolvedValue({ restrictions: [restriction("account_suspended")], hadError: false });

    const result = await interpretInteractionBlockedServer("INTERACTION_BLOCKED", PUBLISHED_LISTING_RELEVANT);

    expect(result).toEqual({
      message: "Your account is currently suspended.",
      ctaLabel: "View account status",
      href: "/account#account-status",
    });
  });

  it("account_suspended wins when both account_suspended and seller_suspended are active", async () => {
    getMyActiveRestrictionsMock.mockResolvedValue({
      restrictions: [restriction("seller_suspended"), restriction("account_suspended")],
      hadError: false,
    });

    const result = await interpretInteractionBlockedServer("INTERACTION_BLOCKED", PUBLISHED_LISTING_RELEVANT);

    expect(result?.message).toBe("Your account is currently suspended.");
  });

  it("returns null when only an unrelated restriction (buyer_restricted) exists -- not relevant to published-listing editing", async () => {
    getMyActiveRestrictionsMock.mockResolvedValue({ restrictions: [restriction("buyer_restricted")], hadError: false });

    const result = await interpretInteractionBlockedServer("INTERACTION_BLOCKED", PUBLISHED_LISTING_RELEVANT);

    expect(result).toBeNull();
  });

  it("returns null when the restriction result is empty -- also covers a deleted/unavailable-account collision", async () => {
    getMyActiveRestrictionsMock.mockResolvedValue({ restrictions: [], hadError: false });

    const result = await interpretInteractionBlockedServer("INTERACTION_BLOCKED", PUBLISHED_LISTING_RELEVANT);

    expect(result).toBeNull();
  });

  it("returns null (never throws) when the lookup itself fails", async () => {
    getMyActiveRestrictionsMock.mockResolvedValue({ restrictions: [], hadError: true });

    const result = await interpretInteractionBlockedServer("INTERACTION_BLOCKED", PUBLISHED_LISTING_RELEVANT);

    expect(result).toBeNull();
  });

  it("returns null (never throws) even if the underlying lookup call rejects unexpectedly", async () => {
    getMyActiveRestrictionsMock.mockRejectedValue(new Error("unexpected"));

    const result = await interpretInteractionBlockedServer("INTERACTION_BLOCKED", PUBLISHED_LISTING_RELEVANT);

    expect(result).toBeNull();
  });

  it("returns null and never calls the lookup for a non-INTERACTION_BLOCKED error code", async () => {
    const result = await interpretInteractionBlockedServer("LISTING_NOT_EDITABLE", PUBLISHED_LISTING_RELEVANT);

    expect(result).toBeNull();
    expect(getMyActiveRestrictionsMock).not.toHaveBeenCalled();
  });
});
