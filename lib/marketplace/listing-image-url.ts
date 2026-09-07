import { getSupabaseEnv } from "@/lib/supabase/env";

/**
 * Extracted from browse-listings.ts into its own client-safe module: that
 * file's other exports pull in the server-only Supabase client
 * (lib/supabase/server.ts, which imports the "server-only" sentinel
 * package), so importing getListingImageUrl from there is unsafe from any
 * client component -- exactly the failure hit by
 * lib/cart/hydrate-guest-cart-client.ts, which must build the same public
 * storage URL from the browser. This function only ever reads the public
 * NEXT_PUBLIC_* Supabase env (lib/supabase/env.ts, itself client-safe), so
 * it has no reason to depend on server-only code at all.
 *
 * No storage bucket exists live yet (confirmed read-only at the time this
 * was first written), so this path is currently unexercised by any real
 * row -- but it follows the documented Supabase public-storage URL shape
 * and the exact project host only (no wildcard remote host).
 */
export function getListingImageUrl(path: string | null): string | undefined {
  if (!path) return undefined;
  const { url } = getSupabaseEnv();
  return `${url}/storage/v1/object/public/${path}`;
}
