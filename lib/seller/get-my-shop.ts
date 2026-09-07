import { createClient } from "@/lib/supabase/server";

export type MyShop = {
  id: string;
  slug: string;
  name: string;
};

/**
 * "Does the current user have a shop, and what's its id/slug/name" --
 * reuses the existing shops_select_owner RLS policy
 * (0031_messaging_rls_and_rpcs.sql: SELECT, `to authenticated`, `using
 * (auth.uid() = owner_id)`) via a plain direct-table read, exactly like
 * lib/favorites/get-my-favorite-ids.ts reuses favorites_select_own. No new
 * migration is needed for this lookup -- the policy already exists and
 * already scopes visibility to the caller's own shop row only.
 *
 * A guest or a user with no shop both simply see zero rows here (RLS
 * default-deny for an unauthenticated caller; a real "no shop yet" case
 * for an authenticated one) -- this function does not distinguish them
 * beyond returning null either way; callers that need to gate on
 * authentication do so separately via getAuthUser().
 */
export async function getMyShop(): Promise<MyShop | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("shops").select("id, slug, name").maybeSingle();

  if (error) {
    console.error("Failed to load my shop:", error.message);
    return null;
  }

  return data;
}
