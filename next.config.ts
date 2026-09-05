import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        // Exact project storage host only (matches NEXT_PUBLIC_SUPABASE_URL) —
        // not a wildcard of arbitrary remote hosts.
        protocol: "https",
        hostname: "ylhfbqcyxjmxrbpkxtgu.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },
};

export default nextConfig;
