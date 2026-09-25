import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BUY_NOW_SUCCESS_STORAGE_KEY,
  consumeBuyNowSuccessFlagFor,
  markBuyNowOrderSubmitted,
} from "@/lib/cart/buy-now-success-flag";

beforeEach(() => {
  sessionStorage.clear();
});

describe("buy-now-success-flag", () => {
  it("consumeBuyNowSuccessFlagFor is false before markBuyNowOrderSubmitted is ever called", () => {
    expect(consumeBuyNowSuccessFlagFor("PSO-1")).toBe(false);
  });

  it("marks then consumes the flag for the exact order code, removing it from storage", () => {
    markBuyNowOrderSubmitted("PSO-1");

    expect(consumeBuyNowSuccessFlagFor("PSO-1")).toBe(true);
    expect(sessionStorage.getItem(BUY_NOW_SUCCESS_STORAGE_KEY)).toBeNull();
  });

  it("one-time only: a second consume for the same order code returns false once the flag has already been removed", () => {
    markBuyNowOrderSubmitted("PSO-1");

    expect(consumeBuyNowSuccessFlagFor("PSO-1")).toBe(true);
    expect(consumeBuyNowSuccessFlagFor("PSO-1")).toBe(false);
  });

  it("order-code mismatch: consumeBuyNowSuccessFlagFor is false for any code other than the one just submitted, and leaves the real flag untouched for a later, correct visit", () => {
    markBuyNowOrderSubmitted("PSO-1");

    expect(consumeBuyNowSuccessFlagFor("PSO-2")).toBe(false);
    expect(consumeBuyNowSuccessFlagFor("")).toBe(false);
    // Visiting the wrong order never consumed order PSO-1's own flag --
    // it's still there, exactly as if those mismatched calls never happened.
    expect(sessionStorage.getItem(BUY_NOW_SUCCESS_STORAGE_KEY)).toBe("PSO-1");
    expect(consumeBuyNowSuccessFlagFor("PSO-1")).toBe(true);
  });

  it("writes to sessionStorage, never localStorage", () => {
    markBuyNowOrderSubmitted("PSO-1");
    expect(sessionStorage.getItem(BUY_NOW_SUCCESS_STORAGE_KEY)).toBe("PSO-1");
    expect(localStorage.getItem(BUY_NOW_SUCCESS_STORAGE_KEY)).toBeNull();
  });

  it("a second markBuyNowOrderSubmitted for a different order overwrites the first -- the flag only ever matches the most recent order", () => {
    markBuyNowOrderSubmitted("PSO-1");
    markBuyNowOrderSubmitted("PSO-2");
    expect(consumeBuyNowSuccessFlagFor("PSO-1")).toBe(false);
    expect(consumeBuyNowSuccessFlagFor("PSO-2")).toBe(true);
  });

  it("markBuyNowOrderSubmitted never throws even if sessionStorage.setItem itself throws (e.g. a privacy-mode/embedding restriction)", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(() => markBuyNowOrderSubmitted("PSO-1")).not.toThrow();
    spy.mockRestore();
  });

  it("consumeBuyNowSuccessFlagFor returns false (never throws) if sessionStorage.getItem itself throws", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(() => consumeBuyNowSuccessFlagFor("PSO-1")).not.toThrow();
    expect(consumeBuyNowSuccessFlagFor("PSO-1")).toBe(false);
    spy.mockRestore();
  });

  it("getItem succeeds and matches, but removeItem itself throws: consumeBuyNowSuccessFlagFor returns false (never true) and never throws -- a confirmation must never be shown for a removal that didn't actually happen", () => {
    markBuyNowOrderSubmitted("PSO-1");
    const spy = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });

    expect(() => consumeBuyNowSuccessFlagFor("PSO-1")).not.toThrow();
    expect(consumeBuyNowSuccessFlagFor("PSO-1")).toBe(false);

    spy.mockRestore();
    // The mocked removeItem never actually deleted the real value -- it is
    // still sitting in storage exactly as markBuyNowOrderSubmitted left it,
    // available to a later attempt once storage access recovers.
    expect(sessionStorage.getItem(BUY_NOW_SUCCESS_STORAGE_KEY)).toBe("PSO-1");
  });

  it("recovers on a later attempt once storage access is no longer blocked: a removeItem failure does not permanently corrupt or lose the flag", () => {
    markBuyNowOrderSubmitted("PSO-1");
    const spy = vi.spyOn(Storage.prototype, "removeItem").mockImplementationOnce(() => {
      throw new Error("SecurityError");
    });

    expect(consumeBuyNowSuccessFlagFor("PSO-1")).toBe(false);
    spy.mockRestore();
    expect(consumeBuyNowSuccessFlagFor("PSO-1")).toBe(true);
    expect(sessionStorage.getItem(BUY_NOW_SUCCESS_STORAGE_KEY)).toBeNull();
  });
});
