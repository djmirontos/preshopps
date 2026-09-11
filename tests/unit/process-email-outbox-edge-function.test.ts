import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// This Edge Function runs on Deno, not Node/Vitest -- it cannot be
// imported and executed here. These are static source-inspection tests
// (the same convention this codebase already uses for SQL migrations),
// proving the required security/behavior properties by reading the
// deployed source as text.
function readFunctionSource(): string {
  return readFileSync(path.join(process.cwd(), "supabase/functions/process-email-outbox/index.ts"), "utf-8");
}

describe("process-email-outbox Edge Function -- auth", () => {
  const source = readFunctionSource();

  it("rejects every request without a valid x-cron-secret header via a constant-time comparison, and fails closed when CRON_SECRET itself is unset", () => {
    expect(source).toMatch(/if \(!CRON_SECRET \|\| !\(await timingSafeEqualHash\(providedSecret, CRON_SECRET\)\)\)/);
    expect(source).toMatch(/status: 401/);
  });

  it("no longer uses a plain !== string comparison for the secret (timing side-channel)", () => {
    expect(source).not.toMatch(/req\.headers\.get\("x-cron-secret"\)\s*!==\s*CRON_SECRET/);
  });

  it("the constant-time comparison hashes both sides to a fixed-length digest before comparing, using only the standard Web Crypto API (no new dependency)", () => {
    expect(source).toMatch(/async function timingSafeEqualHash\(a: string, b: string\): Promise<boolean>/);
    expect(source).toMatch(/crypto\.subtle\.digest\("SHA-256", encoder\.encode\(a\)\)/);
    expect(source).toMatch(/crypto\.subtle\.digest\("SHA-256", encoder\.encode\(b\)\)/);
    expect(source).toMatch(/diff \|= bytesA\[i\] \^ bytesB\[i\];/);
  });

  it("the auth check is the very first thing the request handler does -- zero email_outbox rows are touched before a successful comparison", () => {
    const handlerStart = source.indexOf("Deno.serve(async (req: Request) => {");
    const authCheckIdx = source.indexOf("timingSafeEqualHash(providedSecret, CRON_SECRET)");
    const clientCreationIdx = source.indexOf("createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)");
    expect(handlerStart).toBeGreaterThan(-1);
    expect(authCheckIdx).toBeGreaterThan(handlerStart);
    expect(clientCreationIdx).toBeGreaterThan(authCheckIdx);
  });

  it("never logs the provided or expected secret", () => {
    expect(source).not.toMatch(/console\.(log|warn|error)\([^)]*providedSecret/);
    expect(source).not.toMatch(/console\.(log|warn|error)\([^)]*CRON_SECRET\)/);
  });

  it("is not protected by Supabase's own JWT verification -- it must implement its own check (verify_jwt was deployed as false)", () => {
    // The absence of any JWT-verification code here is intentional and
    // documented -- verify_jwt=false was passed at deploy time. This test
    // guards the corresponding custom-auth code path actually exists.
    expect(source).not.toMatch(/verifyJwt|supabase\.auth\.getUser\(/);
  });
});

describe("process-email-outbox Edge Function -- no secret is hardcoded or exposed", () => {
  const source = readFunctionSource();

  it("reads every credential from Deno.env.get, never as a literal string", () => {
    expect(source).toMatch(/Deno\.env\.get\("SUPABASE_SERVICE_ROLE_KEY"\)/);
    expect(source).toMatch(/Deno\.env\.get\("CRON_SECRET"\)/);
    expect(source).toMatch(/Deno\.env\.get\("RESEND_API_KEY"\)/);
    expect(source).toMatch(/Deno\.env\.get\("EMAIL_FROM_ADDRESS"\)/);
  });

  it("never returns SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, or CRON_SECRET in any HTTP response body", () => {
    const responseBodies = source.match(/new Response\(JSON\.stringify\(([^)]*)\)/g) ?? [];
    expect(responseBodies.length).toBeGreaterThan(0);
    for (const body of responseBodies) {
      expect(body).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY|RESEND_API_KEY|CRON_SECRET/);
    }
  });

  it("contains no literal API-key-shaped string constants", () => {
    expect(source).not.toMatch(/re_[A-Za-z0-9]{16,}/);
    expect(source).not.toMatch(/eyJhbGciOi[A-Za-z0-9._-]{20,}/);
  });
});

describe("process-email-outbox Edge Function -- reuses existing outbox RPCs, does not duplicate their idempotency/retry logic", () => {
  const source = readFunctionSource();

  it("calls the exact same claim/mark RPC names as the Next.js processor, never reimplementing claim or retry logic in Deno", () => {
    expect(source).toMatch(/supabase\.rpc\("claim_pending_emails", \{ p_limit: limit \}\)/);
    expect(source).toMatch(/supabase\.rpc\("mark_email_sent", \{ p_id: row\.id \}\)/);
    expect(source).toMatch(/supabase\.rpc\("mark_email_failed", \{ p_id: row\.id, p_error: result\.error \}\)/);
  });

  it("never issues a raw SQL UPDATE against email_outbox itself -- all state transitions go through the existing functions", () => {
    expect(source).not.toMatch(/update\s+.*email_outbox/i);
  });
});

describe("process-email-outbox Edge Function -- provider-not-configured consumes zero attempts (mirrors the Next.js processor)", () => {
  const source = readFunctionSource();

  it("checks isProviderConfigured() and returns before ever calling claim_pending_emails", () => {
    const checkIdx = source.indexOf("if (!isProviderConfigured())");
    const claimIdx = source.indexOf('supabase.rpc("claim_pending_emails"');
    expect(checkIdx).toBeGreaterThan(-1);
    expect(claimIdx).toBeGreaterThan(checkIdx);
  });

  it("isProviderConfigured requires RESEND_API_KEY, EMAIL_FROM_ADDRESS, and APP_BASE_URL all present", () => {
    expect(source).toMatch(/function isProviderConfigured\(\): boolean \{\s*\n\s*return Boolean\(RESEND_API_KEY\) && Boolean\(EMAIL_FROM_ADDRESS\) && Boolean\(APP_BASE_URL\);/);
  });

  it("a mid-run not_configured result is never finalized as sent or failed (no attempt consumed)", () => {
    const body = source.slice(source.indexOf("if (result.ok)"), source.indexOf("const { error: markError } = await supabase.rpc(\"mark_email_failed\""));
    expect(body).toMatch(/reason === "not_configured"/);
    expect(body).not.toMatch(/mark_email_failed/);
  });
});

describe("process-email-outbox Edge Function -- template content matches the Next.js templates (no event-matrix or content change)", () => {
  const source = readFunctionSource();

  it("implements exactly the same 8 email event types, no more, no fewer", () => {
    const eventsMatch = source.match(/type EmailEventType =\s*\n((?:\s*\|\s*"[a-z_]+"\s*\n?)+);/);
    expect(eventsMatch).not.toBeNull();
    const events = [...eventsMatch![1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
    expect(events.sort()).toEqual(
      [
        "moderation_restriction_applied",
        "moderation_restriction_lifted",
        "new_order_request",
        "order_accepted",
        "order_declined",
        "order_expiration_reminder",
        "order_partial_acceptance",
        "order_seller_cancelled",
      ].sort(),
    );
  });

  it("never claims escrow/refund/payment processing", () => {
    expect(source.toLowerCase()).not.toMatch(/escrow|refund processing|payment processing/);
  });
});

describe("process-email-outbox Edge Function -- hosting-neutral wording", () => {
  const source = readFunctionSource();

  it("describes APP_BASE_URL as the canonical deployed Preshopps URL, never a hardcoded Netlify/Vercel domain", () => {
    expect(source).toMatch(/The canonical deployed Preshopps URL/);
    expect(source).not.toMatch(/\.netlify\.app|\.vercel\.app/);
  });

  it("never claims Vercel is the planned production host", () => {
    expect(source).not.toMatch(/Vercel Hobby cannot run sub-daily/);
  });
});
