import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

function readFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf-8");
}

/** Strips //, /* *\/ comments so a "must NOT contain X" assertion can't
 * false-positive on a comment merely explaining (by name) the thing
 * being asserted absent. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const CLIENT_SOURCE = "components/seller/SellerOrderDetailClient.tsx";

describe("Seller order messaging frontend wiring: no backend/migration/RLS change in this slice", () => {
  it("only separately-approved 0094 follows 0093 -- this slice remains frontend-only", () => {
    const migrationFiles = readdirSync(path.join(process.cwd(), "supabase/migrations")).filter((f) => f.endsWith(".sql"));
    const newer = migrationFiles.filter((f) => f > "0093_seller_order_messaging.sql");
    expect(newer).toEqual([
      "0094_published_listing_editing.sql",
      "0095_restriction_visibility_notifications.sql",
      "0096_restriction_visibility_notifications.sql",
    ]);
  });

  it("0093 still adds exactly the two approved RPCs -- untouched by this frontend-only slice", () => {
    const source = readFile("supabase/migrations/0093_seller_order_messaging.sql");
    const createFunctionCount = (source.match(/create or replace function/g) ?? []).length;
    expect(createFunctionCount).toBe(2);
    expect(source).toMatch(/create or replace function public\.get_conversation_for_shop_order\(/);
    expect(source).toMatch(/create or replace function public\.start_conversation_from_order\(/);
    expect(source).not.toMatch(/create table|drop table|alter table|create policy|alter policy|drop policy|create index|drop index|alter publication/i);
  });
});

describe("SellerOrderDetailClient: no direct Supabase messaging writes -- only the two committed wrappers are used", () => {
  const source = readFile(CLIENT_SOURCE);
  const stripped = stripComments(source);

  it("never imports the Supabase client directly", () => {
    expect(stripped).not.toMatch(/from ["']@\/lib\/supabase\/client["']/);
  });

  it("never calls .rpc( directly, and never mentions start_conversation/send_message by RPC name", () => {
    expect(stripped).not.toMatch(/\.rpc\(/);
    expect(stripped).not.toMatch(/"start_conversation"|"send_message"|'start_conversation'|'send_message'/);
  });

  it("imports exactly the two committed messaging wrappers", () => {
    expect(source).toMatch(/from ["']@\/lib\/messaging\/get-conversation-for-shop-order["']/);
    expect(source).toMatch(/from ["']@\/lib\/messaging\/start-conversation-from-order["']/);
  });

  it("never imports or references a buyerId/buyer_id anywhere in this component", () => {
    expect(stripped).not.toMatch(/buyerId|buyer_id/);
  });

  it("never touches conversation_user_states or notifications directly", () => {
    expect(stripped).not.toMatch(/conversation_user_states|notifications/);
  });
});

describe("SellerOrderDetailClient: the generic /messages fallback is removed from this flow", () => {
  const source = readFile(CLIENT_SOURCE);
  const stripped = stripComments(source);

  it("never pushes to the bare /messages inbox route", () => {
    expect(stripped).not.toMatch(/router\.push\(\s*["']\/messages["']\s*\)/);
  });

  it("still supports the deep-link route shape /messages/{conversationId} for mobile, reusing the existing pattern", () => {
    expect(source).toMatch(/router\.push\(`\/messages\/\$\{conversationId\}`\)/);
  });
});

describe("SellerOrderDetailClient: reuses the existing desktop/mobile split and messaging primitives, invents nothing new", () => {
  const source = readFile(CLIENT_SOURCE);

  it("imports the existing useFloatingMessenger and isDesktopViewport -- no second viewport system, no second messenger", () => {
    expect(source).toMatch(/from ["']@\/components\/messaging\/FloatingMessengerProvider["']/);
    expect(source).toMatch(/from ["']@\/lib\/ui\/viewport["']/);
  });

  it("reuses the existing ComposeMessageDialog -- no second compose component", () => {
    expect(source).toMatch(/from ["']@\/components\/messaging\/ComposeMessageDialog["']/);
    const composeComponentDefinitions = (source.match(/function \w*Compose\w*Dialog/g) ?? []).length;
    expect(composeComponentDefinitions).toBe(0);
  });

  it("the compose dialog is titled 'Message Buyer'", () => {
    expect(source).toMatch(/title="Message Buyer"/);
  });

  it("the fulfillment modal's secondary label is 'Message Buyer', never 'Open Messages'", () => {
    expect(source).toMatch(/secondaryLabel="Message Buyer"/);
    expect(source).not.toMatch(/secondaryLabel="Open Messages"/);
  });

  it("the persistent Message Buyer action is rendered unconditionally -- not gated by allowedActions/order status", () => {
    const buttonIndex = source.indexOf('"Message Buyer"');
    expect(buttonIndex).toBeGreaterThan(-1);
    // The nearest preceding conditional-render guard is the pending-
    // cancellation block far below this button, not anything wrapping it.
    const persistentBlockStart = source.indexOf("Always available regardless of order status");
    const persistentBlockEnd = source.indexOf("hasPendingCancellationRequest &&", persistentBlockStart);
    expect(persistentBlockStart).toBeGreaterThan(-1);
    expect(persistentBlockEnd).toBeGreaterThan(persistentBlockStart);
    const persistentBlock = source.slice(persistentBlockStart, persistentBlockEnd);
    expect(persistentBlock).not.toMatch(/allowedActions\.includes/);
    expect(persistentBlock).not.toMatch(/order\.status ===/);
  });
});

describe("Buyer-side Message Seller flow is untouched by this slice", () => {
  it("ShopMessageAction.tsx is not imported by SellerOrderDetailClient.tsx", () => {
    const source = stripComments(readFile(CLIENT_SOURCE));
    expect(source).not.toMatch(/ShopMessageAction/);
  });

  it("ListingActions.tsx and the buyer-side start-conversation wrapper are not imported by SellerOrderDetailClient.tsx", () => {
    const source = stripComments(readFile(CLIENT_SOURCE));
    expect(source).not.toMatch(/ListingActions/);
    expect(source).not.toMatch(/from ["']@\/lib\/messaging\/start-conversation["']/);
  });
});
