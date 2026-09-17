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
});
