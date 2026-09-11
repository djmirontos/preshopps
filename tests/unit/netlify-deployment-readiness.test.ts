import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

function readFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf-8");
}

function exists(relativePath: string): boolean {
  return existsSync(path.join(process.cwd(), relativePath));
}

describe("Netlify deployment readiness -- redundant Next.js cron fallback routes removed", () => {
  it("no app/api/cron routes remain (the whole app/api directory no longer exists)", () => {
    expect(exists("app/api")).toBe(false);
    expect(exists("app/api/cron/process-email-outbox/route.ts")).toBe(false);
    expect(exists("app/api/cron/order-expiry-reminders/route.ts")).toBe(false);
  });

  it("the now-unused supporting libraries were removed, not left as dead code", () => {
    expect(exists("lib/email")).toBe(false);
    expect(exists("lib/email/process-email-outbox.ts")).toBe(false);
    expect(exists("lib/email/resend-client.ts")).toBe(false);
    expect(exists("lib/email/env.ts")).toBe(false);
    expect(exists("lib/email/templates.ts")).toBe(false);
    expect(exists("lib/supabase/service-role.ts")).toBe(false);
  });

  it("the unused resend npm dependency was removed from package.json and package-lock.json", () => {
    const packageJson = readFile("package.json");
    const packageLock = readFile("package-lock.json");
    expect(packageJson).not.toMatch(/"resend"/);
    expect(packageLock).not.toMatch(/"resend"/);
  });
});

describe("Netlify deployment readiness -- no server-only secret is required by the frontend anymore", () => {
  it("no remaining file under app/, lib/, or components/ references any of the five Supabase-Edge-Function-only secrets", () => {
    const secretNames = ["SUPABASE_SERVICE_ROLE_KEY", "RESEND_API_KEY", "EMAIL_FROM_ADDRESS", "CRON_SECRET", "EMAIL_TEST_RECIPIENT_OVERRIDE"];

    function collectFiles(dir: string): string[] {
      const entries = readdirSync(path.join(process.cwd(), dir), { withFileTypes: true });
      let files: string[] = [];
      for (const entry of entries) {
        const rel = `${dir}/${entry.name}`;
        if (entry.isDirectory()) {
          files = files.concat(collectFiles(rel));
        } else if (/\.(ts|tsx)$/.test(entry.name)) {
          files.push(rel);
        }
      }
      return files;
    }

    const allFiles = [...collectFiles("app"), ...collectFiles("lib"), ...collectFiles("components")];
    for (const file of allFiles) {
      const content = readFile(file);
      for (const secret of secretNames) {
        expect(content, `${file} must not reference ${secret}`).not.toContain(secret);
      }
    }
  });

  it(".env.example documents exactly three Netlify frontend variables, all public/browser-safe", () => {
    const envExample = readFile(".env.example");
    expect(envExample).toMatch(/NEXT_PUBLIC_SUPABASE_URL=/);
    expect(envExample).toMatch(/NEXT_PUBLIC_SUPABASE_ANON_KEY=/);
    expect(envExample).toMatch(/NEXT_PUBLIC_APP_URL=/);
  });

  it(".env.example clearly labels the Edge Function secrets as NOT Netlify environment variables", () => {
    const envExample = readFile(".env.example");
    expect(envExample).toMatch(/SUPABASE EDGE FUNCTION SECRETS/);
    expect(envExample).toMatch(/NOT Netlify environment variables/);
    expect(envExample).toMatch(/do not add these to Netlify's environment/);
  });

  it(".env.example no longer lists SUPABASE_SERVICE_ROLE_KEY or EMAIL_TEST_RECIPIENT_OVERRIDE as Netlify-required", () => {
    const envExample = readFile(".env.example");
    const netlifySection = envExample.slice(0, envExample.indexOf("SUPABASE EDGE FUNCTION SECRETS"));
    expect(netlifySection).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
    expect(netlifySection).not.toMatch(/EMAIL_TEST_RECIPIENT_OVERRIDE/);
  });
});

describe("Netlify deployment readiness -- Node version pin", () => {
  it("package.json pins Node 22 exactly as specified", () => {
    const pkg = JSON.parse(readFile("package.json"));
    expect(pkg.engines).toEqual({ node: ">=22 <23" });
  });
});

describe("Netlify deployment readiness -- Vercel artifact removed", () => {
  it("vercel.json no longer exists", () => {
    expect(exists("vercel.json")).toBe(false);
  });
});

describe("Netlify deployment readiness -- Supabase Cron/Edge Function architecture untouched", () => {
  it("the process-email-outbox Edge Function source is still present", () => {
    expect(exists("supabase/functions/process-email-outbox/index.ts")).toBe(true);
  });

  it("the Supabase Cron scheduling migration is still present", () => {
    expect(exists("supabase/migrations/0084_supabase_cron_email_scheduling.sql")).toBe(true);
  });

  it("the transactional email outbox migration is still present", () => {
    expect(exists("supabase/migrations/0083_transactional_email_outbox.sql")).toBe(true);
  });
});

describe("Netlify deployment readiness -- proxy.ts (Next.js 16's middleware convention) remains correctly wired", () => {
  const source = readFile("proxy.ts");

  it("exports a named `proxy` function (not `middleware` -- the deprecated Next.js name)", () => {
    expect(source).toMatch(/export async function proxy\(request: NextRequest\)/);
  });

  it("still invokes the Supabase updateSession() helper", () => {
    expect(source).toMatch(/import \{ updateSession \} from "@\/lib\/supabase\/proxy";/);
    expect(source).toMatch(/return await updateSession\(request\);/);
  });

  it("still exports a matcher excluding static/image assets and applying to every other route", () => {
    expect(source).toMatch(/export const config = \{/);
    expect(source).toMatch(/matcher: \[/);
    expect(source).toMatch(/_next\/static/);
    expect(source).toMatch(/_next\/image/);
  });

  it("lib/supabase/proxy.ts (the updateSession implementation) is untouched and still present", () => {
    expect(exists("lib/supabase/proxy.ts")).toBe(true);
  });
});

describe("Netlify deployment readiness -- required application routes remain intact", () => {
  it("the Supabase auth confirmation/callback route still exists", () => {
    expect(exists("app/auth/confirm/route.ts")).toBe(true);
  });

  it("next.config.ts still scopes next/image remotePatterns to this project's Supabase Storage host", () => {
    const nextConfig = readFile("next.config.ts");
    expect(nextConfig).toMatch(/remotePatterns/);
    expect(nextConfig).toMatch(/ylhfbqcyxjmxrbpkxtgu\.supabase\.co/);
  });
});
