import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export type AuthUser = {
  id: string;
  email: string | null;
};

/** Exported (in addition to the cached getAuthUser below) so its
 * guest/authenticated/error behavior can be unit-tested directly,
 * without fighting React's cache() -- which is only meaningfully scoped
 * within an actual Next.js request and has no reset boundary between
 * `it()` blocks in a plain unit test. */
export async function getAuthUserUncached(): Promise<AuthUser | null> {
  const supabase = await createClient();

  // getUser() (not getSession()) -- it revalidates the JWT against the
  // Supabase Auth server rather than trusting an unverified session
  // cookie value, per Supabase's own SSR security guidance.
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) return null;

  return { id: data.user.id, email: data.user.email ?? null };
}

/**
 * Memoized per-request (React cache()) so the root layout, a page, and
 * any Server Component in between can all call this without triggering
 * more than one getUser() round trip per request.
 */
export const getAuthUser = cache(getAuthUserUncached);
