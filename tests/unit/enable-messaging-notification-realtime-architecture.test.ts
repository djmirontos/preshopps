import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

function readFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf-8");
}

/** Strips whole-line `--` comments before matching for "never does X"
 * assertions -- this migration's own header prose legitimately discusses
 * grants/REPLICA IDENTITY/RLS by name while explaining what it does NOT
 * do, which would otherwise false-positive a naive substring match. */
function stripSqlComments(source: string): string {
  return source
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
}

const MIGRATION_PATH = "supabase/migrations/0087_enable_messaging_notification_realtime.sql";

/**
 * Locks in the exact, minimal scope of the first Realtime backend slice
 * (per the accepted read-only Realtime audit): add public.messages and
 * public.notifications to the supabase_realtime publication, and nothing
 * else. public.conversations is deliberately excluded -- the accepted
 * architecture derives every conversation-level UI update from the
 * notifications channel instead, so a direct conversations subscription
 * was never required for MVP. This migration must not touch RLS, grants,
 * REPLICA IDENTITY, schema, or any RPC -- those were all reconfirmed
 * unchanged live immediately before and after applying it.
 */
describe("0087 adds exactly messages + notifications to supabase_realtime", () => {
  const source = readFile(MIGRATION_PATH);

  it("adds public.messages to the publication", () => {
    expect(source).toMatch(/alter publication supabase_realtime add table public\.messages;/);
  });

  it("adds public.notifications to the publication", () => {
    expect(source).toMatch(/alter publication supabase_realtime add table public\.notifications;/);
  });

  it("does NOT add public.conversations to the publication", () => {
    expect(source).not.toMatch(/add table public\.conversations/);
    expect(source).not.toMatch(/alter publication supabase_realtime add table[^;]*conversations/i);
  });

  it("touches no other table in any ALTER PUBLICATION statement", () => {
    const addTableMatches = source.match(/alter publication supabase_realtime add table [^;]+;/g) ?? [];
    expect(addTableMatches).toHaveLength(2);
    for (const statement of addTableMatches) {
      expect(statement).toMatch(/public\.(messages|notifications)\b/);
    }
  });

  it("guards each addition with an existence check instead of a broad exception handler -- idempotent without swallowing unrelated errors", () => {
    expect(source).toMatch(/select 1\s*\n\s*from pg_publication_tables\s*\n\s*where pubname = 'supabase_realtime'\s*\n\s*and schemaname = 'public'\s*\n\s*and tablename = 'messages'/);
    expect(source).toMatch(/select 1\s*\n\s*from pg_publication_tables\s*\n\s*where pubname = 'supabase_realtime'\s*\n\s*and schemaname = 'public'\s*\n\s*and tablename = 'notifications'/);
    expect(source).not.toMatch(/exception\s+when/i);
    expect(source).not.toMatch(/begin\s*\n\s*alter publication/i);
  });
});

describe("0087 makes no other backend change", () => {
  const source = readFile(MIGRATION_PATH);
  // Assertions below run against the code only (comments stripped) -- the
  // migration's own header prose legitimately names "grant", "REPLICA
  // IDENTITY", "RLS", etc. while explaining what it deliberately does not
  // do, which would otherwise false-positive a raw substring match.
  const code = stripSqlComments(source);

  it("never creates, alters, or drops a policy", () => {
    expect(code).not.toMatch(/create policy/i);
    expect(code).not.toMatch(/alter policy/i);
    expect(code).not.toMatch(/drop policy/i);
  });

  it("never changes REPLICA IDENTITY on any table", () => {
    expect(code).not.toMatch(/replica identity/i);
  });

  it("never grants or revokes any table/function privilege", () => {
    expect(code).not.toMatch(/\bgrant\b/i);
    expect(code).not.toMatch(/\brevoke\b/i);
  });

  it("never creates or replaces a function/RPC", () => {
    expect(code).not.toMatch(/create (or replace )?function/i);
    expect(code).not.toMatch(/drop function/i);
  });

  it("never touches application schema -- no table/column/type/enum/index/trigger DDL", () => {
    expect(code).not.toMatch(/create table|alter table|drop table/i);
    expect(code).not.toMatch(/add column|drop column|alter column/i);
    expect(code).not.toMatch(/create type|alter type|drop type/i);
    expect(code).not.toMatch(/create index|drop index/i);
    expect(code).not.toMatch(/create trigger|drop trigger/i);
  });

  it("touches only the supabase_realtime publication -- no other publication is referenced", () => {
    const publicationNames = code.match(/alter publication (\w+)/gi) ?? [];
    for (const statement of publicationNames) {
      expect(statement.toLowerCase()).toBe("alter publication supabase_realtime");
    }
    expect(publicationNames.length).toBeGreaterThan(0);
  });
});
