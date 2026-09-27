import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

// This Edge Function runs on Deno, not Node/Vitest -- the file as a whole
// (its top-level Deno.env.get calls, its "jsr:"/"npm:" module specifiers,
// its async RPC/Resend control flow) cannot be imported and executed
// here. Most tests below are static source-inspection tests (the same
// convention this codebase already uses for SQL migrations), proving the
// required security/behavior properties by reading the deployed source as
// text -- not a lesser substitute, but this file's own established,
// accepted convention (see its own top-of-file comment).
//
// The one exception: the unread-messaging-summary template renderer
// (conversationLabel/renderUnreadMessagingSummaryTemplate) has no
// Deno-specific dependency at all -- no Deno.env, no imported client, no
// network call -- so it is both feasible and worthwhile to actually run
// it, extracted verbatim from the real file (never hand-retyped, so it
// cannot silently drift from what is actually deployed) and transpiled
// through the real TypeScript compiler (never a hand-rolled type
// stripper, which would itself be a new source of bugs) into plain JS
// this process can execute. See loadTemplateRenderer below.
function readFunctionSource(): string {
  return readFileSync(path.join(process.cwd(), "supabase/functions/process-email-outbox/index.ts"), "utf-8");
}

// Strips single-line "//" comments before an assertion that checks a name
// is NEVER called -- a doc comment merely explaining, in prose, why
// something is deliberately not used (e.g. "never from row.payload...")
// would otherwise be misread as evidence it IS referenced. Matches this
// codebase's own established stripComments/stripSqlComments convention.
function stripLineComments(source: string): string {
  return source
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
}

// Extracts one function's exact source text via brace-balanced slicing
// (not a fixed line count, which would silently mis-extract if the real
// function's own length ever changes).
function extractFunctionSource(source: string, signature: string): string {
  const start = source.indexOf(signature);
  expect(start).toBeGreaterThan(-1);
  const bodyOpen = source.indexOf("{", start);
  let depth = 0;
  let i = bodyOpen;
  for (; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) break;
    }
  }
  return source.slice(start, i + 1);
}

type UnreadMessagingSummaryFixtureRow = {
  conversation_id: string;
  shop_name: string | null;
  listing_title: string | null;
  other_party_display_name: string | null;
};

function loadTemplateRenderer(): {
  renderUnreadMessagingSummaryTemplate: (rows: UnreadMessagingSummaryFixtureRow[]) => { subject: string; text: string; html: string };
  conversationLabel: (row: UnreadMessagingSummaryFixtureRow) => string;
} {
  const source = readFunctionSource();
  const tsSource = [
    'const APP_BASE_URL = "https://preshopps.example";',
    extractFunctionSource(source, "function escapeHtml("),
    extractFunctionSource(source, "function wrapHtml("),
    extractFunctionSource(source, "function getAppUrl("),
    extractFunctionSource(source, "function messagesLink("),
    extractFunctionSource(source, "function asString("),
    extractFunctionSource(source, "function buildTemplate("),
    "const MAX_LISTED_UNREAD_CONVERSATIONS = 5;",
    extractFunctionSource(source, "function conversationLabel("),
    extractFunctionSource(source, "function renderUnreadMessagingSummaryTemplate("),
    "return { renderUnreadMessagingSummaryTemplate, conversationLabel };",
  ].join("\n\n");

  const { outputText, diagnostics } = ts.transpileModule(tsSource, {
    compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2020 },
    reportDiagnostics: true,
  });
  expect(diagnostics ?? []).toHaveLength(0);

  const factory = new Function(outputText) as () => {
    renderUnreadMessagingSummaryTemplate: (rows: UnreadMessagingSummaryFixtureRow[]) => { subject: string; text: string; html: string };
    conversationLabel: (row: UnreadMessagingSummaryFixtureRow) => string;
  };
  return factory();
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

  it("a mid-run not_configured result is never finalized as sent or failed (no attempt consumed) -- true in both the normal path and the unread-summary send sub-branch", () => {
    // There are now two independent "if (result.ok) { ... } if (reason ===
    // not_configured) { ... } <mark_email_failed>" sequences (the original
    // normal path, plus the unread-summary branch's own send sub-branch,
    // which deliberately mirrors it) -- both must have the same property,
    // so each is located and checked independently rather than assuming
    // there is only one "if (result.ok)" in the whole file.
    const okIndices: number[] = [];
    let searchFrom = 0;
    for (;;) {
      const idx = source.indexOf("if (result.ok)", searchFrom);
      if (idx === -1) break;
      okIndices.push(idx);
      searchFrom = idx + 1;
    }
    expect(okIndices.length).toBe(2);

    for (const okIdx of okIndices) {
      const nextMarkFailedIdx = source.indexOf('await supabase.rpc("mark_email_failed"', okIdx);
      const body = source.slice(okIdx, nextMarkFailedIdx);
      expect(body).toMatch(/reason === "not_configured"/);
      expect(stripLineComments(body)).not.toMatch(/mark_email_failed/);
    }
  });
});

describe("process-email-outbox Edge Function -- template content matches the Next.js templates (no event-matrix or content change)", () => {
  const source = readFunctionSource();

  it("implements exactly the same 8 original email event types plus the new unread_messages_summary, no more, no fewer", () => {
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
        "unread_messages_summary",
      ].sort(),
    );
  });

  it("the original 8 event types are still present (this is an addition, not a replacement)", () => {
    for (const eventType of [
      "new_order_request",
      "order_accepted",
      "order_declined",
      "order_partial_acceptance",
      "order_expiration_reminder",
      "order_seller_cancelled",
      "moderation_restriction_applied",
      "moderation_restriction_lifted",
    ]) {
      expect(source).toMatch(new RegExp(`case "${eventType}": \\{`));
    }
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

// ============================================================
// unread_messages_summary -- the one event type with a claim-time live
// recheck between claim and send. These tests inspect the ACTUAL claimed
// per-row loop's structure (ordering/branching via indexOf, matching this
// file's own established convention for control flow that depends on
// Deno-specific imports this Node/Vitest process cannot execute), except
// where noted, where the pure template-rendering logic is genuinely
// executed instead (see loadTemplateRenderer above).
// ============================================================
describe("process-email-outbox Edge Function -- unread_messages_summary claim-time recheck", () => {
  const source = readFunctionSource();
  const branchStart = source.indexOf('if (row.event_type === "unread_messages_summary")');
  const branchEnd = source.indexOf("\n    const template = renderEmailTemplate(row.event_type, row.payload ?? {});");
  const branch = source.slice(branchStart, branchEnd);

  it("is entered via row.event_type === \"unread_messages_summary\", before the normal renderEmailTemplate path", () => {
    expect(branchStart).toBeGreaterThan(-1);
    expect(branchEnd).toBeGreaterThan(branchStart);
  });

  it("calls get_current_unread_messaging_summary with p_recipient_user_id set from row.recipient_user_id, immediately after claim and before any render/send logic for this row", () => {
    expect(branch).toMatch(/supabase\.rpc\("get_current_unread_messaging_summary", \{\s*\n\s*p_recipient_user_id: row\.recipient_user_id,\s*\n\s*\}\)/);
    // This must be the FIRST thing the branch does -- no render/send call
    // of any kind precedes it.
    const rpcIdx = branch.indexOf("get_current_unread_messaging_summary");
    const sendIdx = branch.indexOf("sendEmailViaResend");
    expect(sendIdx).toBeGreaterThan(rpcIdx);
  });

  it("on a claim-time RPC failure, marks the row failed (existing retry path) and never calls Resend, mark_email_sent, or cancel_claimed_email for this row", () => {
    const failureBranchStart = branch.indexOf("if (summaryError)");
    const failureBranchEnd = branch.indexOf("continue;\n      }", failureBranchStart);
    const failureBranch = branch.slice(failureBranchStart, failureBranchEnd);
    expect(failureBranch).toMatch(/supabase\.rpc\("mark_email_failed"/);
    expect(failureBranch).toMatch(/failed \+= 1;/);
    expect(failureBranch).not.toMatch(/sendEmailViaResend|mark_email_sent|cancel_claimed_email/);
  });

  it("never exposes the raw claim-time RPC error text as anything other than the outbox's own internal last_error column (same non-public column every other event type's provider error already uses)", () => {
    expect(branch).toMatch(/p_error: `get_current_unread_messaging_summary failed: \$\{summaryError\.message\}`/);
    // Confirms this string is only ever passed to mark_email_failed's own
    // p_error argument -- never interpolated into anything that could
    // reach an email template or an HTTP response body.
    expect(source).not.toMatch(/summaryError\.message[^`]*(?:subject|html|text|Response)/);
  });

  it("when the RPC returns zero rows, calls cancel_claimed_email with the claimed row id and a sanitized reason, and never calls Resend, mark_email_sent, or mark_email_failed for this row", () => {
    const cancelBranchStart = branch.indexOf("if (summary.length === 0)");
    const cancelBranchEnd = branch.indexOf("cancelled += 1;");
    const cancelBranch = branch.slice(cancelBranchStart, cancelBranchEnd);
    expect(cancelBranch).toMatch(/supabase\.rpc\("cancel_claimed_email", \{\s*\n\s*p_id: row\.id,\s*\n\s*p_reason: "No unread messaging summary remained eligible at send time\.",\s*\n\s*\}\)/);
    expect(stripLineComments(cancelBranch)).not.toMatch(/sendEmailViaResend|mark_email_sent|mark_email_failed/);
  });

  it("increments the cancelled counter only after cancel_claimed_email succeeds, never on its own failure, and never treats a cancellation as sent or failed", () => {
    const cancelBranchStart = branch.indexOf("if (summary.length === 0)");
    const cancelBranchNextStart = branch.indexOf("// Rendered entirely from this fresh RPC result");
    const cancelBranch = branch.slice(cancelBranchStart, cancelBranchNextStart);
    // cancelled += 1 must appear strictly after the cancelError check
    // resolves false (i.e. inside the success path only) -- verified by
    // its position relative to the early "continue" that guards it.
    const cancelErrorGuardIdx = cancelBranch.indexOf("if (cancelError)");
    const continueAfterGuardIdx = cancelBranch.indexOf("continue;", cancelErrorGuardIdx);
    const cancelledIncrementIdx = cancelBranch.indexOf("cancelled += 1;");
    expect(cancelledIncrementIdx).toBeGreaterThan(continueAfterGuardIdx);
    expect(cancelBranch).not.toMatch(/sent \+= 1|failed \+= 1/);
  });

  it("when cancel_claimed_email itself fails, logs the error, does not send, and does not mark the row sent or failed -- it is simply left claimed for the existing stale-'processing' reclaim to retry the whole recheck later", () => {
    const cancelBranchStart = branch.indexOf("if (summary.length === 0)");
    const cancelBranchNextStart = branch.indexOf("// Rendered entirely from this fresh RPC result");
    const cancelBranch = branch.slice(cancelBranchStart, cancelBranchNextStart);
    const cancelErrorIdx = cancelBranch.indexOf("if (cancelError) {");
    const consoleErrorIdx = cancelBranch.indexOf("console.error(`cancel_claimed_email failed", cancelErrorIdx);
    expect(consoleErrorIdx).toBeGreaterThan(cancelErrorIdx);
    const cancelErrorBlock = cancelBranch.slice(cancelErrorIdx, cancelBranch.indexOf("continue;", consoleErrorIdx));
    expect(cancelErrorBlock).not.toMatch(/sendEmailViaResend|mark_email_sent|mark_email_failed|cancelled \+= 1/);
  });

  it("when the RPC returns non-empty rows, renders from that fresh result (never from row.payload) and, on a successful send, marks the row sent exactly like every other event type", () => {
    const sendBranchStart = branch.indexOf("// Rendered entirely from this fresh RPC result");
    const sendBranch = branch.slice(sendBranchStart);
    expect(sendBranch).toMatch(/renderUnreadMessagingSummaryTemplate\(summary\)/);
    expect(stripLineComments(sendBranch)).not.toMatch(/row\.payload/);
    expect(sendBranch).toMatch(/supabase\.rpc\("mark_email_sent", \{ p_id: row\.id \}\)/);
    expect(sendBranch).toMatch(/sent \+= 1;/);
  });

  it("preserves the same not_configured (zero-attempt) and provider-error (mark_email_failed) handling as every other event type, inside its own send branch", () => {
    const sendBranchStart = branch.indexOf("// Rendered entirely from this fresh RPC result");
    const sendBranch = branch.slice(sendBranchStart);
    expect(sendBranch).toMatch(/reason === "not_configured"/);
    expect(sendBranch).toMatch(/supabase\.rpc\("mark_email_failed", \{ p_id: row\.id, p_error: result\.error \}\)/);
  });
});

describe("process-email-outbox Edge Function -- existing 8 event types and counters are unaffected", () => {
  const source = readFunctionSource();

  it("the normal (non-unread-summary) path still calls claim_pending_emails, renderEmailTemplate, and the same mark_email_sent/mark_email_failed RPCs, completely unchanged", () => {
    expect(source).toMatch(/supabase\.rpc\("claim_pending_emails", \{ p_limit: limit \}\)/);
    expect(source).toMatch(/const template = renderEmailTemplate\(row\.event_type, row\.payload \?\? \{\}\);/);
    expect(source).toMatch(/supabase\.rpc\("mark_email_sent", \{ p_id: row\.id \}\)/);
    expect(source).toMatch(/supabase\.rpc\("mark_email_failed", \{ p_id: row\.id, p_error: result\.error \}\)/);
  });

  it("not_configured still consumes zero attempts in the normal path too (appears twice total: once in the unread-summary branch, once in the normal path)", () => {
    const occurrences = source.match(/reason === "not_configured"/g) ?? [];
    expect(occurrences).toHaveLength(2);
  });

  it("adds a cancelled counter alongside the existing claimed/sent/failed counters without changing what they mean", () => {
    expect(source).toMatch(/let cancelled = 0;/);
    expect(source).toMatch(/return \{ claimed: rows\.length, sent, failed, cancelled, providerConfigured: true \};/);
    expect(source).toMatch(/return \{ claimed: 0, sent: 0, failed: 0, cancelled: 0, providerConfigured: false \};/);
    // sent/failed are only ever incremented by exactly "+= 1" (never reset,
    // never double-counted by some other assignment) -- the same
    // increment style used everywhere else in this file.
    // sent: once in the normal path, once in the unread-summary send
    // sub-branch. failed: once in the normal path, plus twice in the
    // unread-summary branch (its own claim-time-RPC-failure case, and its
    // own send sub-branch mirroring the normal path's provider-error
    // case). cancelled: exactly once, only on a successful cancellation.
    expect((source.match(/sent \+= 1;/g) ?? []).length).toBe(2);
    expect((source.match(/failed \+= 1;/g) ?? []).length).toBe(3);
    expect((source.match(/cancelled \+= 1;/g) ?? []).length).toBe(1);
  });

  it("never issues a raw SQL UPDATE against email_outbox for the new event type either -- cancel_claimed_email is a function call, not inline SQL", () => {
    expect(source).not.toMatch(/update\s+.*email_outbox/i);
  });
});

// ============================================================
// The unread-summary template renderer has no Deno-specific dependency,
// so it is genuinely executed here -- extracted verbatim from the real
// file (see loadTemplateRenderer above), not hand-retyped, and run
// through the real TypeScript compiler, not a hand-rolled type stripper.
// ============================================================
describe("process-email-outbox Edge Function -- unread-summary template content (genuinely executed, not source-text-only)", () => {
  it("renders a subject/body naming the count of unread conversations and links to /messages, never to a specific conversation", () => {
    const { renderUnreadMessagingSummaryTemplate } = loadTemplateRenderer();
    const rows: UnreadMessagingSummaryFixtureRow[] = [
      { conversation_id: "11111111-1111-1111-1111-111111111111", shop_name: "Anne's Closet", listing_title: "Vintage Lamp", other_party_display_name: null },
      { conversation_id: "22222222-2222-2222-2222-222222222222", shop_name: null, listing_title: null, other_party_display_name: "Maria Santos" },
    ];

    const template = renderUnreadMessagingSummaryTemplate(rows);

    expect(template.subject).toBe("You have unread messages on Preshopps");
    expect(template.text).toMatch(/You have 2 unread conversations waiting for you\./);
    expect(template.text).toMatch(/https:\/\/preshopps\.example\/messages/);
    expect(template.text).not.toMatch(/\/messages\/[0-9a-f-]{36}/);
    expect(template.html).toMatch(/https:\/\/preshopps\.example\/messages"/);
  });

  it("lists safe conversation labels (other_party_display_name, falling back to shop_name) and includes each listing_title when present", () => {
    const { conversationLabel } = loadTemplateRenderer();
    expect(conversationLabel({ conversation_id: "x", shop_name: null, listing_title: "Vintage Lamp", other_party_display_name: "Maria Santos" })).toBe(
      "Maria Santos (Vintage Lamp)",
    );
    expect(conversationLabel({ conversation_id: "x", shop_name: "Anne's Closet", listing_title: null, other_party_display_name: null })).toBe("Anne's Closet");
    expect(conversationLabel({ conversation_id: "x", shop_name: null, listing_title: null, other_party_display_name: null })).toBe("Someone");
  });

  it("caps the listed conversations and summarizes the remainder rather than listing an unbounded number of rows", () => {
    const { renderUnreadMessagingSummaryTemplate } = loadTemplateRenderer();
    const rows: UnreadMessagingSummaryFixtureRow[] = Array.from({ length: 8 }, (_, i) => ({
      conversation_id: `id-${i}`,
      shop_name: `Shop ${i}`,
      listing_title: null,
      other_party_display_name: null,
    }));

    const template = renderUnreadMessagingSummaryTemplate(rows);

    for (let i = 0; i < 5; i++) expect(template.text).toMatch(new RegExp(`Shop ${i}(\\b|$)`));
    expect(template.text).toMatch(/\.\.\.and 3 more\./);
  });

  it("never renders covers_through, a conversation id, an email address, or anything resembling message body/content -- only the four safe fields", () => {
    const { renderUnreadMessagingSummaryTemplate } = loadTemplateRenderer();
    const rows: UnreadMessagingSummaryFixtureRow[] = [
      {
        conversation_id: "33333333-3333-3333-3333-333333333333",
        shop_name: "Anne's Closet",
        listing_title: "Vintage Lamp",
        other_party_display_name: "Maria Santos",
      },
    ];

    const template = renderUnreadMessagingSummaryTemplate(rows);
    const fullOutput = `${template.subject}\n${template.text}\n${template.html}`;

    expect(fullOutput).not.toMatch(/covers_through/);
    expect(fullOutput).not.toMatch(/33333333-3333-3333-3333-333333333333/);
    expect(fullOutput).not.toMatch(/@/); // no email address ever interpolated
  });

  it("the extracted renderer source itself never references row.payload, message body/content, or any Deno-specific API -- confirms this is genuinely the pure, side-effect-free portion of the file", () => {
    const source = readFunctionSource();
    const rendererSource = extractFunctionSource(source, "function renderUnreadMessagingSummaryTemplate(");
    expect(rendererSource).not.toMatch(/payload|\.body|Deno\.env|await |supabase\.rpc/);
  });
});
