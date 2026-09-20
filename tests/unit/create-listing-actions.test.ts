import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock, fromMock, createClientMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  // Throws if ever called -- createListing must only ever call
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

import { createListing, CREATE_LISTING_ERROR_MESSAGES, type CreateListingInput } from "@/lib/seller/listing-actions";

const BASE_INPUT: CreateListingInput = {
  title: "Nike Air Max 270",
  description: null,
  categoryId: null,
  listingType: null,
  condition: null,
  priceCents: null,
  originalPriceCents: null,
  isNegotiable: false,
  brand: null,
  knownFlaws: null,
  stockQuantity: null,
  provinceId: null,
  cityId: null,
  barangayId: null,
  meetupNote: null,
  fulfillmentMethods: [],
  vehicleDetails: null,
  rentalDetails: null,
};

beforeEach(() => {
  rpcMock.mockReset();
  fromMock.mockClear();
});

describe("createListing -- baseline (no dedicated action-level test file existed before A2.2.2b)", () => {
  it("calls create_listing with the expected payload -- images stay out of scope (p_image_paths null)", async () => {
    rpcMock.mockResolvedValue({
      data: [{ listing_id: "listing-1", public_code: "PSL-NEW", slug: "nike-air-max-270", status: "draft", created_at: "2026-01-05T00:00:00.000Z" }],
      error: null,
    });

    await createListing(BASE_INPUT);

    expect(rpcMock).toHaveBeenCalledWith("create_listing", expect.objectContaining({ p_title: "Nike Air Max 270", p_image_paths: null }));
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("returns the created draft's identifiers on success", async () => {
    rpcMock.mockResolvedValue({
      data: [{ listing_id: "listing-1", public_code: "PSL-NEW", slug: "nike-air-max-270", status: "draft", created_at: "2026-01-05T00:00:00.000Z" }],
      error: null,
    });

    const result = await createListing(BASE_INPUT);

    expect(result).toEqual({
      ok: true,
      listingId: "listing-1",
      publicCode: "PSL-NEW",
      slug: "nike-air-max-270",
      status: "draft",
      createdAt: "2026-01-05T00:00:00.000Z",
    });
  });

  it("maps a known error DETAIL to its typed code, not a raw error", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "blocked", details: "TITLE_REQUIRED" } });
    const result = await createListing(BASE_INPUT);
    expect(result).toEqual({ ok: false, code: "TITLE_REQUIRED" });
  });

  it("maps an unrecognized error detail to UNKNOWN rather than leaking it", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'duplicate key value violates unique constraint "listings_pkey"' } });
    const result = await createListing(BASE_INPUT);
    expect(result).toEqual({ ok: false, code: "UNKNOWN" });
    expect(CREATE_LISTING_ERROR_MESSAGES.UNKNOWN).not.toMatch(/constraint|duplicate key/i);
  });

  it("returns UNKNOWN when the RPC throws", async () => {
    rpcMock.mockRejectedValue(new Error("network down"));
    const result = await createListing(BASE_INPUT);
    expect(result).toEqual({ ok: false, code: "UNKNOWN" });
  });
});

describe("createListing -- INTERACTION_BLOCKED restriction-aware presentation (A2.2.2b)", () => {
  function mockBlocked(restrictions: { restriction_type: string }[]) {
    rpcMock.mockImplementation((fn: string) => {
      if (fn === "create_listing") {
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

    const result = await createListing(BASE_INPUT);

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

    const result = await createListing(BASE_INPUT);

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

    const result = await createListing(BASE_INPUT);

    expect((result as { restriction?: { message: string } }).restriction?.message).toBe("Your account is currently suspended.");
  });

  it("does not attach a restriction when only buyer_restricted (unrelated) exists -- generic error preserved", async () => {
    mockBlocked([{ restriction_type: "buyer_restricted" }]);

    const result = await createListing(BASE_INPUT);

    expect(result).toEqual({ ok: false, code: "INTERACTION_BLOCKED" });
  });

  it("does not attach a restriction when the restriction result is empty -- generic error preserved", async () => {
    mockBlocked([]);

    const result = await createListing(BASE_INPUT);

    expect(result).toEqual({ ok: false, code: "INTERACTION_BLOCKED" });
  });

  it("does not attach a restriction and does not throw when the restriction lookup itself fails", async () => {
    rpcMock.mockImplementation((fn: string) => {
      if (fn === "create_listing") {
        return Promise.resolve({ data: null, error: { message: "blocked", details: "INTERACTION_BLOCKED" } });
      }
      if (fn === "get_my_active_restrictions") {
        return Promise.resolve({ data: null, error: { message: "lookup failed" } });
      }
      throw new Error(`unexpected rpc ${fn}`);
    });

    const result = await createListing(BASE_INPUT);

    expect(result).toEqual({ ok: false, code: "INTERACTION_BLOCKED" });
  });

  it("never calls get_my_active_restrictions for a non-INTERACTION_BLOCKED failure", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "no shop", details: "SHOP_NOT_FOUND" } });

    const result = await createListing(BASE_INPUT);

    expect(result).toEqual({ ok: false, code: "SHOP_NOT_FOUND" });
    expect(rpcMock).not.toHaveBeenCalledWith("get_my_active_restrictions");
  });

  it("never calls get_my_active_restrictions on a successful create", async () => {
    rpcMock.mockResolvedValue({
      data: [{ listing_id: "listing-1", public_code: "PSL-NEW", slug: "nike-air-max-270", status: "draft", created_at: "2026-01-05T00:00:00.000Z" }],
      error: null,
    });

    await createListing(BASE_INPUT);

    expect(rpcMock).not.toHaveBeenCalledWith("get_my_active_restrictions");
  });
});
