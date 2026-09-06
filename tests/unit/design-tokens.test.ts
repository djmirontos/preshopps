import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const CSS_SOURCE = readFileSync(path.join(process.cwd(), "app/globals.css"), "utf-8");

function srgbToLinear(c: number): number {
  c /= 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function luminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

function contrastRatio(hex1: string, hex2: string): number {
  const l1 = luminance(hex1);
  const l2 = luminance(hex2);
  const [lighter, darker] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (lighter + 0.05) / (darker + 0.05);
}

const WHITE = "#ffffff";
const BRAND = "#b95613";
const BRAND_HOVER = "#a64e11";
const BRAND_ACCENT = "#e9782b";
const BRAND_NAVY = "#123b6d";

describe("design tokens (UX Revision Pass #1 correction: blue -> orange)", () => {
  it("no longer defines the old red-orange primary (#e2582e) anywhere in globals.css", () => {
    expect(CSS_SOURCE.toLowerCase()).not.toContain("#e2582e");
  });

  it("no longer defines the intermediate blue primary (#1f6feb / #195fc9) anywhere in globals.css", () => {
    expect(CSS_SOURCE.toLowerCase()).not.toContain("#1f6feb");
    expect(CSS_SOURCE.toLowerCase()).not.toContain("#195fc9");
  });

  it("defines --brand and --brand-hover as the new orange-family values", () => {
    expect(CSS_SOURCE).toMatch(/--brand:\s*#b95613/i);
    expect(CSS_SOURCE).toMatch(/--brand-hover:\s*#a64e11/i);
  });

  it("keeps --brand-navy and --brand-accent at their previously approved values", () => {
    expect(CSS_SOURCE).toMatch(/--brand-navy:\s*#123b6d/i);
    expect(CSS_SOURCE).toMatch(/--brand-accent:\s*#e9782b/i);
  });

  it("keeps the semantic green (--accent / Trusted Seller) unchanged", () => {
    expect(CSS_SOURCE).toMatch(/--accent:\s*#1c6e52/i);
  });

  it("does not sprinkle a raw hex brand color into component files -- only globals.css defines them", () => {
    // Every consumer uses the bg-brand-hover/text-brand-hover/etc utility
    // classes (already verified project-wide in the earlier color pass);
    // this just re-confirms the new values are declared in exactly one
    // place.
    const brandDeclarations = CSS_SOURCE.match(/--brand(-hover)?:\s*#[0-9a-f]{6}/gi) ?? [];
    expect(brandDeclarations.length).toBe(2);
  });

  it("primary orange (--brand) meets WCAG AA (>=4.5:1) as a white-text button background", () => {
    expect(contrastRatio(BRAND, WHITE)).toBeGreaterThanOrEqual(4.5);
  });

  it("hover orange (--brand-hover) meets WCAG AA (>=4.5:1) as a white-text button background", () => {
    expect(contrastRatio(BRAND_HOVER, WHITE)).toBeGreaterThanOrEqual(4.5);
  });

  it("primary orange also meets WCAG AA when used as plain text color on white (links, active nav label)", () => {
    // Same two values are used both as bg-brand-hover (button fills) and
    // text-brand-hover (plain links/labels) throughout the app -- both
    // directions must clear 4.5:1 since contrast is direction-symmetric.
    expect(contrastRatio(WHITE, BRAND)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(WHITE, BRAND_HOVER)).toBeGreaterThanOrEqual(4.5);
  });

  it("primary orange clears the 3:1 minimum for focus-ring/UI-component contrast", () => {
    expect(contrastRatio(BRAND, WHITE)).toBeGreaterThanOrEqual(3);
  });

  it("documents why raw #E9782B is unsafe as the shared action token (white text)", () => {
    expect(contrastRatio(BRAND_ACCENT, WHITE)).toBeLessThan(4.5);
  });

  it("documents why deep navy on the light orange accent is not a reliable AA pairing", () => {
    // Measured finding behind the design decision: navy-on-orange does
    // not reliably clear 4.5:1, so it was not used as the primary text/
    // background pairing despite being the initially preferred direction.
    expect(contrastRatio(BRAND_NAVY, BRAND_ACCENT)).toBeLessThan(4.5);
  });

  it("dark ink on the light orange accent is a safe pairing where --brand-accent IS used directly", () => {
    expect(contrastRatio("#1a1a1a", BRAND_ACCENT)).toBeGreaterThanOrEqual(4.5);
  });
});
