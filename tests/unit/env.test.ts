import { afterEach, describe, expect, it, vi } from "vitest";
import { getAppUrl } from "@/lib/env";

describe("getAppUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns the configured app URL", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");

    expect(getAppUrl()).toBe("http://localhost:3000");
  });

  it("throws a clear error when the app URL is missing", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");

    expect(() => getAppUrl()).toThrow(
      "Missing required environment variable: NEXT_PUBLIC_APP_URL",
    );
  });
});
