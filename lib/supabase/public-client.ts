import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getSupabaseEnv } from "./env";

/**
 * A plain, stateless, anon-key-only Supabase client -- no cookie/session
 * binding (unlike lib/supabase/server.ts's createClient, which reads/writes
 * request cookies) and no browser-storage assumptions (unlike
 * lib/supabase/client.ts's createBrowserClient). auth.persistSession/
 * autoRefreshToken are explicitly disabled so this client can never pick up
 * or depend on a signed-in session, even by accident.
 *
 * For server code whose result must be identical regardless of who (if
 * anyone) is making the request -- today, only the sitemap.xml metadata
 * route (lib/sitemap/build-sitemap-entries.ts), which must return the same
 * public URLs to Googlebot as to a signed-in owner previewing it. Never use
 * this for any call that depends on the caller's own identity or RLS
 * context -- use lib/supabase/server.ts's createClient for that.
 */
export function createPublicClient() {
  const { url, anonKey } = getSupabaseEnv();

  return createSupabaseClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
