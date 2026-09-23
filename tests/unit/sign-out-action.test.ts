import { beforeEach, describe, expect, it, vi } from "vitest";

// tests/setup/vitest.setup.ts globally mocks @/lib/auth/actions for every
// unrelated test that transitively renders AccountMenu/the Account page.
// This file exists specifically to test the real implementation, so it
// must undo that mock -- vi.unmock is hoisted the same way vi.mock is, so
// this takes effect before the import below resolves.
vi.unmock("@/lib/auth/actions");

const { signOutMock, createClientMock, redirectMock } = vi.hoisted(() => ({
  signOutMock: vi.fn(),
  createClientMock: vi.fn(),
  redirectMock: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: createClientMock,
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

createClientMock.mockResolvedValue({ auth: { signOut: signOutMock } });

import { signOutAction } from "@/lib/auth/actions";
import { SIGN_OUT_ERROR_MESSAGE } from "@/lib/auth/sign-out-state";

beforeEach(() => {
  vi.clearAllMocks();
  createClientMock.mockResolvedValue({ auth: { signOut: signOutMock } });
});

describe("signOutAction", () => {
  it("calls supabase.auth.signOut() with no scope option -- session-only, unlike Change Password's own global sign-out", async () => {
    signOutMock.mockResolvedValue({ error: null });

    await expect(signOutAction({ error: null }, new FormData())).rejects.toThrow("NEXT_REDIRECT:/?signedOut=1");

    expect(signOutMock).toHaveBeenCalledWith();
  });

  it("redirects to the homepage carrying the one-time signedOut marker on success", async () => {
    signOutMock.mockResolvedValue({ error: null });

    await expect(signOutAction({ error: null }, new FormData())).rejects.toThrow("NEXT_REDIRECT:/?signedOut=1");

    expect(redirectMock).toHaveBeenCalledWith("/?signedOut=1");
  });

  it("returns a useful error and never redirects when sign-out itself fails", async () => {
    signOutMock.mockResolvedValue({ error: { message: "network error" } });

    const result = await signOutAction({ error: null }, new FormData());

    expect(result).toEqual({ error: SIGN_OUT_ERROR_MESSAGE });
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("logs the underlying error message on failure without exposing it to the caller", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    signOutMock.mockResolvedValue({ error: { message: "network error" } });

    const result = await signOutAction({ error: null }, new FormData());

    expect(result.error).not.toContain("network error");
    expect(consoleErrorSpy).toHaveBeenCalledWith("signOutAction: sign out failed:", "network error");
    consoleErrorSpy.mockRestore();
  });
});
