import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Source-text architecture tests only -- these assert on the literal SQL in
 * 0108_enable_commerce_tables_rls.sql, nothing more. They prove the
 * migration file contains exactly the six intended ENABLE ROW LEVEL
 * SECURITY statements and nothing else (no FORCE, no new policy, no
 * grant/revoke, no data/function change). They do NOT prove this migration
 * actually runs cleanly against a fresh database, that RLS behaves as
 * expected once enabled, or that no legitimate access path breaks at
 * runtime -- that requires a real database (local Supabase CLI
 * `db reset` or a review/staging branch), which this unit-test suite
 * cannot exercise. See the migration's own header comment and the prior
 * validation report (HEAD bdc0df6) for the live-database evidence this
 * migration is based on.
 */

function readFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf-8");
}

/** Mirrors 0105/0106/0107's own identical helper -- strips `-- ...` line
 * comments before asserting equality/absence, so tests check actual SQL,
 * not the explanatory prose around it. No trailing `$` anchor: this repo's
 * git config normalizes to CRLF on checkout (core.autocrlf=true), and a
 * lone trailing `\r` left on each split line (after splitting on `\n`
 * alone) defeats a `$`-anchored match -- JS regex's "matches before a
 * final line terminator" exception for `$` covers `\n`, not a bare `\r`.
 * Dropping `$` avoids depending on that exception at all. */
function stripSqlComments(sql: string): string {
  return sql
    .split("\n")
    .map((line) => line.replace(/--.*/, ""))
    .join("\n");
}

const MIGRATION_PATH = "supabase/migrations/0108_enable_commerce_tables_rls.sql";
const source = readFile(MIGRATION_PATH);
const codeOnly = stripSqlComments(source);

const INTENDED_TABLES = ["orders", "order_items", "order_cancellation_requests", "carts", "cart_items", "favorites"] as const;

describe("0108 enable_commerce_tables_rls: exactly six ENABLE ROW LEVEL SECURITY statements, nothing else", () => {
  it.each(INTENDED_TABLES)("enables row level security on public.%s", (table) => {
    const pattern = new RegExp(`alter table public\\.${table}\\s+enable row level security;`);
    expect(codeOnly).toMatch(pattern);
  });

  it("contains exactly six ALTER TABLE statements total -- no table beyond the six intended ones", () => {
    const alterTableMatches = codeOnly.match(/alter table\s+public\.\w+/g) ?? [];
    expect(alterTableMatches).toHaveLength(6);
  });

  it("every ALTER TABLE statement enables row level security -- never force, never disables it", () => {
    const alterTableLines = codeOnly
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => /^alter table\s+public\.\w+/.test(line));
    expect(alterTableLines).toHaveLength(6);
    for (const line of alterTableLines) {
      expect(line).toMatch(/enable row level security;$/);
    }
    expect(codeOnly).not.toMatch(/force row level security/i);
    expect(codeOnly).not.toMatch(/disable row level security/i);
  });

  it("creates no new policy -- favorites_select_own is already defined in 0037, not redefined here", () => {
    expect(codeOnly).not.toMatch(/create policy/i);
    expect(codeOnly).not.toMatch(/drop policy/i);
    expect(codeOnly).not.toMatch(/alter policy/i);
  });

  it("does not audit or change table privileges -- no grant/revoke statement of any kind", () => {
    expect(codeOnly).not.toMatch(/\bgrant\b/i);
    expect(codeOnly).not.toMatch(/\brevoke\b/i);
  });

  it("makes no data, function, type, index, or constraint change -- RLS-enablement only", () => {
    expect(codeOnly).not.toMatch(/create (or replace )?function|drop function/i);
    expect(codeOnly).not.toMatch(/create table|drop table|create type|drop type/i);
    expect(codeOnly).not.toMatch(/create index|drop index|add constraint|drop constraint/i);
    expect(codeOnly).not.toMatch(/^\s*(insert into|update\s+public\.|delete from)/im);
  });

  it("touches no table outside the six documented commerce tables", () => {
    const touchedTables = (codeOnly.match(/alter table\s+public\.(\w+)/g) ?? []).map((m) => m.replace(/alter table\s+public\./, ""));
    for (const table of touchedTables) {
      expect(INTENDED_TABLES).toContain(table);
    }
  });

  it("the migration's own comment documents the live-already-enabled rationale, matching the validated finding", () => {
    expect(source).toMatch(/already have RLS enabled in production/i);
    expect(source).toMatch(/favorites_select_own/);
    expect(source).toMatch(/does not audit or change table privileges/i);
  });
});
