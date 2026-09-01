// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

// Resolves to an empty module in Next.js's server bundle via the
// "react-server" export condition, which plain Node/Vitest doesn't set.
vi.mock("server-only", () => ({}));

vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({
    getAll: () => [],
    set: vi.fn(),
  }),
}));

import { createClient } from "@/lib/supabase/server";

describe("createClient (server)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("instantiates a Supabase client using the request cookie store", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "test-anon-key");

    const client = await createClient();

    expect(client).toBeTruthy();
    expect(client.auth).toBeDefined();
  });

  it("throws when required env vars are missing", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");

    await expect(createClient()).rejects.toThrow();
  });
});
