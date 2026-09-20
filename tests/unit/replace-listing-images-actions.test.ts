import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock, fromMock, createClientMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  // Throws if ever called -- replaceListingImages must only ever call
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

import { replaceListingImages, REPLACE_LISTING_IMAGES_ERROR_MESSAGES } from "@/lib/seller/listing-actions";

beforeEach(() => {
  rpcMock.mockReset();
  fromMock.mockClear();
});

describe("replaceListingImages -- baseline (no dedicated action-level test file existed before A2.2.2c)", () => {
  it("calls replace_listing_images with the exact listing id, paths, and flags", async () => {
    rpcMock.mockResolvedValue({
      data: [{ listing_id: "listing-1", image_count: 1, cover_image_id: "img-1" }],
      error: null,
    });

    await replaceListingImages("listing-1", ["listing-images/owner-1/listing-1/a.jpg"], [false]);

    expect(rpcMock).toHaveBeenCalledWith("replace_listing_images", {
      p_listing_id: "listing-1",
      p_image_paths: ["listing-images/owner-1/listing-1/a.jpg"],
      p_reference_flags: [false],
    });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("returns the resulting image count/cover on success", async () => {
    rpcMock.mockResolvedValue({
      data: [{ listing_id: "listing-1", image_count: 1, cover_image_id: "img-1" }],
      error: null,
    });

    const result = await replaceListingImages("listing-1", ["listing-images/owner-1/listing-1/a.jpg"], [false]);

    expect(result).toEqual({ ok: true, listingId: "listing-1", imageCount: 1, coverImageId: "img-1" });
  });

  it("maps a known error DETAIL to its typed code, not a raw error", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "blocked", details: "TOO_MANY_LISTING_IMAGES" } });
    const result = await replaceListingImages("listing-1", [], []);
    expect(result).toEqual({ ok: false, code: "TOO_MANY_LISTING_IMAGES" });
  });

  it("maps an unrecognized error detail to UNKNOWN rather than leaking it", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'duplicate key value violates unique constraint "listing_images_pkey"' } });
    const result = await replaceListingImages("listing-1", [], []);
    expect(result).toEqual({ ok: false, code: "UNKNOWN" });
    expect(REPLACE_LISTING_IMAGES_ERROR_MESSAGES.UNKNOWN).not.toMatch(/constraint|duplicate key/i);
  });

  it("returns UNKNOWN when the RPC throws", async () => {
    rpcMock.mockRejectedValue(new Error("network down"));
    const result = await replaceListingImages("listing-1", [], []);
    expect(result).toEqual({ ok: false, code: "UNKNOWN" });
  });
});

describe("replaceListingImages -- INTERACTION_BLOCKED restriction-aware presentation (A2.2.2c)", () => {
  function mockBlocked(restrictions: { restriction_type: string }[]) {
    rpcMock.mockImplementation((fn: string) => {
      if (fn === "replace_listing_images") {
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

    const result = await replaceListingImages("listing-1", [], []);

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

    const result = await replaceListingImages("listing-1", [], []);

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

    const result = await replaceListingImages("listing-1", [], []);

    expect((result as { restriction?: { message: string } }).restriction?.message).toBe("Your account is currently suspended.");
  });

  it("does not attach a restriction when only buyer_restricted (unrelated) exists -- generic error preserved", async () => {
    mockBlocked([{ restriction_type: "buyer_restricted" }]);

    const result = await replaceListingImages("listing-1", [], []);

    expect(result).toEqual({ ok: false, code: "INTERACTION_BLOCKED" });
  });

  it("does not attach a restriction when the restriction result is empty -- generic error preserved (also covers a deleted/unavailable-account collision)", async () => {
    mockBlocked([]);

    const result = await replaceListingImages("listing-1", [], []);

    expect(result).toEqual({ ok: false, code: "INTERACTION_BLOCKED" });
  });

  it("does not attach a restriction and does not throw when the restriction lookup itself fails", async () => {
    rpcMock.mockImplementation((fn: string) => {
      if (fn === "replace_listing_images") {
        return Promise.resolve({ data: null, error: { message: "blocked", details: "INTERACTION_BLOCKED" } });
      }
      if (fn === "get_my_active_restrictions") {
        return Promise.resolve({ data: null, error: { message: "lookup failed" } });
      }
      throw new Error(`unexpected rpc ${fn}`);
    });

    const result = await replaceListingImages("listing-1", [], []);

    expect(result).toEqual({ ok: false, code: "INTERACTION_BLOCKED" });
  });

  it("never calls get_my_active_restrictions for a non-INTERACTION_BLOCKED failure", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "too many", details: "TOO_MANY_LISTING_IMAGES" } });

    const result = await replaceListingImages("listing-1", [], []);

    expect(result).toEqual({ ok: false, code: "TOO_MANY_LISTING_IMAGES" });
    expect(rpcMock).not.toHaveBeenCalledWith("get_my_active_restrictions");
  });

  it("never calls get_my_active_restrictions on a successful replace", async () => {
    rpcMock.mockResolvedValue({
      data: [{ listing_id: "listing-1", image_count: 1, cover_image_id: "img-1" }],
      error: null,
    });

    await replaceListingImages("listing-1", ["listing-images/owner-1/listing-1/a.jpg"], [false]);

    expect(rpcMock).not.toHaveBeenCalledWith("get_my_active_restrictions");
  });
});
