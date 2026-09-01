import { createBrowserClient } from "@supabase/ssr";
import { getSupabaseEnv } from "./env";

// Public URL + anon key only — safe to construct in the browser.
export function createClient() {
  const { url, anonKey } = getSupabaseEnv();

  return createBrowserClient(url, anonKey);
}
