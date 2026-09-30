import type { MetadataRoute } from "next";
import { getAppUrl } from "@/lib/env";

/**
 * Allow-all only -- no disallow/noindex policy of any kind is introduced
 * by this slice (that remains a separate, not-yet-decided product/SEO
 * choice; see docs/PROJECT_STATUS.md's Technical SEO backlog entry). This
 * file's only job is to declare the sitemap's absolute URL so crawlers
 * that check robots.txt first can find it.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
    },
    sitemap: `${getAppUrl()}/sitemap.xml`,
  };
}
