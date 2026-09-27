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

const ENUM_MIGRATION_PATH = "supabase/migrations/0102_unread_messaging_summary_enum.sql";
const FOUNDATION_MIGRATION_PATH = "supabase/migrations/0103_unread_messaging_summary.sql";
const BADGE_COUNT_MIGRATION_PATH = "supabase/migrations/0088_exact_unread_badge_counts.sql";

const enumSource = stripSqlComments(readFile(ENUM_MIGRATION_PATH));
const foundationSource = readFile(FOUNDATION_MIGRATION_PATH);
const code = stripSqlComments(foundationSource);
const badgeCountSource = stripSqlComments(readFile(BADGE_COUNT_MIGRATION_PATH));

function getFunctionBody(source: string, anchor: string): string {
  const fnStart = source.indexOf(anchor);
  expect(fnStart).toBeGreaterThan(-1);
  // Captures the whole function definition (declare section included, not
  // just what follows "begin") -- the approved 30-minute/2-hour interval
  // literals live in the declare block, before "begin".
  const bodyEnd = source.indexOf("end;\n$$;", fnStart);
  return source.slice(fnStart, bodyEnd);
}

const ENQUEUE_ANCHOR = "create or replace function public.enqueue_unread_messaging_summaries(";
const CLAIM_TIME_ANCHOR = "create or replace function public.get_current_unread_messaging_summary(";
const CANCEL_ANCHOR = "create or replace function public.cancel_claimed_email(";

// ============================================================
// 1. 0103 is separate from enum migration 0102.
// ============================================================
describe("0103 vs 0102 -- separate migrations, correct enum ownership", () => {
  it("0103 does not itself add the enum value -- it only uses the one 0102 already committed", () => {
    expect(code).not.toMatch(/alter type public\.email_event_type_enum add value/);
  });

  it("0103 is the first migration that actually uses the new enum value (a cast, not merely an ADD VALUE statement)", () => {
    expect(code).toMatch(/'unread_messages_summary'::public\.email_event_type_enum/);
  });

  it("0102 itself still adds exactly one enum value and nothing dependent (re-verified here, not just trusted from the earlier slice)", () => {
    const addValueMatches = enumSource.match(/alter type public\.\w+ add value '\w+';/g) ?? [];
    expect(addValueMatches).toEqual(["alter type public.email_event_type_enum add value 'unread_messages_summary';"]);
    expect(enumSource).not.toMatch(/create (or replace )?function/i);
  });
});

// ============================================================
// 2 & 9. Delay and cooldown windows exist as the approved concrete values.
// ============================================================
describe("0103: approved 30-minute delay and 2-hour cooldown", () => {
  it("gates recipient eligibility on the OLDEST qualifying unread signal (MIN), not the newest -- a newer unread conversation must never reset an older one's own wait", () => {
    const body = getFunctionBody(code, ENQUEUE_ANCHOR);
    expect(body).toMatch(/interval '30 minutes'/);
    expect(body).toMatch(/having min\(ec\.unread_signal_at\) <= v_delay_cutoff/);
    // Guards against the exact regression this correction fixed: MAX must
    // never be the aggregate feeding the eligibility gate.
    expect(body).not.toMatch(/having max\(ec\.unread_signal_at\)/);
  });

  // Structural proof of the approved example, as strongly as a source-text
  // architecture test (no local Postgres in this environment) permits: it
  // asserts the AGGREGATE CHOICE that determines the outcome for that
  // example, not a runtime simulation of actual rows. Given
  // min(10:00, 10:29) = 10:00 and a 30-minute cutoff computed from a 10:30
  // scan time (10:00), `min(...) <= cutoff` evaluates true -- the
  // recipient qualifies because conversation A alone has waited long
  // enough, with conversation B's own later signal (10:29) never entering
  // the eligibility decision at all. A genuine runtime proof of this exact
  // scenario would require fixture rows against a real Postgres instance,
  // which this sandbox does not have.
  it("example: conversation A unread since 10:00, conversation B unread since 10:29, scanned at 10:30 -- the recipient qualifies because A alone has waited the full 30 minutes, and B's own later signal must not suppress that", () => {
    const body = getFunctionBody(code, ENQUEUE_ANCHOR);
    // The eligibility gate is exactly MIN(...) <= cutoff -- confirmed
    // above -- which is what makes this example resolve as approved:
    // min(10:00, 10:29) = 10:00 <= (10:30 - 30min = 10:00) is true,
    // independent of B's own fresher 10:29 signal.
    expect(body).toMatch(/min\(ec\.unread_signal_at\) as oldest_unread_signal_at/);
    expect(body).toMatch(/max\(ec\.unread_signal_at\) as newest_unread_signal_at/);
  });

  it("requires the recipient's prior summary row to be at least 2 hours old before a new one can be enqueued", () => {
    const body = getFunctionBody(code, ENQUEUE_ANCHOR);
    expect(body).toMatch(/interval '2 hours'/);
    expect(body).toMatch(/v_now - prior\.created_at >= v_cooldown_window/);
  });

  it("the claim-time recheck RPC contains neither the delay nor the cooldown -- both are enqueue-time-only concerns", () => {
    const body = getFunctionBody(code, CLAIM_TIME_ANCHOR);
    expect(body).not.toMatch(/interval '30 minutes'|interval '2 hours'|covers_through/);
  });
});

// ============================================================
// 3 & 4. Muted and archived conversations are excluded.
// ============================================================
describe("0103: muted and archived exclusion", () => {
  it("the enqueue scan excludes muted and archived conversations", () => {
    const body = getFunctionBody(code, ENQUEUE_ANCHOR);
    expect(body).toMatch(/pc\.archived_at is null/);
    expect(body).toMatch(/coalesce\(pc\.muted, false\) = false/);
  });

  it("the claim-time recheck RPC excludes muted and archived conversations too", () => {
    const body = getFunctionBody(code, CLAIM_TIME_ANCHOR);
    expect(body).toMatch(/combined\.cus_archived_at is null/);
    expect(body).toMatch(/coalesce\(combined\.cus_muted, false\) = false/);
  });
});

// ============================================================
// 5 & 6. The unread predicate matches the existing authoritative
// semantics exactly, including the fail-safe coalesce default.
// ============================================================
describe("0103: unread predicate matches the existing authoritative semantics (0088), including fail-safe coalesce", () => {
  it("0088's own predicate contains the expected OR-chain and coalesce(..., true) fail-safe shape (sanity check on the reference itself)", () => {
    expect(badgeCountSource).toMatch(/coalesce\(\s*combined\.cus_marked_unread_at is not null\s*\n\s*or combined\.cus_last_read_at is null\s*\n\s*or combined\.conv_last_message_at > combined\.cus_last_read_at,\s*\n\s*true\s*\)/);
  });

  it("the enqueue scan's eligibility predicate uses the identical marked_unread_at / last_read_at / last_message_at OR-chain, wrapped in the same coalesce(..., true) fail-safe default", () => {
    const body = getFunctionBody(code, ENQUEUE_ANCHOR);
    expect(body).toMatch(/coalesce\(\s*pc\.marked_unread_at is not null\s*\n\s*or pc\.last_read_at is null\s*\n\s*or pc\.last_message_at > pc\.last_read_at,\s*\n\s*true\s*\)/);
  });

  it("the claim-time recheck RPC uses the identical OR-chain and coalesce(..., true) fail-safe default", () => {
    const body = getFunctionBody(code, CLAIM_TIME_ANCHOR);
    expect(body).toMatch(/coalesce\(\s*combined\.cus_marked_unread_at is not null\s*\n\s*or combined\.cus_last_read_at is null\s*\n\s*or combined\.conv_last_message_at > combined\.cus_last_read_at,\s*\n\s*true\s*\)/);
  });

  it("both new functions reuse the same initiator-or-shop-owner participant union get_my_unread_conversation_count already uses (no separate/invented membership rule)", () => {
    const enqueueBody = getFunctionBody(code, ENQUEUE_ANCHOR);
    const claimBody = getFunctionBody(code, CLAIM_TIME_ANCHOR);
    expect(enqueueBody).toMatch(/where c\.initiator_id = c\.initiator_id|c\.initiator_id as viewer_id/);
    expect(enqueueBody).toMatch(/join public\.shops s on s\.id = c\.shop_id/);
    expect(claimBody).toMatch(/where c\.initiator_id = p_recipient_user_id/);
    expect(claimBody).toMatch(/where s\.owner_id = p_recipient_user_id/);
  });
});

// ============================================================
// 7 & 8. One grouped summary per recipient; covers_through watermark
// prevents repeated digests for unchanged activity.
// ============================================================
describe("0103: grouping and watermark deduplication", () => {
  it("groups eligible conversations by recipient before deciding whether to enqueue -- one summary per recipient, never one per conversation", () => {
    const body = getFunctionBody(code, ENQUEUE_ANCHOR);
    expect(body).toMatch(/group by ec\.recipient_id/);
    // enqueue_email is called exactly once per loop iteration, and the
    // loop iterates recipient_signals rows (post-GROUP BY), not raw
    // per-conversation rows.
    const enqueueEmailCalls = (body.match(/perform public\.enqueue_email\(/g) ?? []).length;
    expect(enqueueEmailCalls).toBe(1);
    expect(body).toMatch(/for r in\s*\n\s*with participant_conversations/);
  });

  it("compares the recipient's current newest unread signal against the prior summary row's own covers_through watermark, defensively defaulting a missing watermark to -infinity (fail open, not fail closed)", () => {
    const body = getFunctionBody(code, ENQUEUE_ANCHOR);
    expect(body).toMatch(/rs\.newest_unread_signal_at > prior\.covers_through/);
    expect(body).toMatch(/coalesce\(\(eo\.payload ->> 'covers_through'\)::timestamptz, '-infinity'::timestamptz\)/);
  });

  it("looks up the prior watermark from email_outbox by recipient and event_type regardless of that prior row's status (pending/processing/sent/failed/cancelled all count)", () => {
    const body = getFunctionBody(code, ENQUEUE_ANCHOR);
    expect(body).toMatch(/from public\.email_outbox eo\s*\n\s*where eo\.recipient_user_id = rs\.recipient_id\s*\n\s*and eo\.event_type = 'unread_messages_summary'/);
    expect(body).not.toMatch(/eo\.status\s*=/);
  });

  it("a recipient with no prior summary row at all is always eligible (nothing to be newer than, no cooldown to wait out)", () => {
    const body = getFunctionBody(code, ENQUEUE_ANCHOR);
    expect(body).toMatch(/where prior\.created_at is null\s*\n\s*or \(/);
  });

  it("covers_through and the enqueued payload both use the NEWEST unread signal (MAX) -- the oldest signal (MIN) is used only for the eligibility gate above and never reaches the payload or the watermark comparison", () => {
    const body = getFunctionBody(code, ENQUEUE_ANCHOR);
    // The only two places oldest_unread_signal_at may legally appear are
    // its own SELECT definition and the HAVING clause that consumes it --
    // it must never appear a third time (e.g. leaking into the payload).
    const oldestSignalMatches = body.match(/oldest_unread_signal_at/g) ?? [];
    expect(oldestSignalMatches).toHaveLength(1);
    // newest_unread_signal_at, by contrast, must flow all the way through
    // to the actual enqueue_email payload.
    expect(body).toMatch(/select\s*\n\s*rs\.recipient_id,\s*\n\s*rs\.newest_unread_signal_at/);
    expect(body).toMatch(/jsonb_build_object\('covers_through', r\.newest_unread_signal_at\)/);
  });
});

// ============================================================
// 10 & 11. Fresh UUID entity_id; reuses enqueue_email rather than a raw
// insert.
// ============================================================
describe("0103: entity_id and enqueue path", () => {
  it("uses a freshly generated UUID as entity_id for each genuinely new digest, never a derived/reused business key", () => {
    const body = getFunctionBody(code, ENQUEUE_ANCHOR);
    expect(body).toMatch(/perform public\.enqueue_email\(\s*\n\s*'unread_messages_summary'::public\.email_event_type_enum,\s*\n\s*r\.recipient_id,\s*\n\s*gen_random_uuid\(\),/);
  });

  it("enqueues exclusively through the existing enqueue_email function -- no direct INSERT INTO email_outbox anywhere in this migration", () => {
    expect(code).not.toMatch(/insert into public\.email_outbox/i);
    expect(code).toMatch(/perform public\.enqueue_email\(/);
  });
});

// ============================================================
// 12 & 14. No message body/content in either the enqueue payload or the
// claim-time RPC's output.
// ============================================================
describe("0103: no message body or conversation content anywhere in this feature", () => {
  it("the enqueue payload contains only the covers_through bookkeeping timestamp -- no conversation id, participant name, or message content", () => {
    const body = getFunctionBody(code, ENQUEUE_ANCHOR);
    const payloadCall = body.match(/jsonb_build_object\(([^)]*)\)/);
    expect(payloadCall).not.toBeNull();
    expect(payloadCall![1]).toMatch(/'covers_through'/);
    expect(payloadCall![1]).not.toMatch(/body|message|content/i);
  });

  it("the claim-time RPC's own RETURNS TABLE column list contains no body/message/content-shaped column", () => {
    const returnsIdx = code.indexOf(CLAIM_TIME_ANCHOR);
    const returnsTableStart = code.indexOf("returns table (", returnsIdx);
    const returnsTableEnd = code.indexOf(")", returnsTableStart);
    const columnList = code.slice(returnsTableStart, returnsTableEnd);
    expect(columnList).not.toMatch(/body|message|content/i);
  });

  it("the claim-time RPC never selects from public.messages", () => {
    const body = getFunctionBody(code, CLAIM_TIME_ANCHOR);
    expect(body).not.toMatch(/public\.messages/);
  });
});

// ============================================================
// 13. The claim-time RPC genuinely rechecks live state (no caching, no
// reliance on the enqueue-time payload).
// ============================================================
describe("0103: claim-time RPC rechecks live state, not a cached snapshot", () => {
  it("takes the recipient id as an explicit parameter (not auth.uid()) and queries public.conversations/conversation_user_states live, not public.email_outbox", () => {
    const body = getFunctionBody(code, CLAIM_TIME_ANCHOR);
    expect(body).not.toMatch(/auth\.uid\(\)/);
    expect(body).not.toMatch(/public\.email_outbox/);
    expect(body).toMatch(/public\.conversations/);
    expect(body).toMatch(/public\.conversation_user_states/);
  });

  it("returns zero rows (not an error) for a null recipient id, and issues no query in that case", () => {
    const body = getFunctionBody(code, CLAIM_TIME_ANCHOR);
    expect(body).toMatch(/if p_recipient_user_id is null then\s*\n\s*return;\s*\n\s*end if;/);
  });
});

// ============================================================
// 15. cancel_claimed_email only cancels a row still 'processing', and is
// not routed through the retry/backoff path.
// ============================================================
describe("0103: cancel_claimed_email -- claim-time cancellation, not a retry", () => {
  it("only transitions a row still 'processing', via a WHERE guard (not an exception) -- mirrors mark_email_sent's own exact convention", () => {
    const body = getFunctionBody(code, CANCEL_ANCHOR);
    expect(body).toMatch(/where id = p_id and status = 'processing'/);
    expect(body).toMatch(/set status = 'cancelled'/);
  });

  it("never touches attempt_count and never calls mark_email_failed -- a cancellation is not a retryable failure", () => {
    const body = getFunctionBody(code, CANCEL_ANCHOR);
    expect(body).not.toMatch(/attempt_count/);
    expect(body).not.toMatch(/mark_email_failed/);
  });

  it("sanitizes the cancellation reason with the same left(coalesce(nullif(btrim(...)), fallback), 2000) convention mark_email_failed already uses", () => {
    const body = getFunctionBody(code, CANCEL_ANCHOR);
    expect(body).toMatch(/left\(coalesce\(nullif\(btrim\(p_reason\), ''\), '[^']+'\), 2000\)/);
  });
});

// ============================================================
// 16. Grants are narrow and match the verified live cron/service_role
// pattern -- never exposed to anon/authenticated.
// ============================================================
describe("0103: grants are narrow, matching the verified live pattern", () => {
  it("enqueue_unread_messaging_summaries is revoked from public/anon/authenticated and granted only to service_role", () => {
    expect(code).toMatch(/revoke all on function public\.enqueue_unread_messaging_summaries\(integer\) from public;/);
    expect(code).toMatch(/revoke all on function public\.enqueue_unread_messaging_summaries\(integer\) from anon;/);
    expect(code).toMatch(/revoke all on function public\.enqueue_unread_messaging_summaries\(integer\) from authenticated;/);
    expect(code).toMatch(/grant execute on function public\.enqueue_unread_messaging_summaries\(integer\) to service_role;/);
  });

  it("get_current_unread_messaging_summary is revoked from public/anon/authenticated and granted only to service_role", () => {
    expect(code).toMatch(/revoke all on function public\.get_current_unread_messaging_summary\(uuid\) from public;/);
    expect(code).toMatch(/revoke all on function public\.get_current_unread_messaging_summary\(uuid\) from anon;/);
    expect(code).toMatch(/revoke all on function public\.get_current_unread_messaging_summary\(uuid\) from authenticated;/);
    expect(code).toMatch(/grant execute on function public\.get_current_unread_messaging_summary\(uuid\) to service_role;/);
  });

  it("cancel_claimed_email is revoked from public/anon/authenticated and granted only to service_role", () => {
    expect(code).toMatch(/revoke all on function public\.cancel_claimed_email\(uuid, text\) from public;/);
    expect(code).toMatch(/revoke all on function public\.cancel_claimed_email\(uuid, text\) from anon;/);
    expect(code).toMatch(/revoke all on function public\.cancel_claimed_email\(uuid, text\) from authenticated;/);
    expect(code).toMatch(/grant execute on function public\.cancel_claimed_email\(uuid, text\) to service_role;/);
  });

  it("none of the three new functions is ever granted to anon or authenticated", () => {
    expect(code).not.toMatch(/grant execute on function public\.enqueue_unread_messaging_summaries\(integer\) to (anon|authenticated)/);
    expect(code).not.toMatch(/grant execute on function public\.get_current_unread_messaging_summary\(uuid\) to (anon|authenticated)/);
    expect(code).not.toMatch(/grant execute on function public\.cancel_claimed_email\(uuid, text\) to (anon|authenticated)/);
  });

  it("all three functions are SECURITY DEFINER with an empty search_path, matching every other function in this schema", () => {
    for (const anchor of [ENQUEUE_ANCHOR, CLAIM_TIME_ANCHOR, CANCEL_ANCHOR]) {
      const idx = code.indexOf(anchor);
      const nextFewLines = code.slice(idx, idx + 400);
      expect(nextFewLines).toMatch(/security definer/);
      expect(nextFewLines).toMatch(/set search_path = ''/);
    }
  });
});

// ============================================================
// 17 & 18. No cron job is created by this migration -- scheduling is
// deferred to a later migration until the Edge Function recognizes the
// event type. The existing send/process cron job is completely untouched.
// ============================================================
describe("0103: no cron schedule in this migration -- scan function exists but is not auto-invoked", () => {
  it("creates no pg_cron schedule of any kind -- cron.schedule does not appear anywhere in this migration's actual SQL", () => {
    expect(code).not.toMatch(/cron\.schedule\(/);
  });

  it("does not reference, redefine, or reschedule the existing process-email-outbox-every-15-min job", () => {
    expect(code).not.toMatch(/process-email-outbox-every-15-min/);
    expect(code).not.toMatch(/net\.http_post/);
  });

  it("does not touch the existing order-expiry-reminders-hourly job either", () => {
    expect(code).not.toMatch(/order-expiry-reminders-hourly/);
  });

  it("enqueue_unread_messaging_summaries is defined and granted to service_role, but that grant line is the LAST mention of its name in the file -- nothing after it (a cron job, a trigger, a direct call) ever invokes it automatically", () => {
    expect(code).toMatch(/create or replace function public\.enqueue_unread_messaging_summaries\(/);
    const grantStatement = "grant execute on function public.enqueue_unread_messaging_summaries(integer) to service_role;";
    expect(code).toContain(grantStatement);

    const allMentions = [...code.matchAll(/enqueue_unread_messaging_summaries/g)];
    const lastMentionIndex = allMentions[allMentions.length - 1].index!;
    const grantStatementIndex = code.lastIndexOf(grantStatement);
    // The last occurrence of the function's name anywhere in the file
    // must fall inside this exact grant statement, not after it.
    expect(lastMentionIndex).toBeGreaterThanOrEqual(grantStatementIndex);
    expect(lastMentionIndex).toBeLessThan(grantStatementIndex + grantStatement.length);
  });
});

// ============================================================
// 19. Every existing email event/function/table is completely untouched.
// ============================================================
describe("0103: existing email_outbox architecture and event types are untouched", () => {
  it("does not redefine any of the five existing outbox functions", () => {
    expect(code).not.toMatch(/create or replace function public\.enqueue_email\(/);
    expect(code).not.toMatch(/create or replace function public\.claim_pending_emails\(/);
    expect(code).not.toMatch(/create or replace function public\.mark_email_sent\(/);
    expect(code).not.toMatch(/create or replace function public\.mark_email_failed\(/);
    expect(code).not.toMatch(/create or replace function public\.enqueue_pending_order_expiry_reminders\(/);
  });

  it("does not alter the email_outbox table or its enums", () => {
    expect(code).not.toMatch(/alter table public\.email_outbox/i);
    expect(code).not.toMatch(/alter type public\.email_outbox_status_enum/i);
    expect(code).not.toMatch(/alter type public\.email_event_type_enum/i);
  });

  it("this migration's own SQL never references the Edge Function's file path or Deno-specific syntax -- a SQL migration has no business touching a Deno file at all", () => {
    // NOTE: an earlier version of this test instead asserted that the
    // Edge Function's OWN source had no case for 'unread_messages_summary'
    // yet -- that was true only as a snapshot of this migration's own
    // moment in time (M1.2), not a durable property of this migration
    // file itself. A later, separate, explicitly-approved step (M1.3)
    // deliberately added that case to the Edge Function -- correctly, not
    // as a violation of anything 0103 itself claims. This migration's own
    // SQL text (`code`, below) genuinely never referenced that file either
    // before or after that later change, which is the actual durable
    // claim worth asserting here.
    expect(code).not.toMatch(/process-email-outbox|Deno\.serve|Deno\.env/);
  });
});
