"use client";

import { useAuthStatus } from "@/components/auth/AuthStatusProvider";

/**
 * Reads the shared AuthStatusProvider context -- initialized once from the
 * server-resolved user in the root layout -- rather than creating its own
 * Supabase client/subscription. Many FavoriteButtons render per page
 * (homepage rails, search results, shop listings) and must all share one
 * auth-status source instead of each independently querying/subscribing.
 */
export function useIsAuthenticated(): boolean {
  return useAuthStatus();
}
