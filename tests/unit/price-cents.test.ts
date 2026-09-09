import { describe, expect, it } from "vitest";
import { parsePesosToCents } from "@/lib/seller/price-cents";

describe("parsePesosToCents", () => {
  it("treats blank input as a valid null price (Draft may omit price)", () => {
    expect(parsePesosToCents("")).toEqual({ ok: true, cents: null });
    expect(parsePesosToCents("   ")).toEqual({ ok: true, cents: null });
  });

  it("accepts ₱0 as a valid price", () => {
    expect(parsePesosToCents("0")).toEqual({ ok: true, cents: 0 });
  });

  it("converts a whole-peso amount to cents", () => {
    expect(parsePesosToCents("100")).toEqual({ ok: true, cents: 10000 });
  });

  it("converts a two-decimal amount without floating-point drift", () => {
    // 19.99 * 100 === 1998.9999999999998 via naive floating-point math --
    // this must come out exactly 1999.
    expect(parsePesosToCents("19.99")).toEqual({ ok: true, cents: 1999 });
  });

  it("pads a single decimal digit to full centavos", () => {
    expect(parsePesosToCents("5.5")).toEqual({ ok: true, cents: 550 });
  });

  it("rejects a negative amount", () => {
    expect(parsePesosToCents("-5")).toEqual({ ok: false });
  });

  it("rejects more than two decimal places", () => {
    expect(parsePesosToCents("5.999")).toEqual({ ok: false });
  });

  it("rejects non-numeric input", () => {
    expect(parsePesosToCents("abc")).toEqual({ ok: false });
  });

  it("trims surrounding whitespace before parsing", () => {
    expect(parsePesosToCents("  25.50  ")).toEqual({ ok: true, cents: 2550 });
  });
});
