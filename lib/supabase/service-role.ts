import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getSupabaseEnv } from "./env";

function readServiceRoleKey(): string {
  const value = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!value || value.trim() === "") {
    throw new Error("Missing required environment variable: SUPABASE_SERVICE_ROLE_KEY");
  }
  return value;
}

/**
 * Privileged, server-only Supabase client that bypasses RLS entirely.
 * Reserved for trusted, secret-protected server contexts only (the email
 * processor and order-expiry-reminder cron routes) -- never import this
 * from a Server Component/Action reachable by an ordinary user request.
 */
export function createServiceRoleClient() {
  const { url } = getSupabaseEnv();
  const serviceRoleKey = readServiceRoleKey();

  return createSupabaseClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
