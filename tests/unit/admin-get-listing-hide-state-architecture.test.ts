import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Source-text architecture tests only -- these assert on the literal SQL
 * in 0112_admin_get_listing_hide_state.sql. They prove the reader has the
 * intended signature, authorization order, read-only shape, distinct
 * LISTING_NOT_FOUND path, alias-qualified references, and grants.
 *
 * They do NOT prove the function executes correctly at runtime: that a
 * visible listing returns a null hidden_by_admin_at, that a hidden one
 * returns its timestamp, that a nonexistent listing raises
 * LISTING_NOT_FOUND, or that a non-admin is rejected. Those require a real
 * database and a real authenticated session (local Supabase CLI or a
 * review/staging branch), which this unit-test suite cannot exercise.
 */

function readFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf-8");
}

function stripSqlComments(sql: string): string {
  return sql
    .split("\n")
    .map((line) => line.replace(/--.*/, ""))
    .join("\n");
}

function getFunctionBody(source: string, anchor: string): string {
  const fnStart = source.indexOf(anchor);
  expect(fnStart).toBeGreaterThan(-1);
  const bodyStart = source.indexOf("begin\n", fnStart);
  const bodyEnd = source.indexOf("end;\n$$;", bodyStart);
  return source.slice(bodyStart, bodyEnd);
}

const MIGRATION_PATH = "supabase/migrations/0112_admin_get_listing_hide_state.sql";
const FN_ANCHOR = "create or replace function public.admin_get_listing_hide_state(";

const source = readFile(MIGRATION_PATH);
const code = stripSqlComments(source);
const body = getFunctionBody(source, FN_ANCHOR);

describe("0112: touches exactly admin_get_listing_hide_state, nothing else", () => {
  it("contains exactly one create or replace function statement", () => {
    const createMatches = code.match(/^create or replace function public\.\w+/gm) ?? [];
    expect(createMatches).toEqual(["create or replace function public.admin_get_listing_hide_state"]);
  });

  it("does not redefine admin_hide_listing or admin_unhide_listing", () => {
    expect(source).not.toMatch(/create or replace function public\.admin_hide_listing/);
    expect(source).not.toMatch(/create or replace function public\.admin_unhide_listing/);
  });

  it("creates or alters no table, type, index, or policy", () => {
    expect(code).not.toMatch(/alter table|create table|alter type|create type|create index|create policy|enable row level security/i);
  });
});

describe("0112: read-only -- no write, lock, or audit insertion", () => {
  it("contains no insert, update, or delete statement", () => {
    expect(code).not.toMatch(/\binsert\s+into\b/i);
    expect(code).not.toMatch(/\bupdate\s+public\./i);
    expect(code).not.toMatch(/\bdelete\s+from\b/i);
  });

  it("takes no row lock -- no for update / for share / for no key update clause", () => {
    expect(code).not.toMatch(/\bfor\s+(update|share|no\s+key\s+update|key\s+share)\b/i);
  });

  it("writes no audit or moderation row", () => {
    expect(code).not.toMatch(/admin_audit_logs/);
    expect(code).not.toMatch(/listing_moderation_actions/);
  });
});

describe("0112: signature, return shape, and security settings", () => {
  it("takes exactly one uuid parameter, p_listing_id", () => {
    expect(source).toMatch(/create or replace function public\.admin_get_listing_hide_state\(p_listing_id uuid\)/);
  });

  it("returns exactly listing_id uuid and hidden_by_admin_at timestamptz", () => {
    expect(source).toMatch(/returns table \(listing_id uuid, hidden_by_admin_at timestamptz\)/);
  });

  it("is SECURITY DEFINER with an empty search_path", () => {
    const fnStart = source.indexOf(FN_ANCHOR);
    const fnRegion = source.slice(fnStart, source.indexOf("$$;", fnStart) + 3);
    expect(fnRegion).toMatch(/security definer/);
    expect(fnRegion).toMatch(/set search_path = ''/);
  });
});

describe("0112: authorization mirrors admin_hide_listing, in the same order", () => {
  it("authenticates first, raising NOT_AUTHENTICATED when there is no caller", () => {
    expect(body).toMatch(/v_caller := auth\.uid\(\);/);
    expect(body).toMatch(/if v_caller is null then\s*\n\s*raise exception 'Authentication required\.' using detail = 'NOT_AUTHENTICATED';/);
  });

  it("then checks the trusted public.user_roles table before reading any listing", () => {
    expect(body).toMatch(
      /if not exists \(select 1 from public\.user_roles ur where ur\.user_id = v_caller\) then\s*\n\s*raise exception 'Admin access required\.' using detail = 'NOT_ADMIN';/,
    );
  });

  it("performs the listing read only after both authorization checks", () => {
    const authIdx = body.indexOf("NOT_AUTHENTICATED");
    const adminIdx = body.indexOf("NOT_ADMIN");
    const readIdx = body.indexOf("from public.listings l");
    expect(authIdx).toBeGreaterThan(-1);
    expect(authIdx).toBeLessThan(adminIdx);
    expect(adminIdx).toBeLessThan(readIdx);
  });

  it("does not trust any client-supplied role or user id -- caller derived only from auth.uid()", () => {
    expect(body).not.toMatch(/p_user_id|p_role|p_admin/);
  });
});

describe("0112: LISTING_NOT_FOUND is distinct from a visible listing with null hidden state", () => {
  it("raises LISTING_NOT_FOUND when the listing row does not exist", () => {
    expect(body).toMatch(/if not found then\s*\n\s*raise exception 'Listing not found\.' using detail = 'LISTING_NOT_FOUND';/);
  });

  it("checks not found immediately after the select into, before any return", () => {
    const selectIdx = body.indexOf("select l.hidden_by_admin_at into v_hidden_at");
    const notFoundIdx = body.indexOf("if not found then");
    const returnIdx = body.indexOf("return query");
    expect(selectIdx).toBeGreaterThan(-1);
    expect(selectIdx).toBeLessThan(notFoundIdx);
    expect(notFoundIdx).toBeLessThan(returnIdx);
  });

  it("returns the state for an existing listing without treating a null hidden_by_admin_at as not-found", () => {
    expect(body).toMatch(/return query\s*\n\s*select p_listing_id, v_hidden_at;/);
  });
});

describe("0112: alias-qualified references -- no bare OUT-parameter identifiers in the body", () => {
  it("reads through the listings alias l, never a bare column name", () => {
    expect(body).toMatch(/select l\.hidden_by_admin_at into v_hidden_at/);
    expect(body).toMatch(/from public\.listings l/);
    expect(body).toMatch(/where l\.id = p_listing_id;/);
  });

  it("has no bare listing_id token in the executable body", () => {
    expect(body).not.toMatch(/(?<![\w.])listing_id(?![\w])/);
  });

  it("has no bare hidden_by_admin_at token outside the l. alias", () => {
    expect(body).not.toMatch(/(?<!l\.)\bhidden_by_admin_at\b/);
  });
});

describe("0112: grants -- authenticated only, never PUBLIC or anon", () => {
  it("revokes execute from public and anon", () => {
    expect(source).toMatch(/revoke all on function public\.admin_get_listing_hide_state\(uuid\) from public;/);
    expect(source).toMatch(/revoke all on function public\.admin_get_listing_hide_state\(uuid\) from anon;/);
  });

  it("grants execute to authenticated", () => {
    expect(source).toMatch(/grant execute on function public\.admin_get_listing_hide_state\(uuid\) to authenticated;/);
  });

  it("grants execute to no role other than authenticated", () => {
    expect(source).not.toMatch(/grant execute on function public\.admin_get_listing_hide_state\([^;]*to anon/);
    expect(source).not.toMatch(/grant execute on function public\.admin_get_listing_hide_state\([^;]*to public/);
  });
});
