import { describe, expect, it } from "vitest";
import { mapAuthError } from "@/lib/auth/errors";

describe("mapAuthError", () => {
  it("maps invalid credentials to a safe message", () => {
    expect(mapAuthError(new Error("Invalid login credentials"))).toBe(
      "Email or password is incorrect.",
    );
  });

  it("maps an unconfirmed email to a safe message", () => {
    expect(mapAuthError(new Error("Email not confirmed"))).toBe(
      "Please verify your email before signing in.",
    );
  });

  it("maps an already-registered email to a safe message", () => {
    expect(mapAuthError(new Error("User already registered"))).toBe(
      "An account with that email already exists.",
    );
  });

  it("maps a too-short password to a safe message", () => {
    expect(mapAuthError(new Error("Password should be at least 6 characters"))).toBe(
      "Password must be at least 6 characters.",
    );
  });

  it("maps rate limiting to a safe message", () => {
    expect(mapAuthError(new Error("Email rate limit exceeded"))).toBe(
      "Too many attempts. Please wait a moment and try again.",
    );
  });

  it("falls back to a generic message for an unrecognized error", () => {
    expect(mapAuthError(new Error("some unmapped internal detail"))).toBe(
      "Something went wrong. Please try again.",
    );
  });

  it("never leaks the raw error object/message for an unmapped case", () => {
    const raw = "Postgrest error: relation auth.users does not exist at line 42";
    const mapped = mapAuthError(new Error(raw));
    expect(mapped).not.toContain("Postgrest");
    expect(mapped).not.toContain("relation");
    expect(mapped).not.toContain("line 42");
  });

  it("handles a non-Error value safely", () => {
    expect(mapAuthError("a plain string")).toBe("Something went wrong. Please try again.");
    expect(mapAuthError(null)).toBe("Something went wrong. Please try again.");
    expect(mapAuthError(undefined)).toBe("Something went wrong. Please try again.");
  });
});
