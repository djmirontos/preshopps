import { describe, expect, it } from "vitest";
import { slugify } from "@/lib/seller/slugify";

describe("slugify", () => {
  it("lowercases and hyphenates a normal shop name", () => {
    expect(slugify("Anne's Closet")).toBe("anne-s-closet");
  });

  it("collapses multiple non-alphanumeric characters into a single hyphen", () => {
    expect(slugify("Anne's   Closet!!  Shop")).toBe("anne-s-closet-shop");
  });

  it("trims leading/trailing hyphens", () => {
    expect(slugify("--Anne's Closet--")).toBe("anne-s-closet");
  });

  it("produces an empty string for a name with no alphanumeric characters", () => {
    expect(slugify("!!!")).toBe("");
  });

  it("leaves an already-valid slug unchanged", () => {
    expect(slugify("annes-closet-2")).toBe("annes-closet-2");
  });
});
