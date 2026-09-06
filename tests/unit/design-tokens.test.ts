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
const CANVAS = "#fafaf8";
const ACTION = "#e9782b";
const ACTION_HOVER = "#de6817";
const ACTION_TEXT = "#1a1a1a";
const LINK = "#123b6d";
const LINK_HOVER = "#0f315a";

describe("design tokens (final brand-color correction: vivid orange action + navy links)", () => {
  it("no longer defines the old red-orange primary (#e2582e) anywhere in globals.css", () => {
    expect(CSS_SOURCE.toLowerCase()).not.toContain("#e2582e");
  });

  it("no longer defines the intermediate blue primary (#1f6feb / #195fc9) anywhere in globals.css", () => {
    expect(CSS_SOURCE.toLowerCase()).not.toContain("#1f6feb");
    expect(CSS_SOURCE.toLowerCase()).not.toContain("#195fc9");
  });

  it("removes the darker burnt-orange compromise (#b95613 / #a64e11) from the primary action styling", () => {
    expect(CSS_SOURCE.toLowerCase()).not.toMatch(/:\s*#b95613/);
    expect(CSS_SOURCE.toLowerCase()).not.toMatch(/:\s*#a64e11/);
  });

  it("defines --brand-action / --brand-action-hover as the vivid Preshopps orange family", () => {
    expect(CSS_SOURCE).toMatch(/--brand-action:\s*var\(--brand-accent\)|--brand-action:\s*#e9782b/i);
    expect(CSS_SOURCE).toMatch(/--brand-action-hover:\s*#de6817/i);
  });

  it("defines --brand-action-text as dark ink, never white", () => {
    expect(CSS_SOURCE).toMatch(/--brand-action-text:\s*#1a1a1a/i);
  });

  it("defines --brand-link / --brand-link-hover as navy, for plain text-on-white", () => {
    expect(CSS_SOURCE).toMatch(/--brand-link:\s*var\(--brand-navy\)|--brand-link:\s*#123b6d/i);
    expect(CSS_SOURCE).toMatch(/--brand-link-hover:\s*#0f315a/i);
  });

  it("keeps --brand-navy and --brand-accent at their previously approved reference values", () => {
    expect(CSS_SOURCE).toMatch(/--brand-navy:\s*#123b6d/i);
    expect(CSS_SOURCE).toMatch(/--brand-accent:\s*#e9782b/i);
  });

  it("points the shared focus-ring token (--brand) at navy, not orange", () => {
    expect(CSS_SOURCE).toMatch(/--brand:\s*var\(--brand-navy\)/i);
  });

  it("keeps the semantic green (--accent / Trusted Seller) unchanged", () => {
    expect(CSS_SOURCE).toMatch(/--accent:\s*#1c6e52/i);
  });

  it("no component file references the retired bg-brand-hover/text-brand-hover classes", () => {
    expect(CSS_SOURCE).not.toMatch(/--brand-hover:/);
  });

  it("action orange + dark ink text meets WCAG AA (>=4.5:1) for a filled button", () => {
    expect(contrastRatio(ACTION, ACTION_TEXT)).toBeGreaterThanOrEqual(4.5);
  });

  it("action-hover orange + dark ink text meets WCAG AA (>=4.5:1)", () => {
    expect(contrastRatio(ACTION_HOVER, ACTION_TEXT)).toBeGreaterThanOrEqual(4.5);
  });

  it("navy link color meets WCAG AA on white and canvas", () => {
    expect(contrastRatio(LINK, WHITE)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(LINK, CANVAS)).toBeGreaterThanOrEqual(4.5);
  });

  it("navy link-hover is darker (higher contrast) than the resting link color", () => {
    expect(contrastRatio(LINK_HOVER, WHITE)).toBeGreaterThan(contrastRatio(LINK, WHITE));
  });

  it("navy focus-ring color clears the 3:1 minimum against white and canvas surfaces", () => {
    expect(contrastRatio(LINK, WHITE)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(LINK, CANVAS)).toBeGreaterThanOrEqual(3);
  });

  it("documents why raw orange text/white-text-on-orange is unsafe (why the split token architecture exists)", () => {
    expect(contrastRatio(ACTION, WHITE)).toBeLessThan(4.5);
  });
});
