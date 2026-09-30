// No `import "server-only"` here (unlike lib/supabase/public-client.ts) --
// this module is imported directly by tests/unit/build-sitemap-entries.test.ts,
// which mocks that client module but still loads this file for real, the
// same convention lib/marketplace/browse-listings.ts already follows.
import { createPublicClient } from "@/lib/supabase/public-client";
import { getAppUrl } from "@/lib/env";

/**
 * Both public read RPCs backing this module cap p_limit at 50 (see
 * browse_listings, 0036/0106, and list_public_shops, 0107) -- using the
 * maximum on every page minimizes round trips for a route search engines
 * poll unattended.
 */
const PAGE_SIZE = 50;

/**
 * A per-RPC loop/work bound only -- large enough that either dataset can
 * grow substantially before this fires, but it exists purely so a single
 * runaway RPC can't page forever inside walkKeysetPages. It is deliberately
 * NOT the thing that enforces Next.js's real sitemap.xml limit: two
 * datasets can each stay under this bound individually while their SUM
 * still exceeds that limit, which is exactly what MAX_SITEMAP_URLS below
 * checks, across the complete combined entry list (homepage + listings +
 * shops), after both RPCs have been walked.
 */
const MAX_ROWS_PER_RPC = 45_000;

/**
 * Next.js's own sitemap.xml route caps a single file at 50,000 URLs (see
 * generateSitemaps() in the Next.js docs for the multi-file escape hatch
 * once a dataset outgrows this). This module refuses to silently truncate
 * at that boundary -- buildSitemapEntries throws well before it, so a real
 * overage surfaces as a build/request failure that has to be addressed
 * deliberately (via generateSitemaps), never as a sitemap that quietly
 * stops listing pages a crawler would otherwise have found. Checked once,
 * against the homepage + every listing + every shop together -- not
 * per-RPC, since MAX_ROWS_PER_RPC above cannot catch two datasets that are
 * each individually small enough but combine to more than this.
 */
const MAX_SITEMAP_URLS = 50_000;

type ListingCursor = { createdAt: string; id: string };
type ShopCursor = { createdAt: string; id: string };

/** Only the columns this module actually reads from browse_listings'
 * RETURNS TABLE -- see lib/marketplace/browse-listings.ts's own
 * BrowseListingRow for the full shape used by the homepage cards. */
type SitemapListingRow = {
  listing_id: string;
  public_code: string;
  created_at: string;
};

/** Matches list_public_shops' RETURNS TABLE (0107) exactly -- shop_id,
 * slug, created_at, updated_at, nothing else. */
type SitemapShopRow = {
  shop_id: string;
  slug: string;
  created_at: string;
  updated_at: string;
};

export type SitemapUrlEntry = {
  url: string;
  lastModified?: Date;
};

export class SitemapEnumerationError extends Error {}

type RpcResult<Row> = { data: Row[] | null; error: { message: string } | null };

/**
 * Shared keyset-cursor page walker for both RPCs below. Deliberately
 * throws -- never returns a partial result -- on any RPC error, on a
 * dataset larger than MAX_ROWS_PER_RPC, or if two consecutive pages would
 * be fetched with the identical cursor. That last case is a defensive
 * guard against a future RPC regression that stops the cursor from
 * advancing (e.g. an accidental ORDER BY/predicate-direction mismatch),
 * which would otherwise silently refetch the same page forever. A metadata
 * route that search engines and other crawlers poll unattended must never
 * return a "successful" 200 built from a partial or stuck walk -- failing
 * loudly here is what makes that failure visible instead of silently
 * shrinking the sitemap.
 */
async function walkKeysetPages<Row, Cursor>(options: {
  rpcName: string;
  fetchPage: (cursor: Cursor | null) => Promise<RpcResult<Row>>;
  getCursor: (row: Row) => Cursor;
}): Promise<Row[]> {
  const { rpcName, fetchPage, getCursor } = options;
  const results: Row[] = [];
  let cursor: Cursor | null = null;

  while (true) {
    const { data, error } = await fetchPage(cursor);

    if (error) {
      throw new SitemapEnumerationError(`${rpcName} failed while building the sitemap: ${error.message}`);
    }

    const rows = data ?? [];
    if (rows.length === 0) break;

    results.push(...rows);

    if (results.length > MAX_ROWS_PER_RPC) {
      throw new SitemapEnumerationError(
        `${rpcName} returned more than ${MAX_ROWS_PER_RPC} rows while building the sitemap -- refusing to silently truncate it. This dataset has outgrown a single sitemap.xml file; switch to a paginated sitemap index (generateSitemaps) instead of raising this limit.`,
      );
    }

    const lastRow = rows[rows.length - 1];
    const nextCursor = getCursor(lastRow);

    if (cursor !== null && JSON.stringify(nextCursor) === JSON.stringify(cursor)) {
      throw new SitemapEnumerationError(
        `${rpcName}'s pagination cursor did not advance between pages while building the sitemap -- aborting instead of looping forever.`,
      );
    }

    cursor = nextCursor;

    if (rows.length < PAGE_SIZE) break;
  }

  return results;
}

/**
 * Every available, publicly visible listing, at its canonical
 * /item/{publicCode} URL. browse_listings' own global-mode WHERE clause
 * (p_shop_id omitted here) already admits status = 'available' only --
 * reserved/sold/archived/paused/draft are structurally unreachable through
 * this call, so no extra client-side status filtering is needed to satisfy
 * the "exclude sold/archived/reserved" requirement.
 */
async function fetchListingEntries(): Promise<SitemapUrlEntry[]> {
  const supabase = createPublicClient();
  const appUrl = getAppUrl();

  const rows = await walkKeysetPages<SitemapListingRow, ListingCursor>({
    rpcName: "browse_listings",
    fetchPage: async (cursor) => {
      const { data, error } = await supabase.rpc("browse_listings", {
        p_sort: "newest",
        p_limit: PAGE_SIZE,
        p_before_created_at: cursor?.createdAt ?? null,
        p_before_id: cursor?.id ?? null,
      });
      return { data: (data as SitemapListingRow[] | null) ?? null, error };
    },
    getCursor: (row) => ({ createdAt: row.created_at, id: row.listing_id }),
  });

  // lastModified is deliberately omitted here. browse_listings does not
  // return updated_at (0036/0106 never added one to its RETURNS TABLE, and
  // this slice does not change any SQL), so created_at -- the listing's
  // creation time, not any later edit -- is the only timestamp available.
  // Emitting it as lastModified would tell crawlers a listing changed on
  // the date it was merely created, which is not a reliable modification
  // signal. created_at is still read and used above, but only to drive
  // browse_listings' own keyset cursor -- never surfaced on the entry.
  return rows.map((row) => ({
    url: `${appUrl}/item/${row.public_code}`,
  }));
}

/**
 * Every currently public shop, at its canonical /shop/{currentSlug} URL --
 * including a shop with zero listings, which is exactly the gap
 * list_public_shops (0107) was added to close.
 */
async function fetchShopEntries(): Promise<SitemapUrlEntry[]> {
  const supabase = createPublicClient();
  const appUrl = getAppUrl();

  const rows = await walkKeysetPages<SitemapShopRow, ShopCursor>({
    rpcName: "list_public_shops",
    fetchPage: async (cursor) => {
      const { data, error } = await supabase.rpc("list_public_shops", {
        p_limit: PAGE_SIZE,
        p_before_created_at: cursor?.createdAt ?? null,
        p_before_id: cursor?.id ?? null,
      });
      return { data: (data as SitemapShopRow[] | null) ?? null, error };
    },
    getCursor: (row) => ({ createdAt: row.created_at, id: row.shop_id }),
  });

  return rows.map((row) => ({
    url: `${appUrl}/shop/${row.slug}`,
    // list_public_shops' own updated_at is a real, moddatetime-maintained
    // last-modified timestamp (0107) -- unlike listings above, this one
    // reflects genuine edits, not just creation time.
    lastModified: new Date(row.updated_at),
  }));
}

/**
 * The full sitemap: homepage, every available listing, every public shop
 * (with or without listings). /search is intentionally never included --
 * its own indexing/canonical policy remains a separate, not-yet-decided
 * backlog item (see docs/PROJECT_STATUS.md's Technical SEO entry), and
 * this slice does not decide it. Throws (via walkKeysetPages, or the
 * explicit duplicate check below) rather than ever returning a sitemap
 * that silently omits or repeats a URL.
 */
export async function buildSitemapEntries(): Promise<SitemapUrlEntry[]> {
  const appUrl = getAppUrl();
  const [listingEntries, shopEntries] = await Promise.all([fetchListingEntries(), fetchShopEntries()]);

  const entries: SitemapUrlEntry[] = [{ url: appUrl }, ...listingEntries, ...shopEntries];

  if (entries.length > MAX_SITEMAP_URLS) {
    throw new SitemapEnumerationError(
      `The combined sitemap (homepage + listings + shops) has ${entries.length} URLs, exceeding the ${MAX_SITEMAP_URLS}-URL sitemap.xml limit -- refusing to silently truncate it. Switch to a paginated sitemap index (generateSitemaps) instead of raising this limit.`,
    );
  }

  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.url)) {
      throw new SitemapEnumerationError(`Duplicate sitemap URL detected: ${entry.url}`);
    }
    seen.add(entry.url);
  }

  return entries;
}
