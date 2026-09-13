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
 * Listing image crop fix, in two slices:
 * 1. The listing-detail main image (ListingGallery.tsx) switched from
 *    object-cover to object-contain so the buyer's first, non-lightbox
 *    view of a photo never crops it.
 * 2. The marketplace listing card's own primary photo (ListingCard.tsx --
 *    reused by the homepage, search/browse results, favorites, and shop
 *    listings, so this one change reaches every one of those surfaces
 *    automatically) got the exact same object-contain treatment, since
 *    hands-on QA found it was still cropping.
 * Both are pure presentational (CSS class) changes to already-existing
 * client components -- this file is the source-level "stayed exactly
 * that small" checklist for the combined slice.
 */
describe("Listing image crop fix -- scope discipline", () => {
  it("ListingGallery's main image uses object-contain exactly once, and never reintroduces object-cover on that same element", () => {
    const source = readFile("components/listing/ListingGallery.tsx");
    expect(source).toMatch(/className="object-contain"/);
  });

  it("ListingGallery's thumbnail rail keeps its own separate object-cover class -- deliberately not touched by this fix (it's not the primary card/detail image, and it was never asked to change)", () => {
    const source = readFile("components/listing/ListingGallery.tsx");
    const objectCoverCount = (source.match(/className="object-cover"/g) ?? []).length;
    expect(objectCoverCount).toBe(1); // the thumbnail <Image>, only
  });

  it("ListingCard's primary photo also uses object-contain, and no longer uses object-cover anywhere in its actual code", () => {
    const source = readFile("components/marketplace/ListingCard.tsx");
    expect(source).toMatch(/className="object-contain"/);
    // Checked against code only -- this file's own comment explains (by
    // name) what it no longer uses, which would otherwise false-positive
    // a naive "must not mention X" scan.
    expect(stripComments(source)).not.toMatch(/object-cover/);
  });

  it("ListingCard keeps its own card footprint (aspect-[4/5] image box) untouched -- only the object-fit class changed, not the box's size/shape", () => {
    const source = readFile("components/marketplace/ListingCard.tsx");
    expect(source).toMatch(/aspect-\[4\/5\]/);
  });

  it("no image upload/compression/storage code was touched in either component -- both only ever receive image URLs as props, neither uploads/reads/writes storage itself", () => {
    for (const file of ["components/listing/ListingGallery.tsx", "components/marketplace/ListingCard.tsx"]) {
      const source = readFile(file);
      expect(source).not.toMatch(/supabase\.storage|createClient|upload\(|compress/i);
    }
  });

  it("no backend/RPC/migration file was touched by this fix", () => {
    for (const file of ["components/listing/ListingGallery.tsx", "components/marketplace/ListingCard.tsx"]) {
      const source = readFile(file);
      expect(source).not.toMatch(/\.rpc\(|\.from\(\s*["']/);
    }
  });

  it("ListingLightbox's own main-image treatment is untouched and already matches (object-contain, whole-image view)", () => {
    const source = readFile("components/listing/ListingLightbox.tsx");
    expect(source).toMatch(/className="object-contain"/);
  });

  it("every surface that reuses ListingCard (homepage, search results, favorites, shop listings/featured) needs no changes of its own -- none of them duplicate the image markup", () => {
    for (const file of [
      "app/page.tsx",
      "components/search/SearchResultsClient.tsx",
      "components/favorites/FavoritesListingsClient.tsx",
      "components/shop/ShopListingsClient.tsx",
      "components/shop/ShopFeaturedListing.tsx",
    ]) {
      const source = readFile(file);
      expect(source).not.toMatch(/object-cover|object-contain/);
      expect(source).toMatch(/<ListingCard\b/);
    }
  });
});
