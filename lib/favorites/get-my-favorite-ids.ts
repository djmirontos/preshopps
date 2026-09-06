import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth/session";

/**
 * Lightweight "which of my favorites are on this page" source -- a direct
 * SELECT against `favorites` (not the get_my_favorites RPC), protected by
 * the existing favorites_select_own RLS policy (0037_favorites_cart_rls_
 * and_rpcs.sql: `using (auth.uid() = user_id)`), returning only listing_id
 * values. One query per request (memoized indirectly by getAuthUser's own
 * cache()), fetched once at the root layout and shared via FavoritesProvider
 * -- this is what lets every ListingCard/FavoriteButton on the page know
 * its favorited state without a per-card query. Guests never reach the
 * query at all (RLS would return zero rows for them anyway, since anon
 * has no policy access, but short-circuiting avoids the round trip).
 */
export async function getMyFavoriteListingIds(): Promise<string[]> {
  const user = await getAuthUser();
  if (!user) return [];

  const supabase = await createClient();
  const { data, error } = await supabase.from("favorites").select("listing_id").eq("user_id", user.id);

  if (error || !data) {
    console.error("Failed to load favorite ids:", error?.message);
    return [];
  }

  return data.map((row) => row.listing_id as string);
}
