import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock, fromMock, createClientMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  // Throws if ever called -- these wrappers must only ever call
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

import {
  getPublishedListingEditState,
  updatePublishedListing,
  type PublishedListingImages,
} from "@/lib/seller/published-listing-actions";

beforeEach(() => {
  rpcMock.mockReset();
  fromMock.mockClear();
});

/** A bigint value well beyond Number.MAX_SAFE_INTEGER (9007199254740991) --
 * used to prove the wrapper never rounds/corrupts revision by routing it
 * through a JS number anywhere. */
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

describe("getPublishedListingEditState", () => {
  it("calls get_published_listing_edit_state with only the listing id", async () => {
    rpcMock.mockResolvedValue({ data: sampleRow(), error: null });

    await getPublishedListingEditState("listing-1");

    expect(rpcMock).toHaveBeenCalledWith("get_published_listing_edit_state", { p_listing_id: "listing-1" });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("maps a successful scalar-jsonb response into the camelCase result shape", async () => {
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

  it("does NOT treat the response as a row array -- a scalar jsonb object is the whole response", async () => {
    // If a future edit mistakenly copies the `((data ?? [])[0])` pattern
    // from the table-returning RPCs, this response would be misread as
    // `undefined` and every field below would be wrong/missing.
    rpcMock.mockResolvedValue({ data: sampleRow({ title: "Distinctive Title" }), error: null });
    const result = await getPublishedListingEditState("listing-1");
    expect(result.status).toBe("found");
    expect(result.status === "found" && result.listing.title).toBe("Distinctive Title");
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

describe("getPublishedListingEditState -- INTERACTION_BLOCKED restriction-aware presentation (A2.2.2e)", () => {
  function mockBlocked(restrictions: { restriction_type: string }[]) {
    rpcMock.mockImplementation((fn: string) => {
      if (fn === "get_published_listing_edit_state") {
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
    rpcMock.mockImplementation((fn: string) => {
      if (fn === "get_published_listing_edit_state") {
        return Promise.resolve({ data: null, error: { message: "blocked", details: "INTERACTION_BLOCKED" } });
      }
      if (fn === "get_my_active_restrictions") {
        return Promise.resolve({ data: null, error: { message: "lookup failed" } });
      }
      throw new Error(`unexpected rpc ${fn}`);
    });

    const result = await getPublishedListingEditState("listing-1");

    expect(result).toEqual({ status: "interaction_blocked" });
  });

  it("never calls get_my_active_restrictions for a non-INTERACTION_BLOCKED result", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "not editable", details: "LISTING_NOT_EDITABLE" } });

    const result = await getPublishedListingEditState("listing-1");

    expect(result).toEqual({ status: "not_editable" });
    expect(rpcMock).not.toHaveBeenCalledWith("get_my_active_restrictions");
  });

  it("never calls get_my_active_restrictions on a successful load", async () => {
    rpcMock.mockResolvedValue({ data: sampleRow(), error: null });

    const result = await getPublishedListingEditState("listing-1");

    expect(result.status).toBe("found");
    expect(rpcMock).not.toHaveBeenCalledWith("get_my_active_restrictions");
  });
});

describe("updatePublishedListing", () => {
  it("calls update_published_listing with the listing id, revision, patch, and images", async () => {
    rpcMock.mockResolvedValue({ data: { ...sampleRow(), changed: true }, error: null });

    const images: PublishedListingImages = [{ image_id: "img-1", is_reference_image: false, is_cover: true }];
    await updatePublishedListing("listing-1", "1", { title: "New title" }, images);

    expect(rpcMock).toHaveBeenCalledWith("update_published_listing", {
      p_listing_id: "listing-1",
      p_expected_revision: "1",
      p_patch: { title: "New title" },
      p_images: images,
    });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("defaults p_images to null when no images argument is given -- never an empty array", async () => {
    rpcMock.mockResolvedValue({ data: { ...sampleRow(), changed: false }, error: null });

    await updatePublishedListing("listing-1", "1", {});

    expect(rpcMock).toHaveBeenCalledWith("update_published_listing", {
      p_listing_id: "listing-1",
      p_expected_revision: "1",
      p_patch: {},
      p_images: null,
    });
  });

  it("forwards the patch object unchanged -- no diffing/mutation inside the wrapper", async () => {
    rpcMock.mockResolvedValue({ data: { ...sampleRow(), changed: true }, error: null });

    const patch = { description: null, available_quantity: 3, is_negotiable: true };
    await updatePublishedListing("listing-1", "1", patch);

    expect(rpcMock.mock.calls[0][1].p_patch).toBe(patch);
  });

  it("forwards the complete images array unchanged", async () => {
    rpcMock.mockResolvedValue({ data: { ...sampleRow(), changed: true }, error: null });

    const images: PublishedListingImages = [
      { storage_path: "listing-images/u1/listing-1/new.jpg", is_reference_image: false, is_cover: true },
      { image_id: "img-1", is_reference_image: false, is_cover: false },
    ];
    await updatePublishedListing("listing-1", "1", {}, images);

    expect(rpcMock.mock.calls[0][1].p_images).toBe(images);
  });

  it("passes expectedRevision through to p_expected_revision without ever touching a JS number", async () => {
    rpcMock.mockResolvedValue({ data: { ...sampleRow({ revision: HUGE_REVISION }), changed: false }, error: null });

    await updatePublishedListing("listing-1", HUGE_REVISION, {});

    const args = rpcMock.mock.calls[0][1];
    expect(args.p_expected_revision).toBe(HUGE_REVISION);
    expect(typeof args.p_expected_revision).toBe("string");
  });

  it("returns the huge revision from a successful save exactly, as a string", async () => {
    rpcMock.mockResolvedValue({ data: { ...sampleRow({ revision: HUGE_REVISION }), changed: true }, error: null });

    const result = await updatePublishedListing("listing-1", "1", { title: "x" });

    expect(result.outcome).toBe("saved");
    if (result.outcome === "saved") {
      expect(result.listing.revision).toBe(HUGE_REVISION);
    }
  });

  it("returns outcome: saved with the updated listing and changed flag on success", async () => {
    rpcMock.mockResolvedValue({ data: { ...sampleRow({ title: "Updated Title", revision: "2" }), changed: true }, error: null });

    const result = await updatePublishedListing("listing-1", "1", { title: "Updated Title" });

    expect(result.outcome).toBe("saved");
    if (result.outcome === "saved") {
      expect(result.listing.title).toBe("Updated Title");
      expect(result.listing.revision).toBe("2");
      expect(result.changed).toBe(true);
    }
  });

  it("returns changed: false for a genuine no-op save, without incrementing revision", async () => {
    rpcMock.mockResolvedValue({ data: { ...sampleRow({ revision: "1" }), changed: false }, error: null });

    const result = await updatePublishedListing("listing-1", "1", { title: "Nike Air Max 270" });

    expect(result.outcome).toBe("saved");
    if (result.outcome === "saved") {
      expect(result.changed).toBe(false);
      expect(result.listing.revision).toBe("1");
    }
  });

  it("gives STALE_LISTING_REVISION its own distinct outcome, never bundled with a generic failure code", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "changed", details: "STALE_LISTING_REVISION" } });

    const result = await updatePublishedListing("listing-1", "1", { title: "x" });

    expect(result).toEqual({ outcome: "stale_revision" });
    expect(result).not.toHaveProperty("code");
  });

  it.each([
    "NOT_AUTHENTICATED",
    "NOT_LISTING_OWNER",
    "LISTING_NOT_FOUND",
    "LISTING_NOT_EDITABLE",
    "INTERACTION_BLOCKED",
    "PROTECTED_FIELD",
    "UNKNOWN_FIELD",
    "LISTING_HAS_ACTIVE_RESERVATION",
    "INVALID_PUBLISHED_LISTING",
    "INVALID_IMAGE_STATE",
  ])("maps the live update_published_listing error code %s to a failed outcome", async (code) => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "failed", details: code } });
    const result = await updatePublishedListing("listing-1", "1", { title: "x" });
    expect(result).toEqual({ outcome: "failed", code });
  });

  it("sanitizes an unrecognized backend error to UNKNOWN rather than leaking raw Postgres details", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "duplicate key value", details: "23505" } });
    const result = await updatePublishedListing("listing-1", "1", { title: "x" });
    expect(result).toEqual({ outcome: "failed", code: "UNKNOWN" });
  });

  it("returns a failed/UNKNOWN outcome when the RPC throws", async () => {
    rpcMock.mockRejectedValue(new Error("network down"));
    const result = await updatePublishedListing("listing-1", "1", { title: "x" });
    expect(result).toEqual({ outcome: "failed", code: "UNKNOWN" });
  });

  it("returns a failed/UNKNOWN outcome rather than crashing if the RPC somehow resolves with no data and no error", async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });
    const result = await updatePublishedListing("listing-1", "1", { title: "x" });
    expect(result).toEqual({ outcome: "failed", code: "UNKNOWN" });
  });
});

describe("updatePublishedListing -- INTERACTION_BLOCKED restriction-aware presentation (A2.2.2e)", () => {
  function mockBlocked(restrictions: { restriction_type: string }[]) {
    rpcMock.mockImplementation((fn: string) => {
      if (fn === "update_published_listing") {
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

    const result = await updatePublishedListing("listing-1", "1", { title: "x" });

    expect(result).toEqual({
      outcome: "failed",
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

    const result = await updatePublishedListing("listing-1", "1", { title: "x" });

    expect(result).toEqual({
      outcome: "failed",
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

    const result = await updatePublishedListing("listing-1", "1", { title: "x" });

    expect((result as { restriction?: { message: string } }).restriction?.message).toBe("Your account is currently suspended.");
  });

  it("does not attach a restriction when only buyer_restricted (unrelated) exists -- generic outcome preserved", async () => {
    mockBlocked([{ restriction_type: "buyer_restricted" }]);

    const result = await updatePublishedListing("listing-1", "1", { title: "x" });

    expect(result).toEqual({ outcome: "failed", code: "INTERACTION_BLOCKED" });
  });

  it("does not attach a restriction when the restriction result is empty -- generic outcome preserved (also covers a deleted/unavailable-account collision)", async () => {
    mockBlocked([]);

    const result = await updatePublishedListing("listing-1", "1", { title: "x" });

    expect(result).toEqual({ outcome: "failed", code: "INTERACTION_BLOCKED" });
  });

  it("does not attach a restriction and does not throw when the restriction lookup itself fails", async () => {
    rpcMock.mockImplementation((fn: string) => {
      if (fn === "update_published_listing") {
        return Promise.resolve({ data: null, error: { message: "blocked", details: "INTERACTION_BLOCKED" } });
      }
      if (fn === "get_my_active_restrictions") {
        return Promise.resolve({ data: null, error: { message: "lookup failed" } });
      }
      throw new Error(`unexpected rpc ${fn}`);
    });

    const result = await updatePublishedListing("listing-1", "1", { title: "x" });

    expect(result).toEqual({ outcome: "failed", code: "INTERACTION_BLOCKED" });
  });

  it("never calls get_my_active_restrictions for a non-INTERACTION_BLOCKED failure", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "not editable", details: "LISTING_NOT_EDITABLE" } });

    const result = await updatePublishedListing("listing-1", "1", { title: "x" });

    expect(result).toEqual({ outcome: "failed", code: "LISTING_NOT_EDITABLE" });
    expect(rpcMock).not.toHaveBeenCalledWith("get_my_active_restrictions");
  });

  it("never calls get_my_active_restrictions on a successful save", async () => {
    rpcMock.mockResolvedValue({ data: { ...sampleRow(), changed: true }, error: null });

    const result = await updatePublishedListing("listing-1", "1", { title: "x" });

    expect(result.outcome).toBe("saved");
    expect(rpcMock).not.toHaveBeenCalledWith("get_my_active_restrictions");
  });

  it("never calls get_my_active_restrictions for a stale-revision conflict", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "changed", details: "STALE_LISTING_REVISION" } });

    const result = await updatePublishedListing("listing-1", "1", { title: "x" });

    expect(result).toEqual({ outcome: "stale_revision" });
    expect(rpcMock).not.toHaveBeenCalledWith("get_my_active_restrictions");
  });
});
