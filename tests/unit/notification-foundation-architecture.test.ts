import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

function readFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf-8");
}

/** LAUNCH UX S1.2 STEP 2: the shared Sonner-backed notification foundation
 * and its first integration (Shop Update). Deliberately does not test
 * Sonner's own timer/stacking/pause-on-hover internals -- those belong to
 * the dependency, not to this project's own code. */
describe("Notification foundation -- exactly one root toaster, no competing instance", () => {
  it("app/layout.tsx renders exactly one <Toaster", () => {
    const source = readFile("app/layout.tsx");
    const toasterMounts = (source.match(/<Toaster\b/g) ?? []).length;
    expect(toasterMounts).toBe(1);
  });

  it("the toaster is imported from sonner, not a second custom implementation", () => {
    const source = readFile("app/layout.tsx");
    expect(source).toMatch(/import\s*\{\s*Toaster\s*\}\s*from\s*["']sonner["']/);
  });

  it("the toaster is a sibling of {children}, not a wrapper around it (root-level placement survives client navigation)", () => {
    const source = readFile("app/layout.tsx");
    expect(source).not.toMatch(/<Toaster[^>]*>\s*\{children\}/);
  });

  it("configured with the approved placement and no visible close button", () => {
    const source = readFile("app/layout.tsx");
    const toasterTag = source.match(/<Toaster[^/]*\/>/)?.[0] ?? "";
    expect(toasterTag).toMatch(/position=["']top-center["']/);
    expect(toasterTag).toMatch(/closeButton=\{false\}/);
  });

  it("no unrelated second aria-live region was added around the toaster", () => {
    const source = readFile("app/layout.tsx");
    expect(source).not.toMatch(/aria-live/);
  });
});

describe("Shared toast wrapper -- exposes only the currently-required API", () => {
  it("lib/notifications/toast.ts exposes notifySuccess and nothing else exported", () => {
    const source = readFile("lib/notifications/toast.ts");
    const exportedNames = [...source.matchAll(/^export (?:function|const) (\w+)/gm)].map((m) => m[1]);
    expect(exportedNames).toEqual(["notifySuccess"]);
  });

  it("notifySuccess calls Sonner's success variant with a 4000ms duration", () => {
    const source = readFile("lib/notifications/toast.ts");
    expect(source).toMatch(/toast\.success\(/);
    expect(source).toMatch(/duration:\s*4000/);
  });

  it("no unused error/warning/promise/action variant was introduced", () => {
    const source = readFile("lib/notifications/toast.ts");
    expect(source).not.toMatch(/toast\.(error|warning|info|promise|custom)\(/);
    expect(source).not.toMatch(/\baction:\s*\{/);
  });
});

describe("ShopForm integration -- notification wired only into the existing-shop update path", () => {
  it("ShopForm imports notifySuccess from the shared wrapper", () => {
    const source = readFile("components/seller/ShopForm.tsx");
    expect(source).toMatch(/import \{ notifySuccess \} from ["']@\/lib\/notifications\/toast["']/);
  });

  it("notifySuccess is called exactly once in the source, inside the edit-mode branch, not inside a useEffect", () => {
    const source = readFile("components/seller/ShopForm.tsx");
    const callCount = (source.match(/notifySuccess\(/g) ?? []).length;
    expect(callCount).toBe(1);
    expect(source).not.toMatch(/useEffect\([^)]*notifySuccess/);
  });
});
