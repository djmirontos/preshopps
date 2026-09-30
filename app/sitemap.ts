import type { MetadataRoute } from "next";
import { buildSitemapEntries } from "@/lib/sitemap/build-sitemap-entries";

/**
 * sitemap.ts is a Route Handler under the hood, so the same route segment
 * config any route.ts supports applies here -- this is not decorative.
 * Verified locally (production build + start, not `next dev`, which does
 * not apply this caching) that a second request within the window reuses
 * the cached response rather than re-running buildSitemapEntries. An hour
 * is a simple, launch-scale-appropriate refresh: frequent enough that a
 * newly published listing or shop is discoverable the same day, without
 * re-walking both RPCs on every crawler hit.
 */
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  return buildSitemapEntries();
}
