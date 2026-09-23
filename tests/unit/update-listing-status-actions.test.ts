import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock, fromMock, createClientMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  // Throws if ever called -- updateListingStatus must only ever call
  // supabase.rpc(...), never read/write a table directly.
  fromMock: vi.fn(() => {
    throw new Error("must not access .from() directly -- use the RPC only");
  }),
  createClientMock: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: createClientMock,
}));

createClientMock.mockReturnValue({ rpc: rpcMock, from: fromMock });

import { updateListingStatus } from "@/lib/seller/listing-actions";

beforeEach(() => {
  rpcMock.mockReset();
  fromMock.mockClear();
});

describe("updateListingStatus", () => {
  it("calls update_listing_status with only the listing id and target status", async () => {
    rpcMock.mockResolvedValue({
      data: [{ listing_id: "listing-1", status: "paused", was_already_in_status: false, updated_at: "2026-01-05T00:00:00.000Z" }],
      error: null,
    });

    await updateListingStatus("listing-1", "paused");

    expect(rpcMock).toHaveBeenCalledWith("update_listing_status", { p_listing_id: "listing-1", p_status: "paused" });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("returns the updated status on success", async () => {
    rpcMock.mockResolvedValue({
      data: [{ listing_id: "listing-1", status: "available", was_already_in_status: false, updated_at: "2026-01-05T00:00:00.000Z" }],
      error: null,
    });

    const result = await updateListingStatus("listing-1", "available");

    expect(result).toEqual({
      ok: true,
      listingId: "listing-1",
      status: "available",
      wasAlreadyInStatus: false,
      updatedAt: "2026-01-05T00:00:00.000Z",
    });
  });

  it.each(["NOT_AUTHENTICATED", "SHOP_NOT_FOUND", "LISTING_NOT_FOUND", "NOT_LISTING_OWNER", "TARGET_STATUS_NOT_ALLOWED", "LISTING_HAS_ACTIVE_RESERVATION", "INVALID_STATUS_TRANSITION"])(
    "maps the pre-existing error code %s",
    async (code) => {
      rpcMock.mockResolvedValue({ data: null, error: { message: "failed", details: code } });
      const result = await updateListingStatus("listing-1", "available");
      expect(result).toEqual({ ok: false, code });
    },
  );

  // Regression coverage for the Resume "generic error" bug: update_listing_status
  // (0094) calls validate_published_listing on Paused -> Available exactly like
  // publish_listing does, so any of its completeness codes can come back from a
  // Resume attempt (e.g. stock silently reaching 0 while paused). Before the fix,
  // none of these were in the recognized set, so toErrorCode() coerced every one
  // of them to "UNKNOWN" -- a real, specific, RPC-reported reason was discarded
  // and replaced with "Something went wrong. Please try again."
  it.each([
    "TITLE_REQUIRED",
    "DESCRIPTION_REQUIRED",
    "CATEGORY_REQUIRED",
    "LISTING_TYPE_REQUIRED",
    "CONDITION_REQUIRED",
    "LISTING_TYPE_CONDITION_MISMATCH",
    "KNOWN_FLAWS_REQUIRED",
    "PRICE_REQUIRED",
    "STOCK_QUANTITY_INVALID",
    "PROVINCE_REQUIRED",
    "CITY_REQUIRED",
    "FULFILLMENT_REQUIRED",
    "IMAGE_REQUIRED",
    "TOO_MANY_LISTING_IMAGES",
    "REFERENCE_IMAGES_NOT_ALLOWED_FOR_PRELOVED",
    "BRAND_NEW_REQUIRES_ACTUAL_IMAGE",
  ])("maps validate_published_listing's own completeness code %s from a Resume attempt, not UNKNOWN", async (code) => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "failed", details: code } });
    const result = await updateListingStatus("listing-1", "available");
    expect(result).toEqual({ ok: false, code });
  });

  it("maps an unrecognized error detail to UNKNOWN rather than leaking it", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "raw postgres error", details: "23505" } });
    const result = await updateListingStatus("listing-1", "available");
    expect(result).toEqual({ ok: false, code: "UNKNOWN" });
  });

  it("returns UNKNOWN when the RPC throws", async () => {
    rpcMock.mockRejectedValue(new Error("network down"));
    const result = await updateListingStatus("listing-1", "available");
    expect(result).toEqual({ ok: false, code: "UNKNOWN" });
  });
});

describe("updateListingStatus -- INTERACTION_BLOCKED restriction-aware presentation", () => {
  function mockBlocked(restrictions: { restriction_type: string }[]) {
    rpcMock.mockImplementation((fn: string) => {
      if (fn === "update_listing_status") {
        return Promise.resolve({ data: null, error: { message: "blocked", details: "INTERACTION_BLOCKED" } });
      }
      if (fn === "get_my_active_restrictions") {
        return Promise.resolve({
          data: restrictions.map((r, i) => ({ restriction_id: `r${i}`, restriction_type: r.restriction_type, reason: "x", created_at: "2026-01-01T00:00:00.000Z" })),
          error: null,
        });
      }
      throw new Error(`unexpected rpc ${fn}`);
    });
  }

  it("attaches the selling-access message and link when seller_suspended is confirmed", async () => {
    mockBlocked([{ restriction_type: "seller_suspended" }]);

    const result = await updateListingStatus("listing-1", "paused");

    expect(result).toEqual({
      ok: false,
      code: "INTERACTION_BLOCKED",
      restriction: {
        message: "Your selling access is currently suspended.",
        ctaLabel: "View account status",
        href: "/account#account-status",
      },
    });
  });
});
