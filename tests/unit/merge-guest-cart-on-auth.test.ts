import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ rpc: rpcMock }),
}));

import { mergeGuestCartOnAuth } from "@/lib/cart/merge-guest-cart-on-auth";
import { writeGuestCart, readGuestCart } from "@/lib/cart/guest-cart-storage";

beforeEach(() => {
  rpcMock.mockReset();
  window.localStorage.clear();
});

describe("mergeGuestCartOnAuth", () => {
  it("does nothing (no RPC call) when the guest cart is empty, reporting attempted: false", async () => {
    const outcome = await mergeGuestCartOnAuth();
    expect(rpcMock).not.toHaveBeenCalled();
    expect(outcome).toEqual({ attempted: false });
  });

  it("calls merge_guest_cart with {listing_id, quantity} pairs, clears local storage, and returns per-item results on success", async () => {
    writeGuestCart([
      { listingId: "l1", publicCode: "PLS-1", quantity: 2 },
      { listingId: "l2", publicCode: "PLS-2", quantity: 1 },
    ]);
    rpcMock.mockResolvedValue({
      data: [
        { listing_id: "l1", result: "merged", final_quantity: 2 },
        { listing_id: "l2", result: "skipped_not_cartable", final_quantity: null },
      ],
      error: null,
    });

    const outcome = await mergeGuestCartOnAuth();

    expect(rpcMock).toHaveBeenCalledWith("merge_guest_cart", {
      p_items: [
        { listing_id: "l1", quantity: 2 },
        { listing_id: "l2", quantity: 1 },
      ],
    });
    expect(readGuestCart()).toEqual([]);
    expect(outcome).toEqual({
      attempted: true,
      ok: true,
      results: [
        { listingId: "l1", finalQuantity: 2 },
        { listingId: "l2", finalQuantity: null },
      ],
    });
  });

  it("preserves local guest cart data and reports ok: false when the RPC fails", async () => {
    writeGuestCart([{ listingId: "l1", publicCode: "PLS-1", quantity: 2 }]);
    rpcMock.mockResolvedValue({ data: null, error: { message: "boom" } });

    const outcome = await mergeGuestCartOnAuth();

    expect(readGuestCart()).toEqual([{ listingId: "l1", publicCode: "PLS-1", quantity: 2 }]);
    expect(outcome).toEqual({ attempted: true, ok: false });
  });

  it("never rejects/throws when the RPC call itself throws (must not break sign-in), reporting ok: false", async () => {
    writeGuestCart([{ listingId: "l1", publicCode: "PLS-1", quantity: 1 }]);
    rpcMock.mockRejectedValue(new Error("network down"));

    const outcome = await mergeGuestCartOnAuth();

    expect(outcome).toEqual({ attempted: true, ok: false });
    expect(readGuestCart()).toEqual([{ listingId: "l1", publicCode: "PLS-1", quantity: 1 }]);
  });
});
