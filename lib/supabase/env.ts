function readEnvVar(name: string): string {
  const value = process.env[name];

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
    url: readEnvVar("NEXT_PUBLIC_SUPABASE_URL"),
    anonKey: readEnvVar("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  };
}
