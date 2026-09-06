import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

// vitest.config.mts does not enable `test.globals`, so @testing-library/react's
// own auto-cleanup (which hooks into a global afterEach) never registers.
// Without this, multiple render() calls across `it` blocks in one file
// accumulate in the DOM instead of resetting between tests.
afterEach(() => {
  cleanup();
});

// FavoriteButton (rendered via ListingCard across many already-existing
// test files that have nothing to do with auth) uses this client-side
// hook, which otherwise calls the real browser Supabase client and
// throws in the test environment (no NEXT_PUBLIC_SUPABASE_* env vars).
// Defaults every test to the guest case; a test that specifically needs
// the authenticated case can override this with its own vi.mock of the
// same module, which takes precedence over this setup-file mock.
vi.mock("@/lib/auth/use-is-authenticated", () => ({
  useIsAuthenticated: () => false,
}));

// Many pre-existing, auth-unrelated page/component tests now transitively
// import lib/auth/session.ts (getAuthUser) and lib/auth/actions.ts
// (signOutAction, a "use server" action) simply by rendering AppHeader or
// a page that resolves the current user. Both ultimately import the real
// lib/supabase/server.ts, which throws outside Next's build pipeline (see
// the server-only package). Defaulting to "guest" here matches every
// existing test's original assumption; a test that specifically covers
// authenticated behavior overrides this with its own vi.mock of the same
// module, which takes precedence over this setup-file mock.
vi.mock("@/lib/auth/session", () => ({
  getAuthUser: vi.fn(async () => null),
}));

vi.mock("@/lib/auth/actions", () => ({
  signOutAction: vi.fn(async () => {}),
}));
