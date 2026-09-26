import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

function readFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf-8");
}

/** Strips comments before a call-count assertion, so a doc comment that
 * merely mentions a call by name (e.g. explaining when it fires) can never
 * pad the count -- and, symmetrically, can never mask a real call that was
 * actually removed while a comment mentioning it was left behind. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
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

  it("configured with the approved placement, no visible close button, and semantic (rich) colors enabled", () => {
    const source = readFile("app/layout.tsx");
    const toasterTag = source.match(/<Toaster[^/]*\/>/)?.[0] ?? "";
    expect(toasterTag).toMatch(/position=["']top-center["']/);
    expect(toasterTag).toMatch(/closeButton=\{false\}/);
    expect(toasterTag).toMatch(/\brichColors\b/);
  });

  it("no unrelated second aria-live region was added around the toaster", () => {
    const source = readFile("app/layout.tsx");
    expect(source).not.toMatch(/aria-live/);
  });
});

describe("Shared toast wrapper -- exposes only the currently-required API", () => {
  it("lib/notifications/toast.ts exposes exactly notifySuccess and notifyError, nothing else exported", () => {
    const source = readFile("lib/notifications/toast.ts");
    const exportedNames = [...source.matchAll(/^export (?:function|const) (\w+)/gm)].map((m) => m[1]);
    expect(exportedNames).toEqual(["notifySuccess", "notifyError"]);
  });

  it("notifySuccess calls Sonner's success variant with a 4000ms duration", () => {
    const source = readFile("lib/notifications/toast.ts");
    expect(source).toMatch(/toast\.success\(/);
    expect(source).toMatch(/duration:\s*4000/);
  });

  // notifyError was added deliberately for the Share/Copy Link slice
  // (components/listing/ShareActions.tsx), which needs to report a
  // genuine clipboard/share failure truthfully rather than silently
  // saying nothing or misusing notifySuccess -- this is the one
  // additional variant this foundation now exposes on purpose.
  it("notifyError calls Sonner's error variant with the same 4000ms duration convention as notifySuccess", () => {
    const source = readFile("lib/notifications/toast.ts");
    expect(source).toMatch(/toast\.error\(/);
    expect(source.match(/duration:\s*4000/g) ?? []).toHaveLength(2);
  });

  it("no unused warning/info/promise/custom variant or action button was introduced", () => {
    const source = readFile("lib/notifications/toast.ts");
    expect(source).not.toMatch(/toast\.(warning|info|promise|custom)\(/);
    expect(source).not.toMatch(/\baction:\s*\{/);
  });
});

describe("ShopForm integration -- notification wired into both the create and existing-shop update paths", () => {
  it("ShopForm imports notifySuccess from the shared wrapper", () => {
    const source = readFile("components/seller/ShopForm.tsx");
    expect(source).toMatch(/import \{ notifySuccess \} from ["']@\/lib\/notifications\/toast["']/);
  });

  it("notifySuccess is called exactly twice in the source -- once in the create-mode branch, once in the edit-mode branch -- never inside a useEffect", () => {
    const source = stripComments(readFile("components/seller/ShopForm.tsx"));
    const callCount = (source.match(/notifySuccess\(/g) ?? []).length;
    expect(callCount).toBe(2);
    expect(source).toMatch(/notifySuccess\("Shop created"\)/);
    expect(source).toMatch(/notifySuccess\("Shop updated"\)/);
    expect(source).not.toMatch(/useEffect\([^)]*notifySuccess/);
  });
});
