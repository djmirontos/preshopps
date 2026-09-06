import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

function readFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf-8");
}

describe("favorite state is supplied efficiently (no N+1 per-card fetch)", () => {
  it("resolves the caller's favorited ids exactly once, at the root layout", () => {
    const source = readFile("app/layout.tsx");
    const occurrences = source.match(/getMyFavoriteListingIds\(\)/g) ?? [];
    expect(occurrences.length).toBe(1);
    expect(source).toContain("FavoritesProvider");
  });

  it("ListingCard never imports a data-fetching client or favorites query -- it only renders FavoriteButton", () => {
    const source = readFile("components/marketplace/ListingCard.tsx");
    expect(source).not.toContain("createClient");
    expect(source).not.toContain("getMyFavoriteListingIds");
    expect(source).not.toMatch(/rpc\(\s*["']get_my_favorites["']/);
    expect(source).toContain("FavoriteButton");
  });

  it("FavoriteButton reads its favorited state from the shared context, not a per-instance fetch", () => {
    const source = readFile("components/marketplace/FavoriteButton.tsx");
    expect(source).toContain("useFavorites");
    // The only Supabase calls in this file are the mutation RPCs
    // (add_favorite/remove_favorite), never a favorites SELECT/RPC used
    // just to determine initial state.
    expect(source).not.toMatch(/from\(\s*["']favorites["']\s*\)/);
    expect(source).not.toMatch(/rpc\(\s*["']get_my_favorites["']/);
  });

  it("get-my-favorite-ids issues a single lightweight query (listing_id only), not the full card projection", () => {
    const source = readFile("lib/favorites/get-my-favorite-ids.ts");
    expect(source).toMatch(/\.select\(\s*["']listing_id["']\s*\)/);
    expect(source).not.toMatch(/rpc\(\s*["']get_my_favorites["']/);
  });
});
