import { afterEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@/lib/supabase/client";

describe("createClient (browser)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("instantiates a Supabase client from valid env vars", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "test-anon-key");

    const client = createClient();

    expect(client).toBeTruthy();
    expect(client.auth).toBeDefined();
    expect(typeof client.from).toBe("function");
  });

  it("throws when required env vars are missing", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");

    expect(() => createClient()).toThrow();
  });
});
