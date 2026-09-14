import { describe, expect, it } from "vitest";
import { maskEmail } from "@/lib/auth/mask-email";

describe("maskEmail", () => {
  it("masks the local part to its first character, keeping the domain intact", () => {
    expect(maskEmail("daniel@gmail.com")).toBe("d***@gmail.com");
  });

  it("handles a single-character local part", () => {
    expect(maskEmail("d@gmail.com")).toBe("d***@gmail.com");
  });

  it("returns malformed input (no @) unchanged rather than guessing", () => {
    expect(maskEmail("not-an-email")).toBe("not-an-email");
  });

  it("returns input starting with @ unchanged rather than guessing", () => {
    expect(maskEmail("@gmail.com")).toBe("@gmail.com");
  });
});
