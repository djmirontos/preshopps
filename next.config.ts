import type { NextConfig } from "next";

/**
 * Derived from NEXT_PUBLIC_SUPABASE_URL rather than hardcoded, so the
 * allowed next/image host always matches whichever Supabase project is
 * actually active: production builds get production's own hostname, and a
 * local build pointed at a different project (e.g. a rehearsal project via
 * .env.development.local) gets THAT project's hostname -- never a second,
 * permanently hardcoded ref alongside production's, and never a
 * *.supabase.co wildcard. Deliberately not imported from lib/supabase/env.ts
 * here: next.config.ts is loaded directly by Next's own Node config loader,
 * outside the app's normal path-alias resolution, so this stays a plain
 * relative computation -- but it fails exactly the same way that module's
 * own readEnvVar does (a thrown Error, not a silent fallback) for a
 * missing or malformed URL, so an invalid env can never silently widen or
 * disable the image host restriction.
 */
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
if (!SUPABASE_URL || SUPABASE_URL.trim() === "") {
  throw new Error("Missing required environment variable: NEXT_PUBLIC_SUPABASE_URL");
}
const supabaseImageHostname = new URL(SUPABASE_URL).hostname;

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        // Exact active project storage host only -- not a wildcard of
        // arbitrary remote hosts.
        protocol: "https",
        hostname: supabaseImageHostname,
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },
};

export default nextConfig;
