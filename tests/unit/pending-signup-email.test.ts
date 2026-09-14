import { beforeEach, describe, expect, it } from "vitest";
import { setPendingSignupEmail, getPendingSignupEmail, clearPendingSignupEmail } from "@/lib/auth/pending-signup-email";

beforeEach(() => {
  sessionStorage.clear();
});

describe("pending-signup-email", () => {
  it("returns null when nothing has been stored", () => {
    expect(getPendingSignupEmail()).toBeNull();
  });

  it("stores and retrieves the email", () => {
    setPendingSignupEmail("new@example.com");
    expect(getPendingSignupEmail()).toBe("new@example.com");
  });

  it("clears the stored email", () => {
    setPendingSignupEmail("new@example.com");
    clearPendingSignupEmail();
    expect(getPendingSignupEmail()).toBeNull();
  });

  it("only ever stores the email string -- never an object, password, or code", () => {
    setPendingSignupEmail("new@example.com");
    // sessionStorage can only ever hold what this module explicitly wrote --
    // confirm there's exactly one key and it's the exact email string, not
    // JSON containing other fields.
    expect(sessionStorage.length).toBe(1);
    const key = sessionStorage.key(0) as string;
    expect(sessionStorage.getItem(key)).toBe("new@example.com");
  });
});
