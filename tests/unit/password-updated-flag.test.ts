import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  PASSWORD_UPDATED_STORAGE_KEY,
  clearPasswordJustUpdatedFlag,
  hasPasswordJustUpdatedFlag,
  markPasswordJustUpdated,
} from "@/lib/auth/password-updated-flag";

beforeEach(() => {
  sessionStorage.clear();
});

describe("password-updated-flag", () => {
  it("hasPasswordJustUpdatedFlag is false before markPasswordJustUpdated is ever called", () => {
    expect(hasPasswordJustUpdatedFlag()).toBe(false);
  });

  it("markPasswordJustUpdated sets the flag, and hasPasswordJustUpdatedFlag then reports it", () => {
    markPasswordJustUpdated();
    expect(hasPasswordJustUpdatedFlag()).toBe(true);
  });

  it("writes to sessionStorage, never localStorage", () => {
    markPasswordJustUpdated();
    expect(sessionStorage.getItem(PASSWORD_UPDATED_STORAGE_KEY)).toBe("1");
    expect(localStorage.getItem(PASSWORD_UPDATED_STORAGE_KEY)).toBeNull();
  });

  it("clearPasswordJustUpdatedFlag removes it, and hasPasswordJustUpdatedFlag then reports false", () => {
    markPasswordJustUpdated();
    clearPasswordJustUpdatedFlag();
    expect(hasPasswordJustUpdatedFlag()).toBe(false);
    expect(sessionStorage.getItem(PASSWORD_UPDATED_STORAGE_KEY)).toBeNull();
  });

  it("hasPasswordJustUpdatedFlag never treats an arbitrary/forged value as the flag -- only the exact '1' set by markPasswordJustUpdated counts", () => {
    sessionStorage.setItem(PASSWORD_UPDATED_STORAGE_KEY, "true");
    expect(hasPasswordJustUpdatedFlag()).toBe(false);

    sessionStorage.setItem(PASSWORD_UPDATED_STORAGE_KEY, "");
    expect(hasPasswordJustUpdatedFlag()).toBe(false);
  });

  it("markPasswordJustUpdated never throws even if sessionStorage.setItem itself throws (e.g. a privacy-mode/embedding restriction)", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(() => markPasswordJustUpdated()).not.toThrow();
    spy.mockRestore();
  });

  it("hasPasswordJustUpdatedFlag returns false (never throws) if sessionStorage.getItem itself throws", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(() => hasPasswordJustUpdatedFlag()).not.toThrow();
    expect(hasPasswordJustUpdatedFlag()).toBe(false);
    spy.mockRestore();
  });

  it("clearPasswordJustUpdatedFlag never throws even if sessionStorage.removeItem itself throws", () => {
    const spy = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(() => clearPasswordJustUpdatedFlag()).not.toThrow();
    spy.mockRestore();
  });

  it("calling hasPasswordJustUpdatedFlag repeatedly without clearing never consumes/changes the flag on its own -- only clearPasswordJustUpdatedFlag does", () => {
    markPasswordJustUpdated();
    expect(hasPasswordJustUpdatedFlag()).toBe(true);
    expect(hasPasswordJustUpdatedFlag()).toBe(true);
    expect(hasPasswordJustUpdatedFlag()).toBe(true);
  });
});
