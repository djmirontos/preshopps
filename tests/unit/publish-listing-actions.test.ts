import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock, fromMock, createClientMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  // Throws if ever called -- publishListing/acceptSellerPolicies must only
  // ever call supabase.rpc(...), never read/write a table directly.
  fromMock: vi.fn(() => {
    throw new Error("must not access .from() directly -- use the RPC only");
  }),
  createClientMock: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: createClientMock,
}));

createClientMock.mockReturnValue({ rpc: rpcMock, from: fromMock });

import { publishListing, acceptSellerPolicies } from "@/lib/seller/listing-actions";

beforeEach(() => {
  rpcMock.mockReset();
  fromMock.mockClear();
});

describe("publishListing", () => {
  it("calls publish_listing with only the listing id -- no client-supplied status/shop/owner identity", async () => {
    rpcMock.mockResolvedValue({
      data: [{ listing_id: "listing-1", public_code: "PSL-ABC", slug: "nike-air-max-270", status: "available", published_at: "2026-01-05T00:00:00.000Z" }],
      error: null,
    });

    await publishListing("listing-1");

    expect(rpcMock).toHaveBeenCalledWith("publish_listing", { p_listing_id: "listing-1" });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("returns the published listing's identifiers on success", async () => {
    rpcMock.mockResolvedValue({
      data: [{ listing_id: "listing-1", public_code: "PSL-ABC", slug: "nike-air-max-270", status: "available", published_at: "2026-01-05T00:00:00.000Z" }],
      error: null,
    });

    const result = await publishListing("listing-1");

    expect(result).toEqual({
      ok: true,
      listingId: "listing-1",
      publicCode: "PSL-ABC",
      slug: "nike-air-max-270",
      status: "available",
      publishedAt: "2026-01-05T00:00:00.000Z",
    });
  });

  it("maps SELLER_POLICIES_NOT_ACCEPTED to a typed code, not a raw error", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "blocked", details: "SELLER_POLICIES_NOT_ACCEPTED" } });
    const result = await publishListing("listing-1");
    expect(result).toEqual({ ok: false, code: "SELLER_POLICIES_NOT_ACCEPTED" });
  });

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
    "LISTING_NOT_DRAFT",
    "INTERACTION_BLOCKED",
    "NOT_AUTHENTICATED",
    "SHOP_NOT_FOUND",
    "LISTING_NOT_FOUND",
    "NOT_LISTING_OWNER",
  ])("maps the live publish_listing error code %s", async (code) => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "failed", details: code } });
    const result = await publishListing("listing-1");
    expect(result).toEqual({ ok: false, code });
  });

  it("maps an unrecognized error detail to UNKNOWN rather than leaking it", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "raw postgres error", details: "23505" } });
    const result = await publishListing("listing-1");
    expect(result).toEqual({ ok: false, code: "UNKNOWN" });
  });

  it("returns UNKNOWN when the RPC throws", async () => {
    rpcMock.mockRejectedValue(new Error("network down"));
    const result = await publishListing("listing-1");
    expect(result).toEqual({ ok: false, code: "UNKNOWN" });
  });
});

describe("publishListing -- INTERACTION_BLOCKED restriction-aware presentation (A2.2.2b)", () => {
  function mockBlocked(restrictions: { restriction_type: string }[]) {
    rpcMock.mockImplementation((fn: string) => {
      if (fn === "publish_listing") {
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

    const result = await publishListing("listing-1");

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

  it("attaches the account-suspended message and link when account_suspended is confirmed", async () => {
    mockBlocked([{ restriction_type: "account_suspended" }]);

    const result = await publishListing("listing-1");

    expect(result).toEqual({
      ok: false,
      code: "INTERACTION_BLOCKED",
      restriction: {
        message: "Your account is currently suspended.",
        ctaLabel: "View account status",
        href: "/account#account-status",
      },
    });
  });

  it("account_suspended wins when both account_suspended and seller_suspended are active", async () => {
    mockBlocked([{ restriction_type: "seller_suspended" }, { restriction_type: "account_suspended" }]);

    const result = await publishListing("listing-1");

    expect((result as { restriction?: { message: string } }).restriction?.message).toBe("Your account is currently suspended.");
  });

  it("does not attach a restriction when only buyer_restricted (unrelated) exists -- generic error preserved", async () => {
    mockBlocked([{ restriction_type: "buyer_restricted" }]);

    const result = await publishListing("listing-1");

    expect(result).toEqual({ ok: false, code: "INTERACTION_BLOCKED" });
  });

  it("does not attach a restriction when the restriction result is empty -- generic error preserved", async () => {
    mockBlocked([]);

    const result = await publishListing("listing-1");

    expect(result).toEqual({ ok: false, code: "INTERACTION_BLOCKED" });
  });

  it("does not attach a restriction and does not throw when the restriction lookup itself fails", async () => {
    rpcMock.mockImplementation((fn: string) => {
      if (fn === "publish_listing") {
        return Promise.resolve({ data: null, error: { message: "blocked", details: "INTERACTION_BLOCKED" } });
      }
      if (fn === "get_my_active_restrictions") {
        return Promise.resolve({ data: null, error: { message: "lookup failed" } });
      }
      throw new Error(`unexpected rpc ${fn}`);
    });

    const result = await publishListing("listing-1");

    expect(result).toEqual({ ok: false, code: "INTERACTION_BLOCKED" });
  });

  it("never calls get_my_active_restrictions for a non-INTERACTION_BLOCKED failure", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "not draft", details: "LISTING_NOT_DRAFT" } });

    const result = await publishListing("listing-1");

    expect(result).toEqual({ ok: false, code: "LISTING_NOT_DRAFT" });
    expect(rpcMock).not.toHaveBeenCalledWith("get_my_active_restrictions");
  });

  it("never calls get_my_active_restrictions on a successful publish", async () => {
    rpcMock.mockResolvedValue({
      data: [{ listing_id: "listing-1", public_code: "PSL-ABC", slug: "nike-air-max-270", status: "available", published_at: "2026-01-05T00:00:00.000Z" }],
      error: null,
    });

    await publishListing("listing-1");

    expect(rpcMock).not.toHaveBeenCalledWith("get_my_active_restrictions");
  });
});

describe("acceptSellerPolicies", () => {
  it("calls accept_seller_policies with no parameters", async () => {
    rpcMock.mockResolvedValue({ data: [{ accepted_at: "2026-01-05T00:00:00.000Z" }], error: null });

    await acceptSellerPolicies();

    expect(rpcMock).toHaveBeenCalledWith("accept_seller_policies");
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("returns the acceptance timestamp on success", async () => {
    rpcMock.mockResolvedValue({ data: [{ accepted_at: "2026-01-05T00:00:00.000Z" }], error: null });
    const result = await acceptSellerPolicies();
    expect(result).toEqual({ ok: true, acceptedAt: "2026-01-05T00:00:00.000Z" });
  });

  it("maps PROFILE_NOT_FOUND", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "missing", details: "PROFILE_NOT_FOUND" } });
    const result = await acceptSellerPolicies();
    expect(result).toEqual({ ok: false, code: "PROFILE_NOT_FOUND" });
  });

  it("maps NOT_AUTHENTICATED", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "denied", details: "NOT_AUTHENTICATED" } });
    const result = await acceptSellerPolicies();
    expect(result).toEqual({ ok: false, code: "NOT_AUTHENTICATED" });
  });

  it("returns UNKNOWN when the RPC throws", async () => {
    rpcMock.mockRejectedValue(new Error("network down"));
    const result = await acceptSellerPolicies();
    expect(result).toEqual({ ok: false, code: "UNKNOWN" });
  });
});
