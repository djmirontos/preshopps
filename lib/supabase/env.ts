/**
 * name/value are passed separately (rather than doing `process.env[name]`
 * internally) so every call site uses a literal, static
 * `process.env.NEXT_PUBLIC_X` expression. Next.js can only inline
 * NEXT_PUBLIC_ vars into the browser bundle when it sees that exact
 * static form at build time -- a computed/dynamic lookup like
 * `process.env[name]` is invisible to that replacement and silently
 * resolves to undefined in client code, even though the same dynamic
 * lookup works fine server-side (a real populated process.env there).
 */
function readEnvVar(name: string, value: string | undefined): string {
  if (!value || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export type SupabaseEnv = {
  url: string;
  anonKey: string;
};

export function getSupabaseEnv(): SupabaseEnv {
  return {
    url: readEnvVar("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL),
    anonKey: readEnvVar("NEXT_PUBLIC_SUPABASE_ANON_KEY", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
  };
}
