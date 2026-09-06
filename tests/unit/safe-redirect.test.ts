import { describe, expect, it } from "vitest";
import { getSafeNextPath } from "@/lib/auth/safe-redirect";

describe("getSafeNextPath", () => {
  it("accepts a safe internal relative path", () => {
    expect(getSafeNextPath("/item/PSO-ABC123")).toBe("/item/PSO-ABC123");
  });

  it("accepts a safe internal path with query params", () => {
    expect(getSafeNextPath("/search?type=preloved")).toBe("/search?type=preloved");
  });

  it("rejects an external absolute URL", () => {
    expect(getSafeNextPath("https://evil.com")).toBe("/");
  });

  it("rejects a protocol-relative URL", () => {
    expect(getSafeNextPath("//evil.com")).toBe("/");
  });

  it("rejects a javascript: URL", () => {
    expect(getSafeNextPath("javascript:alert(1)")).toBe("/");
  });

  it("rejects a data: URL", () => {
    expect(getSafeNextPath("data:text/html,<script>alert(1)</script>")).toBe("/");
  });

  it("rejects a value containing a backslash (browser-normalization trick)", () => {
    expect(getSafeNextPath("/\\evil.com")).toBe("/");
  });

  it("rejects a value with embedded whitespace", () => {
    expect(getSafeNextPath("/foo bar")).toBe("/");
  });

  it("falls back to / for null, undefined, or empty input", () => {
    expect(getSafeNextPath(null)).toBe("/");
    expect(getSafeNextPath(undefined)).toBe("/");
    expect(getSafeNextPath("")).toBe("/");
    expect(getSafeNextPath("   ")).toBe("/");
  });

  it("rejects a bare relative path with no leading slash", () => {
    expect(getSafeNextPath("item/PSO-ABC123")).toBe("/");
  });
});
