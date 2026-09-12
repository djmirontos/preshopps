import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

function readFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf-8");
}

/**
 * Source-level coverage check for Part 3's tooltip requirement: every
 * icon-only control this task named gets <Tooltip>/<TooltipBubble>, and
 * every control this task explicitly excluded (visible text already
 * explains it) does not. Rendered/behavioral coverage of the Tooltip
 * component itself (hover/focus, desktop-only gating, aria-label
 * untouched) lives in Tooltip.test.tsx; this file is the "did we actually
 * wire it up everywhere it belongs, and nowhere it doesn't" checklist.
 */
describe("Tooltip coverage -- global header / marketplace icon-only controls", () => {
  it.each([
    ["components/ui/IconButton.tsx", "Favorites + guest Account"],
    ["components/messaging/MessagesIconLink.tsx", "Messages"],
    ["components/notifications/NotificationBellLink.tsx", "Notifications"],
    ["components/cart/CartIconLink.tsx", "Cart"],
    ["components/auth/AccountMenu.tsx", "Account (authenticated)"],
  ])("%s (%s) wraps its icon-only control with <Tooltip>", (file) => {
    const source = readFile(file);
    expect(source).toMatch(/<Tooltip label=/);
  });

  it("CategoryStrip's desktop-only left/right scroll arrows each carry a <TooltipBubble> (they're already absolutely positioned, so they use the bare bubble + their own `group` class instead of the wrapping <Tooltip>)", () => {
    const source = readFile("components/marketplace/CategoryStrip.tsx");
    expect(source).toMatch(/<TooltipBubble label="Scroll left" \/>/);
    expect(source).toMatch(/<TooltipBubble label="Scroll right" \/>/);
  });

  it("the listing card/detail favorite icon-only control wraps its button with <Tooltip>", () => {
    const source = readFile("components/marketplace/FavoriteButton.tsx");
    expect(source).toMatch(/<Tooltip label=/);
  });

  it("ListingLightbox's Close uses <Tooltip>; Previous/Next (absolutely positioned) use the bare <TooltipBubble>", () => {
    const source = readFile("components/listing/ListingLightbox.tsx");
    expect(source).toMatch(/<Tooltip label="Close">/);
    expect(source).toMatch(/<TooltipBubble label="Previous" \/>/);
    expect(source).toMatch(/<TooltipBubble label="Next" \/>/);
  });
});

describe("Tooltip coverage -- messaging icon-only controls", () => {
  it("FloatingChatPanel wraps Minimize and Close with <Tooltip>", () => {
    const source = readFile("components/messaging/FloatingChatPanel.tsx");
    expect(source).toMatch(/<Tooltip label="Minimize">/);
    expect(source).toMatch(/<Tooltip label="Close">/);
  });

  it("ConversationThread wraps Mute/Unmute, Archive/Unarchive, and Mark-unread with <Tooltip>", () => {
    const source = readFile("components/messaging/ConversationThread.tsx");
    expect(source).toMatch(/<Tooltip label=\{isMuted \? "Unmute conversation" : "Mute conversation"\}>/);
    expect(source).toMatch(/<Tooltip label=\{isArchived \? "Unarchive conversation" : "Archive conversation"\}>/);
    expect(source).toMatch(/<Tooltip label="Mark as unread">/);
    expect(source).toMatch(/<Tooltip label=\{isBlocked \?/);
  });

  it("ReportButton's icon-only variant wraps its button with <Tooltip>", () => {
    const source = readFile("components/moderation/ReportButton.tsx");
    expect(source).toMatch(/<Tooltip label="Report">/);
  });
});

describe("Tooltip coverage -- deliberately excluded controls (visible text already explains them)", () => {
  it("MobileBottomNav never uses Tooltip -- every tab already has a visible text label", () => {
    const source = readFile("components/layout/MobileBottomNav.tsx");
    expect(source).not.toMatch(/Tooltip/);
  });

  it("SellGate (the header/bottom-nav 'Sell' action) never uses Tooltip -- it always renders visible 'Sell' text", () => {
    const source = readFile("components/auth/SellGate.tsx");
    expect(source).not.toMatch(/Tooltip/);
  });

  it("AppHeader's own search input/icon is decorative, not an icon-only control -- AppHeader itself never imports Tooltip directly (each real icon control brings its own)", () => {
    const source = readFile("components/layout/AppHeader.tsx");
    expect(source).not.toMatch(/from ["']@\/components\/ui\/Tooltip["']/);
  });
});
