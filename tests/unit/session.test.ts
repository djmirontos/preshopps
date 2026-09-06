import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const getUserMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: { getUser: getUserMock } })),
}));

// Overrides the guest-default global mock from tests/setup/vitest.setup.ts
// for this file specifically -- this is the one file that needs the real
// implementation (to test it), not a stub.
vi.mock("@/lib/auth/session", async (importOriginal) => {
  return importOriginal<typeof import("@/lib/auth/session")>();
});

import { getAuthUserUncached } from "@/lib/auth/session";

describe("getAuthUserUncached", () => {
  beforeEach(() => {
    getUserMock.mockReset();
  });

  it("returns null for a guest (no user)", async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: null });
    await expect(getAuthUserUncached()).resolves.toBeNull();
  });

  it("returns null when getUser errors (never treats a failed check as authenticated)", async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: { message: "invalid token" } });
    await expect(getAuthUserUncached()).resolves.toBeNull();
  });

  it("returns the user id/email for an authenticated session", async () => {
    getUserMock.mockResolvedValue({
      data: { user: { id: "u1", email: "buyer@example.com" } },
      error: null,
    });
    await expect(getAuthUserUncached()).resolves.toEqual({ id: "u1", email: "buyer@example.com" });
  });

  it("maps a missing email to null rather than undefined", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "u1", email: null } }, error: null });
    await expect(getAuthUserUncached()).resolves.toEqual({ id: "u1", email: null });
  });

  it("uses getUser() (JWT-revalidating), not just a raw session read", () => {
    const source = readFileSync(path.join(process.cwd(), "lib/auth/session.ts"), "utf-8");
    expect(source).toContain(".auth.getUser()");
    expect(source).not.toContain(".auth.getSession()");
  });

  it("exports getAuthUser wrapped in React's cache() so it dedupes within one request", () => {
    const source = readFileSync(path.join(process.cwd(), "lib/auth/session.ts"), "utf-8");
    expect(source).toMatch(/export const getAuthUser = cache\(/);
  });
});
