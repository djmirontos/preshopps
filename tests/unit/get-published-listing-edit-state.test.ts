import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock, fromMock, createClientMock, getMyActiveRestrictionsMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  // Throws if ever called -- this loader must only ever call
  // supabase.rpc(...), never read/write a table directly.
  fromMock: vi.fn(() => {
    throw new Error("must not access .from() directly -- use the RPC only");
  }),
  createClientMock: vi.fn(),
  getMyActiveRestrictionsMock: vi.fn(),
}));

// The cookie-aware SERVER client (@supabase/ssr's createServerClient via
// lib/supabase/server.ts) -- NOT @/lib/supabase/client. This is the entire
// point of this module: proving it uses the server client is what proves
// the permission-denied bug (a browser client silently carrying no session
// during SSR) cannot recur here.
vi.mock("@/lib/supabase/server", () => ({
  createClient: createClientMock,
}));

// interpretInteractionBlockedServer's own dependency -- already covered by
// its own dedicated test file (interpret-interaction-blocked-server.test.ts),
// so mocked here at this boundary rather than reaching through it into
// getAuthUser + a second RPC name. This loader's own job is only to prove
// it calls the server interpreter correctly and attaches/omits the result.
vi.mock("@/lib/moderation/get-my-active-restrictions", () => ({
  getMyActiveRestrictions: getMyActiveRestrictionsMock,
}));

createClientMock.mockResolvedValue({ rpc: rpcMock, from: fromMock });

import { getPublishedListingEditState } from "@/lib/seller/get-published-listing-edit-state";

beforeEach(() => {
  rpcMock.mockReset();
  fromMock.mockClear();
  createClientMock.mockClear();
  createClientMock.mockResolvedValue({ rpc: rpcMock, from: fromMock });
  getMyActiveRestrictionsMock.mockReset();
});

const HUGE_REVISION = "9007199254740993";

function sampleRow(overrides: Record<string, unknown> = {}) {
  return {
    listing_id: "listing-1",
    public_code: "PSL-ABC123",
    slug: "nike-air-max-270",
    status: "available",
    title: "Nike Air Max 270",
    description: "Worn twice.",
    category_id: 1,
    listing_type: "preloved",
    condition: "good",
    price_cents: 150000,
    original_price_cents: null,
    is_negotiable: false,
    brand: "Nike",
    known_flaws: null,
    stock_quantity: 5,
    province_id: 1,
    city_id: 10,
    barangay_id: 100,
    meetup_note: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-05T00:00:00.000Z",
    published_at: "2026-01-02T00:00:00.000Z",
    fulfillment_methods: ["meetup"],
    images: [{ id: "img-1", storage_path: "listing-images/u1/listing-1/a.jpg", position: 0, is_reference_image: false }],
    vehicle_details: null,
    rental_details: null,
    revision: "1",
    available_quantity: 5,
    reserved_quantity: 0,
    cover_image_id: "img-1",
    quantity_editable: true,
    ...overrides,
  };
}

/**
 * Same RPC name/params, same result shapes, same error-code mapping as
 * published-listing-actions.test.ts's own getPublishedListingEditState
 * suite -- deliberately mirrored case-for-case to prove the server-safe
 * loader and the browser wrapper can never silently diverge (both funnel
 * through the same shared mapGetPublishedListingEditStateResponse).
 */
describe("getPublishedListingEditState (server-safe loader)", () => {
  it("uses the cookie-aware server client, not a table read", async () => {
    rpcMock.mockResolvedValue({ data: sampleRow(), error: null });

    await getPublishedListingEditState("listing-1");

    expect(createClientMock).toHaveBeenCalled();
    expect(rpcMock).toHaveBeenCalledWith("get_published_listing_edit_state", { p_listing_id: "listing-1" });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("maps a successful scalar-jsonb response into the same camelCase result shape as the browser wrapper", async () => {
    rpcMock.mockResolvedValue({ data: sampleRow(), error: null });

    const result = await getPublishedListingEditState("listing-1");

    expect(result).toEqual({
      status: "found",
      listing: {
        listingId: "listing-1",
        publicCode: "PSL-ABC123",
        slug: "nike-air-max-270",
        status: "available",
        title: "Nike Air Max 270",
        description: "Worn twice.",
        categoryId: 1,
        listingType: "preloved",
        condition: "good",
        priceCents: 150000,
        originalPriceCents: null,
        isNegotiable: false,
        brand: "Nike",
        knownFlaws: null,
        stockQuantity: 5,
        provinceId: 1,
        cityId: 10,
        barangayId: 100,
        meetupNote: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-05T00:00:00.000Z",
        publishedAt: "2026-01-02T00:00:00.000Z",
        fulfillmentMethods: ["meetup"],
        images: [{ id: "img-1", storagePath: "listing-images/u1/listing-1/a.jpg", position: 0, isReferenceImage: false }],
        vehicleDetails: null,
        rentalDetails: null,
        revision: "1",
        availableQuantity: 5,
        reservedQuantity: 0,
        coverImageId: "img-1",
        quantityEditable: true,
      },
    });
  });

  it("preserves a revision far beyond Number.MAX_SAFE_INTEGER exactly, as a string", async () => {
    rpcMock.mockResolvedValue({ data: sampleRow({ revision: HUGE_REVISION }), error: null });

    const result = await getPublishedListingEditState("listing-1");

    expect(result.status).toBe("found");
    if (result.status === "found") {
      expect(result.listing.revision).toBe(HUGE_REVISION);
      expect(typeof result.listing.revision).toBe("string");
    }
  });

  it("collapses LISTING_NOT_FOUND to not_found -- no existence information leaked", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "missing", details: "LISTING_NOT_FOUND" } });
    const result = await getPublishedListingEditState("listing-1");
    expect(result).toEqual({ status: "not_found" });
  });

  it("collapses NOT_LISTING_OWNER to the exact same not_found result as LISTING_NOT_FOUND", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "denied", details: "NOT_LISTING_OWNER" } });
    const result = await getPublishedListingEditState("listing-1");
    expect(result).toEqual({ status: "not_found" });
  });

  it("keeps LISTING_NOT_EDITABLE distinct from not_found -- a real, actionable read-only state", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "not editable", details: "LISTING_NOT_EDITABLE" } });
    const result = await getPublishedListingEditState("listing-1");
    expect(result).toEqual({ status: "not_editable" });
  });

  it("maps NOT_AUTHENTICATED to its own result", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "denied", details: "NOT_AUTHENTICATED" } });
    const result = await getPublishedListingEditState("listing-1");
    expect(result).toEqual({ status: "not_authenticated" });
  });

  it("maps INTERACTION_BLOCKED to its own result", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "blocked", details: "INTERACTION_BLOCKED" } });
    const result = await getPublishedListingEditState("listing-1");
    expect(result).toEqual({ status: "interaction_blocked" });
  });

  it("would map this exact bug's own error (permission denied, an unrecognized detail) to a generic, non-leaking error", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "permission denied for function get_published_listing_edit_state", details: undefined } });
    const result = await getPublishedListingEditState("listing-1");
    expect(result).toEqual({ status: "error" });
  });

  it("maps an unrecognized error detail to a generic error, never leaking raw Postgres text", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "raw postgres error", details: "23505" } });
    const result = await getPublishedListingEditState("listing-1");
    expect(result).toEqual({ status: "error" });
  });

  it("returns error when the RPC throws", async () => {
    rpcMock.mockRejectedValue(new Error("network down"));
    const result = await getPublishedListingEditState("listing-1");
    expect(result).toEqual({ status: "error" });
  });

  it("returns error rather than crashing if the RPC somehow resolves with no data and no error", async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });
    const result = await getPublishedListingEditState("listing-1");
    expect(result).toEqual({ status: "error" });
  });
});

describe("getPublishedListingEditState (server-safe loader) -- INTERACTION_BLOCKED restriction-aware presentation (A2.2.2e)", () => {
  function mockBlocked(restrictions: { restriction_type: string }[]) {
    rpcMock.mockResolvedValue({ data: null, error: { message: "blocked", details: "INTERACTION_BLOCKED" } });
    getMyActiveRestrictionsMock.mockResolvedValue({
      restrictions: restrictions.map((r, i) => ({ restrictionId: `r${i}`, restrictionType: r.restriction_type, reason: "x", createdAt: "2026-01-01T00:00:00.000Z" })),
      hadError: false,
    });
  }

  it("attaches the selling-access message and link when seller_suspended is confirmed", async () => {
    mockBlocked([{ restriction_type: "seller_suspended" }]);

    const result = await getPublishedListingEditState("listing-1");

    expect(result).toEqual({
      status: "interaction_blocked",
      restriction: {
        message: "Your selling access is currently suspended.",
        ctaLabel: "View account status",
        href: "/account#account-status",
      },
    });
  });

  it("attaches the account-suspended message and link when account_suspended is confirmed", async () => {
    mockBlocked([{ restriction_type: "account_suspended" }]);

    const result = await getPublishedListingEditState("listing-1");

    expect(result).toEqual({
      status: "interaction_blocked",
      restriction: {
        message: "Your account is currently suspended.",
        ctaLabel: "View account status",
        href: "/account#account-status",
      },
    });
  });

  it("account_suspended wins when both account_suspended and seller_suspended are active", async () => {
    mockBlocked([{ restriction_type: "seller_suspended" }, { restriction_type: "account_suspended" }]);

    const result = await getPublishedListingEditState("listing-1");

    expect((result as { restriction?: { message: string } }).restriction?.message).toBe("Your account is currently suspended.");
  });

  it("does not attach a restriction when only buyer_restricted (unrelated) exists -- generic result preserved", async () => {
    mockBlocked([{ restriction_type: "buyer_restricted" }]);

    const result = await getPublishedListingEditState("listing-1");

    expect(result).toEqual({ status: "interaction_blocked" });
  });

  it("does not attach a restriction when the restriction result is empty -- generic result preserved (also covers a deleted/unavailable-account collision)", async () => {
    mockBlocked([]);

    const result = await getPublishedListingEditState("listing-1");

    expect(result).toEqual({ status: "interaction_blocked" });
  });

  it("does not attach a restriction and does not throw when the restriction lookup itself fails", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "blocked", details: "INTERACTION_BLOCKED" } });
    getMyActiveRestrictionsMock.mockResolvedValue({ restrictions: [], hadError: true });

    const result = await getPublishedListingEditState("listing-1");

    expect(result).toEqual({ status: "interaction_blocked" });
  });

  it("never calls the restriction lookup for a non-INTERACTION_BLOCKED result", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "not editable", details: "LISTING_NOT_EDITABLE" } });

    const result = await getPublishedListingEditState("listing-1");

    expect(result).toEqual({ status: "not_editable" });
    expect(getMyActiveRestrictionsMock).not.toHaveBeenCalled();
  });

  it("never calls the restriction lookup on a successful load", async () => {
    rpcMock.mockResolvedValue({ data: sampleRow(), error: null });

    const result = await getPublishedListingEditState("listing-1");

    expect(result.status).toBe("found");
    expect(getMyActiveRestrictionsMock).not.toHaveBeenCalled();
  });
});
