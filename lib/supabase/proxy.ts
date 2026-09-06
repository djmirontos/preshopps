import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseEnv } from "./env";

/**
 * Refreshes the Supabase auth session cookie on every request. This is
 * the standard @supabase/ssr Next.js pattern -- lib/supabase/server.ts's
 * setAll() has always no-op'd inside plain Server Component renders
 * (which can't set cookies) specifically because that responsibility
 * belongs here. Without this, a session can go stale and Server
 * Components reading cookies would see outdated auth state.
 *
 * Do not add other logic between createServerClient() and getUser() --
 * per Supabase's own guidance, that ordering is what keeps the session
 * refresh correct and easy to reason about.
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const { url, anonKey } = getSupabaseEnv();

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          supabaseResponse.cookies.set(name, value, options);
        });
      },
    },
  });

  await supabase.auth.getUser();

  return supabaseResponse;
}
