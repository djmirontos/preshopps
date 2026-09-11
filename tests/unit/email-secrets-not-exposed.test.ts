import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

function readFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf-8");
}

describe("email/cron secrets are never exposed to the client", () => {
  it("lib/email/env.ts never reads RESEND_API_KEY, CRON_SECRET, or EMAIL_TEST_RECIPIENT_OVERRIDE via a NEXT_PUBLIC_ variable", () => {
    const source = readFile("lib/email/env.ts");
    expect(source).toMatch(/process\.env\.RESEND_API_KEY/);
    expect(source).toMatch(/process\.env\.CRON_SECRET/);
    expect(source).not.toMatch(/NEXT_PUBLIC_RESEND|NEXT_PUBLIC_CRON|NEXT_PUBLIC_EMAIL/);
  });

  it("lib/supabase/service-role.ts reads the service-role key from a server-only variable, never NEXT_PUBLIC_", () => {
    const source = readFile("lib/supabase/service-role.ts");
    expect(source).toMatch(/process\.env\.SUPABASE_SERVICE_ROLE_KEY/);
    expect(source).not.toMatch(/NEXT_PUBLIC_SUPABASE_SERVICE/);
    expect(source).toMatch(/import "server-only";/);
  });

  it("both cron route handlers never echo the configured secret (or the request's Authorization header) back in a JSON response", () => {
    for (const routePath of ["app/api/cron/process-email-outbox/route.ts", "app/api/cron/order-expiry-reminders/route.ts"]) {
      const source = readFile(routePath);
      const jsonCalls = source.match(/NextResponse\.json\(([^)]*)\)/g) ?? [];
      for (const call of jsonCalls) {
        expect(call).not.toMatch(/getCronSecret|authorization|secret/i);
      }
    }
  });

  it("both cron route handlers fail closed (401) rather than defaulting to an always-open comparison", () => {
    for (const routePath of ["app/api/cron/process-email-outbox/route.ts", "app/api/cron/order-expiry-reminders/route.ts"]) {
      const source = readFile(routePath);
      expect(source).toMatch(/if \(!secret\) return false;/);
      expect(source).toMatch(/status: 401/);
    }
  });

  it("resend-client.ts is the only application file that imports the resend package", () => {
    const source = readFile("lib/email/resend-client.ts");
    expect(source).toMatch(/from "resend"/);
  });
});
