import { beforeEach, describe, expect, it } from "vitest";
import { readGuestCart, writeGuestCart, clearGuestCart } from "@/lib/cart/guest-cart-storage";

const STORAGE_KEY = "preshopps:guest-cart:v1";

beforeEach(() => {
  window.localStorage.clear();
});

describe("guest-cart-storage", () => {
  it("returns an empty array when nothing is stored", () => {
    expect(readGuestCart()).toEqual([]);
  });

  it("round-trips a written cart", () => {
    writeGuestCart([{ listingId: "l1", publicCode: "PLS-1", quantity: 2 }]);
    expect(readGuestCart()).toEqual([{ listingId: "l1", publicCode: "PLS-1", quantity: 2 }]);
  });

  it("uses a versioned storage key", () => {
    writeGuestCart([{ listingId: "l1", publicCode: "PLS-1", quantity: 1 }]);
    expect(window.localStorage.getItem(STORAGE_KEY)).not.toBeNull();
  });

  it("falls back to an empty array on corrupted (non-JSON) storage", () => {
    window.localStorage.setItem(STORAGE_KEY, "{not valid json");
    expect(readGuestCart()).toEqual([]);
  });

  it("falls back to an empty array when the stored value is not an array", () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ not: "an array" }));
    expect(readGuestCart()).toEqual([]);
  });

  it("drops individual entries missing required fields rather than failing the whole read", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        { listingId: "l1", publicCode: "PLS-1", quantity: 1 },
        { listingId: "l2" }, // missing publicCode/quantity
        { listingId: "l3", publicCode: "PLS-3", quantity: 0 }, // invalid quantity
        { listingId: "l4", publicCode: "PLS-4", quantity: -1 }, // invalid quantity
        { listingId: "l5", publicCode: "PLS-5", quantity: 1.5 }, // non-integer
      ]),
    );
    expect(readGuestCart()).toEqual([{ listingId: "l1", publicCode: "PLS-1", quantity: 1 }]);
  });

  it("clearGuestCart removes the stored cart entirely", () => {
    writeGuestCart([{ listingId: "l1", publicCode: "PLS-1", quantity: 1 }]);
    clearGuestCart();
    expect(readGuestCart()).toEqual([]);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("writeGuestCart drops lines with a null/empty publicCode defensively", () => {
    writeGuestCart([
      { listingId: "l1", publicCode: "PLS-1", quantity: 1 },
      { listingId: "l2", publicCode: null, quantity: 1 },
    ]);
    expect(readGuestCart()).toEqual([{ listingId: "l1", publicCode: "PLS-1", quantity: 1 }]);
  });
});
