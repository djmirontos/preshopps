import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

function readFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf-8");
}

/** Strips // line comments and /* block comments *\/ so a static
 * assertion about actual code can't false-positive on a comment's own
 * prose discussing (by name) the exact pattern being asserted against. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

/**
 * P1 fix: the mobile `/messages/[conversationId]` screen is now a fixed,
 * bounded chat panel (ConversationDetailClient) instead of relying on the
 * whole page scrolling, and the site Footer is excluded there below `lg`
 * (ConditionalFooter). This file is the source-level "did we wire it up
 * correctly, and did we leave everything else alone" checklist --
 * behavioral coverage (scroll-to-latest, near-bottom follow, header/
 * composer staying put, desktop Enter-to-send, etc.) lives in
 * ConversationDetailClient.test.tsx and ConversationThread-scroll.test.tsx.
 */
describe("Mobile conversation layout -- root layout wiring", () => {
  it("renders ConditionalFooter, not the raw Footer, so the exclusion only this task approved is actually reachable", () => {
    const source = readFile("app/layout.tsx");
    expect(source).toMatch(/from ["']@\/components\/layout\/ConditionalFooter["']/);
    expect(source).toMatch(/<ConditionalFooter\s*\/>/);
    expect(source).not.toMatch(/from ["']@\/components\/layout\/Footer["']/);
  });

  it("still renders MobileBottomNav -- the mobile bottom nav remains present, untouched by this fix", () => {
    const source = readFile("app/layout.tsx");
    expect(source).toMatch(/<MobileBottomNav\b/);
  });

  it("still renders FloatingMessengerProvider and FloatingChatPanel -- the desktop floating messenger is untouched by this fix", () => {
    const source = readFile("app/layout.tsx");
    expect(source).toMatch(/<FloatingMessengerProvider>/);
    expect(source).toMatch(/<FloatingChatPanel\b/);
  });
});

describe("Mobile conversation layout -- footer exclusion is route- and breakpoint-scoped, never global", () => {
  it("ConditionalFooter still renders <Footer /> unconditionally in the DOM (never conditionally unmounted) -- only a CSS wrapper differs on the one affected route", () => {
    const source = stripComments(readFile("components/layout/ConditionalFooter.tsx"));
    const footerRenderCount = (source.match(/<Footer\s*\/>/g) ?? []).length;
    expect(footerRenderCount).toBe(2); // the ordinary-route branch and the wrapped branch
  });

  it("only matches the conversation-DETAIL route, never the messages list route or a deeper path", () => {
    const source = readFile("components/layout/ConditionalFooter.tsx");
    const match = source.match(/const MOBILE_FULLSCREEN_CHAT_ROUTE = (\/[^\n]+\/);/);
    expect(match).not.toBeNull();
    const pattern = new RegExp(match![1].slice(1, -1));
    expect(pattern.test("/messages/conv-123")).toBe(true);
    expect(pattern.test("/messages")).toBe(false);
    expect(pattern.test("/messages/conv-123/extra")).toBe(false);
  });

  it("the mobile-only exclusion is expressed as a CSS class (hidden lg:block), not a JS viewport check -- no hydration-mismatch risk", () => {
    const source = readFile("components/layout/ConditionalFooter.tsx");
    expect(source).toMatch(/hidden lg:block/);
    // Checked against actual code only -- this file's own comment
    // explains (by name) why a viewport check was deliberately NOT used,
    // which would otherwise false-positive a naive "must not mention X" scan.
    expect(stripComments(source)).not.toMatch(/isDesktopViewport|window\.innerWidth/);
  });
});

describe("Mobile conversation layout -- desktop (lg+) is provably unchanged", () => {
  it("ConversationDetailClient's desktop override restores the exact original height calc used before this fix", () => {
    const source = readFile("components/messaging/ConversationDetailClient.tsx");
    expect(source).toMatch(/lg:static/);
    expect(source).toMatch(/lg:h-\[calc\(100vh-120px\)\]/);
  });

  it("the mobile fixed-panel classes are unprefixed (apply as the base/mobile styles), never gated behind a desktop breakpoint themselves", () => {
    const source = readFile("components/messaging/ConversationDetailClient.tsx");
    expect(source).toMatch(/className="fixed inset-x-0 top-\[132px\]/);
  });

  it("ConversationThread's own Realtime subscription, dedupe helper, and scroll effects are untouched by this task -- same file, same logic, only its parent's outer positioning changed", () => {
    const source = readFile("components/messaging/ConversationThread.tsx");
    expect(source).toMatch(/\.channel\(`messages:/);
    expect(source).toMatch(/appendMessageIfNew/);
    expect(source).toMatch(/NEAR_BOTTOM_THRESHOLD_PX/);
    expect(source).toMatch(/scrollMessagesToBottom/);
  });

  it("FloatingChatPanel's own desktop bottom-right positioning is unaffected by this (mobile-only) layout fix -- its internal state shape has since legitimately evolved in a later, separately-approved messaging-center task, but the fixed bottom-6/right-6 anchor from this task's own era is unchanged", () => {
    const panelSource = readFile("components/messaging/FloatingChatPanel.tsx");
    expect(panelSource).toMatch(/fixed bottom-6 right-6/);
    const providerSource = readFile("components/messaging/FloatingMessengerProvider.tsx");
    expect(providerSource).toMatch(/selectedConversationId/);
  });
});

describe("Mobile conversation layout -- no backend/RLS/RPC/migration changes", () => {
  it("no slice file references a service-role key or a new RPC name", () => {
    for (const file of ["components/messaging/ConversationDetailClient.tsx", "components/layout/ConditionalFooter.tsx", "app/layout.tsx"]) {
      const source = readFile(file);
      expect(source.toLowerCase()).not.toContain("service_role");
      expect(source.toLowerCase()).not.toContain("service-role");
      expect(source).not.toMatch(/\.rpc\(/);
    }
  });
});
