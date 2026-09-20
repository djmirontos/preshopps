import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

function readFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf-8");
}

/**
 * Static source proof of the server/browser boundary fix: a Server
 * Component that calls getPublishedListingEditState through the browser
 * Supabase client silently carries no session during SSR (executes as
 * `anon`), which is what produced "permission denied for function
 * get_published_listing_edit_state" despite `authenticated` already
 * holding EXECUTE. These assertions read the actual import lines rather
 * than exercising behavior, so a future edit that reintroduces the wrong
 * import is caught here even before any RPC-level test would notice.
 */
describe("published-listing-edit-state server/browser boundary", () => {
  it("the server-safe loader imports the cookie-aware server client, never the browser client", () => {
    const source = readFile("lib/seller/get-published-listing-edit-state.ts");
    expect(source).toMatch(/import\s*\{\s*createClient\s*\}\s*from\s*"@\/lib\/supabase\/server"/);
    expect(source).not.toMatch(/from\s*"@\/lib\/supabase\/client"/);
  });

  it("the browser wrapper module still imports the browser client, never the server client", () => {
    const source = readFile("lib/seller/published-listing-actions.ts");
    expect(source).toMatch(/import\s*\{\s*createClient\s*\}\s*from\s*"@\/lib\/supabase\/client"/);
    expect(source).not.toMatch(/from\s*"@\/lib\/supabase\/server"/);
  });

  it("app/sell/[listingId]/edit/page.tsx (the Server Component) imports getPublishedListingEditState from the server-safe loader, not the browser wrapper", () => {
    const source = readFile("app/sell/[listingId]/edit/page.tsx");
    expect(source).toMatch(/import\s*\{\s*getPublishedListingEditState\s*\}\s*from\s*"@\/lib\/seller\/get-published-listing-edit-state"/);
    // The page still imports OTHER things from published-listing-actions.ts
    // indirectly via PublishedListingEditor (a client component), but must
    // never import getPublishedListingEditState from it directly itself.
    expect(source).not.toMatch(/getPublishedListingEditState\s*\}\s*from\s*"@\/lib\/seller\/published-listing-actions"/);
  });

  it("PublishedListingEditor (a client component) still uses the browser wrapper for both Reload latest and Save", () => {
    const source = readFile("components/seller/PublishedListingEditor.tsx");
    expect(source).toMatch(/import\s*\{[^}]*getPublishedListingEditState[^}]*\}\s*from\s*"@\/lib\/seller\/published-listing-actions"/);
    expect(source).toMatch(/import\s*\{[^}]*updatePublishedListing[^}]*\}\s*from\s*"@\/lib\/seller\/published-listing-actions"/);
    // Never imports the server-only loader -- that module transitively
    // pulls in "server-only" (via lib/supabase/server.ts) and would throw
    // ("cannot be imported from a Client Component") if it ever did.
    expect(source).not.toMatch(/get-published-listing-edit-state/);
  });

  it("updatePublishedListing has no server-side counterpart -- every save still originates from the browser", () => {
    const serverLoaderSource = readFile("lib/seller/get-published-listing-edit-state.ts");
    expect(serverLoaderSource).not.toMatch(/updatePublishedListing|update_published_listing/);
  });

  it("both the server-safe loader and the browser wrapper delegate to the exact same shared response mapper -- their result/error mapping cannot silently diverge", () => {
    const serverLoaderSource = readFile("lib/seller/get-published-listing-edit-state.ts");
    const browserWrapperSource = readFile("lib/seller/published-listing-actions.ts");
    expect(serverLoaderSource).toMatch(/mapGetPublishedListingEditStateResponse/);
    expect(browserWrapperSource).toMatch(/mapGetPublishedListingEditStateResponse/);
    expect(serverLoaderSource).toMatch(/from\s*"@\/lib\/seller\/published-listing-edit-state"/);
    expect(browserWrapperSource).toMatch(/from\s*"@\/lib\/seller\/published-listing-edit-state"/);
  });

  it("the shared mapper module itself imports neither Supabase client -- it stays a pure, boundary-free module", () => {
    const source = readFile("lib/seller/published-listing-edit-state.ts");
    expect(source).not.toMatch(/from\s*"@\/lib\/supabase\/(client|server)"/);
  });

  it("the pure selectInteractionBlockedPresentation module imports neither Supabase client, nor either interpreter", () => {
    const source = readFile("lib/moderation/select-interaction-blocked-presentation.ts");
    expect(source).not.toMatch(/from\s*"@\/lib\/supabase\/(client|server)"/);
    expect(source).not.toMatch(/interpret-interaction-blocked/);
  });

  it("the server-safe loader imports the server interpreter (interpretInteractionBlockedServer), never the browser interpreter", () => {
    const source = readFile("lib/seller/get-published-listing-edit-state.ts");
    expect(source).toMatch(/import\s*\{\s*interpretInteractionBlockedServer\s*\}\s*from\s*"@\/lib\/moderation\/interpret-interaction-blocked-server"/);
    expect(source).not.toMatch(/from\s*"@\/lib\/moderation\/interpret-interaction-blocked"/);
  });

  it("the browser wrapper module imports the browser interpreter (interpretInteractionBlocked), never the server interpreter", () => {
    const source = readFile("lib/seller/published-listing-actions.ts");
    expect(source).toMatch(/import\s*\{\s*interpretInteractionBlocked\s*,/);
    expect(source).toMatch(/from\s*"@\/lib\/moderation\/interpret-interaction-blocked"/);
    expect(source).not.toMatch(/interpret-interaction-blocked-server/);
  });

  it("the server interpreter module imports the server-safe restriction lookup (getMyActiveRestrictions), never the browser client", () => {
    const source = readFile("lib/moderation/interpret-interaction-blocked-server.ts");
    expect(source).toMatch(/import\s*\{\s*getMyActiveRestrictions\s*\}\s*from\s*"@\/lib\/moderation\/get-my-active-restrictions"/);
    expect(source).not.toMatch(/from\s*"@\/lib\/supabase\/(client|server)"/);
    expect(source).not.toMatch(/get-my-active-restrictions-client/);
  });

  it("the browser interpreter module still imports the browser restriction lookup (getMyActiveRestrictionsClient), never the server function of the same family", () => {
    const source = readFile("lib/moderation/interpret-interaction-blocked.ts");
    expect(source).toMatch(/import\s*\{\s*getMyActiveRestrictionsClient\s*\}\s*from\s*"@\/lib\/moderation\/get-my-active-restrictions-client"/);
    expect(source).not.toMatch(/from\s*"@\/lib\/supabase\/(client|server)"/);
    // A type-only import of RestrictionType from the server-safe module
    // (get-my-active-restrictions.ts) is fine and expected -- types are
    // erased at compile time, so only the runtime function name itself
    // (getMyActiveRestrictions, without the -Client suffix) would signal
    // an actual boundary violation here.
    expect(source).not.toMatch(/import\s*\{\s*getMyActiveRestrictions\s*[,}]/);
  });

  it("PublishedListingEditor (a client component) never imports the server interpreter", () => {
    const source = readFile("components/seller/PublishedListingEditor.tsx");
    expect(source).not.toMatch(/interpret-interaction-blocked-server/);
  });

  it("no module in this feature imports both Supabase clients at once", () => {
    const files = [
      "lib/seller/published-listing-edit-state.ts",
      "lib/seller/get-published-listing-edit-state.ts",
      "lib/seller/published-listing-actions.ts",
      "lib/moderation/select-interaction-blocked-presentation.ts",
      "lib/moderation/interpret-interaction-blocked.ts",
      "lib/moderation/interpret-interaction-blocked-server.ts",
      "components/seller/PublishedListingEditor.tsx",
      "app/sell/[listingId]/edit/page.tsx",
    ];
    for (const path of files) {
      const source = readFile(path);
      const hasBrowserClient = /from\s*"@\/lib\/supabase\/client"/.test(source);
      const hasServerClient = /from\s*"@\/lib\/supabase\/server"/.test(source);
      expect(hasBrowserClient && hasServerClient).toBe(false);
    }
  });
});
