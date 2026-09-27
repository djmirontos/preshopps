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

// ============================================================
// 0102 -- enum addition ONLY (Messaging Email Summary, Step M1.1).
// PostgreSQL forbids using a value added to a pre-existing enum type
// inside the same transaction that added it, so this migration must
// contain nothing that could reference the new value beyond the single
// ALTER TYPE statement itself. The scan function, claim-time recheck
// function, cancellation function, cron job, and Edge Function template
// case that actually implement the feature are explicit non-goals of this
// step and belong to a later migration (0103+).
// ============================================================
describe("0102: enum addition only -- no dependent schema/function change", () => {
  const source = readFile(ENUM_MIGRATION_PATH);
  const code = stripSqlComments(source);

  it("adds exactly one enum value: unread_messages_summary, nothing else", () => {
    const addValueMatches = code.match(/alter type public\.\w+ add value '\w+';/g) ?? [];
    expect(addValueMatches).toEqual(["alter type public.email_event_type_enum add value 'unread_messages_summary';"]);
  });

  it("adds the value to the pre-existing email_event_type_enum, not a freshly-created type", () => {
    expect(code).not.toMatch(/create type public\.email_event_type_enum/);
    expect(code).toMatch(/alter type public\.email_event_type_enum add value/);
  });

  it("creates no table, no new enum type, no function, no grant/revoke, no cron job", () => {
    expect(code).not.toMatch(/create table/i);
    expect(code).not.toMatch(/create type/i);
    expect(code).not.toMatch(/create (or replace )?function/i);
    expect(code).not.toMatch(/grant execute|revoke all/i);
    expect(code).not.toMatch(/cron\.schedule/i);
  });

  it("never touches email_outbox, its existing functions, the Edge Function, or messaging tables", () => {
    expect(code).not.toMatch(/alter table public\.email_outbox/i);
    expect(code).not.toMatch(/enqueue_email|claim_pending_emails|mark_email_sent|mark_email_failed/);
    expect(code).not.toMatch(/conversations|conversation_user_states|messages\b/i);
  });

  it("does not itself use the new enum value beyond the ADD VALUE statement that defines it -- only the bare literal appears, never a cast or column reference", () => {
    // The only occurrence of the literal must be the ADD VALUE statement
    // captured above -- a second occurrence anywhere would mean this
    // migration is using the value it just added, which is exactly what
    // must not happen in the same transaction.
    const literalMatches = code.match(/unread_messages_summary/g) ?? [];
    expect(literalMatches).toHaveLength(1);
  });

  it("adds no RLS policy anywhere", () => {
    expect(code).not.toMatch(/create policy/i);
  });

  it("does not implement any of the approved-for-later product decisions (delay, mute exclusion, cooldown) -- those govern a scan function that does not exist in this migration", () => {
    expect(code).not.toMatch(/interval '30 minutes'|interval '2 hours'|muted/i);
  });
});
