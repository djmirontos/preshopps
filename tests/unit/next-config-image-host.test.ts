import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Behavioral proof (not just source-text matching -- see
 * netlify-deployment-readiness.test.ts and listing-detail.test.ts for those)
 * that next.config.ts's next/image host allowlist actually tracks
 * NEXT_PUBLIC_SUPABASE_URL at config-evaluation time, and fails closed
 * (throws, never silently widens the policy) when that env var is missing
 * or malformed. next.config.ts has no Next.js runtime dependency of its
 * own (just `import type { NextConfig }`, erased at compile time), so it
 * can be imported directly here like any other plain module.
 */
describe("next.config.ts image host allowlist", () => {
  const ORIGINAL_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    if (ORIGINAL_URL === undefined) {
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    } else {
      process.env.NEXT_PUBLIC_SUPABASE_URL = ORIGINAL_URL;
    }
    vi.resetModules();
  });

  it("allows the production hostname when NEXT_PUBLIC_SUPABASE_URL points at production", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://ylhfbqcyxjmxrbpkxtgu.supabase.co";
    const { default: nextConfig } = await import("../../next.config");
    expect(nextConfig.images?.remotePatterns).toEqual([
      { protocol: "https", hostname: "ylhfbqcyxjmxrbpkxtgu.supabase.co", pathname: "/storage/v1/object/public/**" },
    ]);
  });

  it("allows the rehearsal hostname when NEXT_PUBLIC_SUPABASE_URL points at rehearsal instead -- never both at once", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://rldccjrajfqfwskejyat.supabase.co";
    const { default: nextConfig } = await import("../../next.config");
    const patterns = nextConfig.images?.remotePatterns ?? [];
    expect(patterns).toEqual([
      { protocol: "https", hostname: "rldccjrajfqfwskejyat.supabase.co", pathname: "/storage/v1/object/public/**" },
    ]);
    expect(patterns.some((p) => "hostname" in p && p.hostname === "ylhfbqcyxjmxrbpkxtgu.supabase.co")).toBe(false);
  });

  it("never wildcards the hostname or widens the allowed path", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://rldccjrajfqfwskejyat.supabase.co";
    const { default: nextConfig } = await import("../../next.config");
    const pattern = nextConfig.images?.remotePatterns?.[0] as { hostname?: string; pathname?: string };
    expect(pattern.hostname).not.toBe("*");
    expect(pattern.hostname).not.toMatch(/\*/);
    expect(pattern.pathname).toBe("/storage/v1/object/public/**");
  });

  it("fails closed (throws) rather than silently allowing any host when NEXT_PUBLIC_SUPABASE_URL is missing", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    await expect(import("../../next.config")).rejects.toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });

  it("fails closed (throws) rather than silently allowing any host when NEXT_PUBLIC_SUPABASE_URL is blank", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "   ";
    await expect(import("../../next.config")).rejects.toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });

  it("fails closed (throws) rather than silently allowing any host when NEXT_PUBLIC_SUPABASE_URL is not a valid URL", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "not-a-valid-url";
    await expect(import("../../next.config")).rejects.toThrow();
  });
});
