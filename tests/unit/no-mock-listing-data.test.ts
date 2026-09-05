import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

describe("homepage data path", () => {
  it("no longer ships mock listing inventory", () => {
    expect(existsSync(path.join(process.cwd(), "lib/mock-data.ts"))).toBe(false);
  });

  it("fetches listings only through the browse_listings RPC, never a raw table query", () => {
    const source = readFileSync(
      path.join(process.cwd(), "lib/marketplace/browse-listings.ts"),
      "utf-8",
    );
    expect(source).toContain('rpc("browse_listings"');
    expect(source).not.toMatch(/\.from\(\s*["']listings["']\s*\)/);
  });

  it("app/page.tsx no longer imports mock listing data", () => {
    const source = readFileSync(path.join(process.cwd(), "app/page.tsx"), "utf-8");
    expect(source).not.toMatch(/mock-data/i);
    expect(source).not.toMatch(/MOCK_FRESH_FINDS|MOCK_PRE_LOVED|MOCK_BRAND_NEW/);
  });
});
