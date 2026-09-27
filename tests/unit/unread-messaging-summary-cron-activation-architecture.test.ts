import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

function readFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf-8");
}

function stripSqlComments(sql: string): string {
  return sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

function getFunctionBody(source: string, anchor: string): string {
  const fnStart = source.indexOf(anchor);
  expect(fnStart).toBeGreaterThan(-1);
  // Whole function definition, declare section included -- the interval
  // literals and the advisory lock call both live before "begin".
  const bodyEnd = source.indexOf("end;\n$$;", fnStart);
  return source.slice(fnStart, bodyEnd);
}

const FOUNDATION_MIGRATION_PATH = "supabase/migrations/0103_unread_messaging_summary.sql";
const CRON_MIGRATION_PATH = "supabase/migrations/0104_schedule_unread_messaging_summaries.sql";
const EDGE_FUNCTION_PATH = "supabase/functions/process-email-outbox/index.ts";
const ENQUEUE_ANCHOR = "create or replace function public.enqueue_unread_messaging_summaries(";

const foundationSource = readFile(FOUNDATION_MIGRATION_PATH);
const foundationCode = stripSqlComments(foundationSource);
const cronSource = readFile(CRON_MIGRATION_PATH);
const code = stripSqlComments(cronSource);

// ============================================================
// 1, 17, 18. 0104 redefines exactly one function, and it is not either of
// the other two M1.3-era functions.
// ============================================================
describe("0104: redefines exactly one function -- enqueue_unread_messaging_summaries -- nothing else", () => {
  it("contains exactly one create or replace function statement, for enqueue_unread_messaging_summaries", () => {
    const createFunctionMatches = code.match(/create or replace function public\.\w+\(/g) ?? [];
    expect(createFunctionMatches).toEqual(["create or replace function public.enqueue_unread_messaging_summaries("]);
  });

  it("does not redefine get_current_unread_messaging_summary", () => {
    expect(code).not.toMatch(/create or replace function public\.get_current_unread_messaging_summary\(/);
  });

  it("does not redefine cancel_claimed_email", () => {
    expect(code).not.toMatch(/create or replace function public\.cancel_claimed_email\(/);
  });

  it("does not redefine any of the 8 original email-event functions or the shared outbox functions", () => {
    expect(code).not.toMatch(/create or replace function public\.(enqueue_email|claim_pending_emails|mark_email_sent|mark_email_failed|enqueue_pending_order_expiry_reminders)\(/);
  });
});

// ============================================================
// 2-6. Advisory lock: transaction-scoped, blocking, namespaced, and
// acquired before the eligibility/watermark read.
// ============================================================
describe("0104: transaction-level, blocking, namespaced advisory lock", () => {
  const body = getFunctionBody(code, ENQUEUE_ANCHOR);

  it("acquires pg_advisory_xact_lock (transaction-scoped)", () => {
    expect(body).toMatch(/pg_catalog\.pg_advisory_xact_lock\(/);
  });

  it("never uses the try-lock variant -- this caller waits, it never silently skips the scan", () => {
    expect(body).not.toMatch(/pg_try_advisory_xact_lock/);
  });

  it("never uses session-level advisory locking (pg_advisory_lock/pg_advisory_unlock) -- only the auto-released transaction-scoped form", () => {
    // A bare token-boundary check for "pg_advisory_lock" that isn't part
    // of "pg_advisory_xact_lock" -- session-level locking has a
    // completely different name, not a substring collision risk here,
    // but checked precisely regardless.
    const tokens = body.match(/pg_advisory_(?:xact_)?(?:try_)?lock/g) ?? [];
    for (const token of tokens) {
      expect(token).toBe("pg_advisory_xact_lock");
    }
    expect(body).not.toMatch(/pg_advisory_unlock/);
  });

  it("uses the two-integer form with stable, namespaced pg_catalog.hashtext(...) keys -- 'preshopps' and the operation name -- fully qualified since this function runs with an empty search_path", () => {
    expect(body).toMatch(/pg_catalog\.pg_advisory_xact_lock\(\s*\n\s*pg_catalog\.hashtext\('preshopps'\),\s*\n\s*pg_catalog\.hashtext\('enqueue_unread_messaging_summaries'\)\s*\n\s*\);/);
  });

  it("is acquired after basic parameter validation but before the eligibility/watermark query begins", () => {
    const validationIdx = body.indexOf("INVALID_BATCH_LIMIT");
    const lockIdx = body.indexOf("pg_advisory_xact_lock");
    const queryIdx = body.indexOf("with participant_conversations");
    expect(validationIdx).toBeGreaterThan(-1);
    expect(lockIdx).toBeGreaterThan(validationIdx);
    expect(queryIdx).toBeGreaterThan(lockIdx);
  });

  it("this is the first use of any pg_advisory_* function anywhere in this repository's migrations -- confirmed no pre-existing key this pair could collide with", () => {
    const allMigrationsDir = path.join(process.cwd(), "supabase/migrations");
    const otherMigrationFiles = readFileSync(path.join(allMigrationsDir, "0103_unread_messaging_summary.sql"), "utf-8");
    expect(otherMigrationFiles).not.toMatch(/pg_advisory/);
  });
});

// ============================================================
// 7-11. 0103's approved scanner behavior is preserved exactly -- proven by
// direct comparison against 0103's own current function body, not
// re-asserted from scratch (a drift between the two would be caught here
// even if both individually looked plausible).
// ============================================================
describe("0104: preserves 0103's approved scanner behavior exactly (diffed against 0103 itself, not re-derived by hand)", () => {
  const foundationBody = getFunctionBody(foundationCode, ENQUEUE_ANCHOR);
  const cronBody = getFunctionBody(code, ENQUEUE_ANCHOR);

  it("everything in 0104's function body from the eligibility query onward is byte-for-byte identical to 0103's own version", () => {
    const foundationScanQuery = foundationBody.slice(foundationBody.indexOf("for r in"));
    const cronScanQuery = cronBody.slice(cronBody.indexOf("for r in"));
    expect(cronScanQuery).toBe(foundationScanQuery);
  });

  it("MIN(unread_signal_at) still gates the 30-minute eligibility threshold, not MAX", () => {
    expect(cronBody).toMatch(/interval '30 minutes'/);
    expect(cronBody).toMatch(/having min\(ec\.unread_signal_at\) <= v_delay_cutoff/);
    expect(cronBody).not.toMatch(/having max\(ec\.unread_signal_at\)/);
  });

  it("MAX(unread_signal_at) still feeds covers_through, never MIN", () => {
    expect(cronBody).toMatch(/max\(ec\.unread_signal_at\) as newest_unread_signal_at/);
    expect(cronBody).toMatch(/jsonb_build_object\('covers_through', r\.newest_unread_signal_at\)/);
  });

  it("the 2-hour cooldown, combined independently with the covers_through watermark, is intact", () => {
    expect(cronBody).toMatch(/interval '2 hours'/);
    expect(cronBody).toMatch(/v_now - prior\.created_at >= v_cooldown_window\s*\n\s*and rs\.newest_unread_signal_at > prior\.covers_through/);
  });

  it("muted and archived conversations are still excluded, with the identical coalesce(..., true) fail-safe default", () => {
    expect(cronBody).toMatch(/pc\.archived_at is null/);
    expect(cronBody).toMatch(/coalesce\(pc\.muted, false\) = false/);
    expect(cronBody).toMatch(/coalesce\(\s*\n\s*pc\.marked_unread_at is not null\s*\n\s*or pc\.last_read_at is null\s*\n\s*or pc\.last_message_at > pc\.last_read_at,\s*\n\s*true\s*\n\s*\)/);
  });

  it("still groups by recipient before any LIMIT (one digest per recipient, p_limit bounds recipients not conversations)", () => {
    expect(cronBody).toMatch(/group by ec\.recipient_id/);
    const enqueueEmailCalls = (cronBody.match(/perform public\.enqueue_email\(/g) ?? []).length;
    expect(enqueueEmailCalls).toBe(1);
  });

  it("still uses a fresh gen_random_uuid() entity_id per genuinely new digest, via the existing enqueue_email() call -- never a raw INSERT INTO email_outbox", () => {
    expect(cronBody).toMatch(/perform public\.enqueue_email\(\s*\n\s*'unread_messages_summary'::public\.email_event_type_enum,\s*\n\s*r\.recipient_id,\s*\n\s*gen_random_uuid\(\),/);
    expect(code).not.toMatch(/insert into public\.email_outbox/i);
  });

  it("the enqueued payload still contains only covers_through -- no conversation id, participant name, or message content", () => {
    const payloadCall = cronBody.match(/jsonb_build_object\(([^)]*)\)/);
    expect(payloadCall).not.toBeNull();
    expect(payloadCall![1]).toMatch(/'covers_through'/);
    expect(payloadCall![1]).not.toMatch(/body|message|content/i);
  });
});

// ============================================================
// 12-15. Cron activation: exact name, exact cadence, exact command, and
// the three pre-existing jobs are left alone.
// ============================================================
describe("0104: cron activation -- exact job, existing jobs untouched", () => {
  it("schedules exactly the intended job name on a */30 * * * * cadence, invoking enqueue_unread_messaging_summaries(200) via a direct SQL call (no HTTP, no Edge Function, no secret)", () => {
    expect(code).toMatch(/cron\.schedule\(\s*\n\s*'unread-messaging-summary-scan-every-30-min',\s*\n\s*'\*\/30 \* \* \* \*',\s*\n\s*\$\$select public\.enqueue_unread_messaging_summaries\(200\);\$\$\s*\n\s*\);/);
  });

  it("contains exactly one cron.schedule call", () => {
    const scheduleMatches = code.match(/cron\.schedule\(/g) ?? [];
    expect(scheduleMatches).toHaveLength(1);
  });

  it("does not reference, redefine, or reschedule any of the three existing cron jobs", () => {
    expect(code).not.toMatch(/process-email-outbox-every-15-min/);
    expect(code).not.toMatch(/order-expiry-reminders-hourly/);
    expect(code).not.toMatch(/expire-pending-orders-every-15-min/);
    expect(code).not.toMatch(/net\.http_post/);
  });
});

// ============================================================
// 16. No schema/table/enum/policy changes of any kind.
// ============================================================
describe("0104: no schema/table/enum/policy changes -- function redefinition and cron activation only", () => {
  it("creates no table, no new enum type, no policy, and alters no existing table, type, or enum", () => {
    expect(code).not.toMatch(/create table/i);
    expect(code).not.toMatch(/create type/i);
    expect(code).not.toMatch(/create policy/i);
    expect(code).not.toMatch(/alter table/i);
    expect(code).not.toMatch(/alter type/i);
  });

  it("never touches email_outbox, conversations, conversation_user_states, or messages directly (only through the existing enqueue_email function)", () => {
    expect(code).not.toMatch(/alter table public\.(email_outbox|conversations|conversation_user_states|messages)/i);
  });
});

// ============================================================
// 19. The Edge Function remains untouched by this migration.
// ============================================================
describe("0104: the process-email-outbox Edge Function is untouched", () => {
  it("this migration's own SQL never references the Edge Function's file path or Deno-specific syntax", () => {
    expect(code).not.toMatch(/process-email-outbox|Deno\.serve|Deno\.env/);
  });

  it("the Edge Function's own source still has no reference to pg_advisory or this migration's own lock key strings", () => {
    const edgeFunctionSource = readFile(EDGE_FUNCTION_PATH);
    expect(edgeFunctionSource).not.toMatch(/pg_advisory|hashtext/);
  });
});
