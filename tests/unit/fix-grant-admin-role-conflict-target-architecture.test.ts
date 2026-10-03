import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Source-text architecture tests only -- these assert on the literal SQL
 * in 0110_fix_grant_admin_role_conflict_target.sql. They prove the
 * migration names the conflict target by constraint instead of by the
 * ambiguous bare column, while reproducing every other line of
 * grant_admin_role verbatim from its current authoritative (0078) body.
 * They do NOT prove the "column reference \"user_id\" is ambiguous" error
 * is actually gone at runtime, or that the RPC now executes successfully
 * end-to-end -- that requires a real database (local Supabase CLI or a
 * review/staging branch), which this unit-test suite cannot exercise.
 * See the migration's own header comment and the prior diagnosis (HEAD
 * 2de981c) for the live-log evidence this fix is based on.
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

const MIGRATION_PATH = "supabase/migrations/0110_fix_grant_admin_role_conflict_target.sql";
const PRIOR_MIGRATION_PATH = "supabase/migrations/0078_admin_role_management_rpcs.sql";
const GRANT_ANCHOR = "create or replace function public.grant_admin_role(";

const source = readFile(MIGRATION_PATH);
const code = stripSqlComments(source);
const body = getFunctionBody(source, GRANT_ANCHOR);

describe("0110: touches exactly grant_admin_role, nothing else structural", () => {
  it("contains exactly one create or replace function statement", () => {
    const createMatches = code.match(/^create or replace function public\.\w+/gm) ?? [];
    expect(createMatches).toEqual(["create or replace function public.grant_admin_role"]);
  });

  it("creates or alters no table, type, index, or policy", () => {
    expect(code).not.toMatch(/alter table|create table|alter type|create type|create index|create policy|enable row level security/i);
  });

  it("does not redefine revoke_admin_role or bootstrap_first_super_admin -- confirmed unaffected by source review, not touched here", () => {
    expect(source).not.toMatch(/create or replace function public\.revoke_admin_role/);
    expect(source).not.toMatch(/create or replace function public\.bootstrap_first_super_admin/);
  });

  it("does not edit historical migration 0078 -- this is a separate, new file", () => {
    const historical = readFile(PRIOR_MIGRATION_PATH);
    expect(historical).toMatch(/on conflict \(user_id\) do update/);
    expect(historical).not.toMatch(/on conflict on constraint user_roles_user_id_key/);
  });
});

describe("0110: the conflict target is the only change", () => {
  it("names the conflict target by its unique constraint, not the ambiguous bare column", () => {
    expect(body).toMatch(/on conflict on constraint user_roles_user_id_key do update/);
    expect(body).not.toMatch(/on conflict \(user_id\)/);
  });

  it("the UPDATE SET clause and its target columns are unchanged", () => {
    expect(body).toMatch(
      /on conflict on constraint user_roles_user_id_key do update\s*\n\s*set role = excluded\.role,\s*\n\s*granted_by = excluded\.granted_by,\s*\n\s*created_at = now\(\);/,
    );
  });

  it("the insert's own target-column list and values are unchanged", () => {
    expect(body).toMatch(
      /insert into public\.user_roles \(user_id, role, granted_by\)\s*\n\s*values \(p_user_id, p_role, v_caller\)/,
    );
  });
});

describe("0110: grant_admin_role signature, security settings, and grants are preserved from 0078", () => {
  it("has the exact same parameter list as 0078", () => {
    expect(source).toMatch(
      /create or replace function public\.grant_admin_role\(\s*\n\s*p_user_id uuid,\s*\n\s*p_role public\.user_role_enum,\s*\n\s*p_reason text default null\s*\n\)/,
    );
  });

  it("has the exact same RETURNS TABLE shape as 0078, including the user_id OUT parameter name -- not renamed", () => {
    expect(source).toMatch(
      /returns table \(\s*\n\s*user_id uuid,\s*\n\s*role public\.user_role_enum,\s*\n\s*previous_role public\.user_role_enum\s*\n\)/,
    );
  });

  it("is still SECURITY DEFINER with an empty search_path", () => {
    const fnStart = source.indexOf(GRANT_ANCHOR);
    const fnRegion = source.slice(fnStart, source.indexOf("$$;", fnStart) + 3);
    expect(fnRegion).toMatch(/security definer/);
    expect(fnRegion).toMatch(/set search_path = ''/);
  });

  it("grants/revokes are unchanged -- anon still has no access, authenticated still does", () => {
    expect(source).toMatch(/revoke all on function public\.grant_admin_role\(uuid, public\.user_role_enum, text\) from public;/);
    expect(source).toMatch(/revoke all on function public\.grant_admin_role\(uuid, public\.user_role_enum, text\) from anon;/);
    expect(source).toMatch(/grant execute on function public\.grant_admin_role\(uuid, public\.user_role_enum, text\) to authenticated;/);
    expect(source).not.toMatch(/grant execute on function public\.grant_admin_role\([^;]*to anon/);
  });
});

describe("0110: every existing grant_admin_role behavior is preserved verbatim", () => {
  it("still requires authentication, then super_admin, then a valid target, in that order", () => {
    const authIdx = body.indexOf("NOT_AUTHENTICATED");
    const superAdminIdx = body.indexOf("NOT_SUPER_ADMIN");
    const targetIdx = body.indexOf("TARGET_USER_NOT_FOUND");
    expect(authIdx).toBeGreaterThan(-1);
    expect(authIdx).toBeLessThan(superAdminIdx);
    expect(superAdminIdx).toBeLessThan(targetIdx);
  });

  it("still caps the reason at 1000 characters", () => {
    expect(body).toMatch(/if v_reason is not null and char_length\(v_reason\) > 1000 then\s*\n\s*raise exception 'Please shorten the reason\.' using detail = 'REASON_TOO_LONG';/);
  });

  it("still locks the target's existing role row before deciding anything", () => {
    expect(body).toMatch(
      /select ur\.role into v_previous_role\s*\n\s*from public\.user_roles ur\s*\n\s*where ur\.user_id = p_user_id\s*\n\s*for update;/,
    );
  });

  it("still returns early (no write) on the idempotent same-role branch", () => {
    const idempotentIdx = body.indexOf("return query select p_user_id, p_role, v_previous_role;\n    return;");
    const insertIdx = body.indexOf("insert into public.user_roles");
    expect(idempotentIdx).toBeGreaterThan(-1);
    expect(idempotentIdx).toBeLessThan(insertIdx);
  });

  it("still enforces the last-super-admin lockout before any write, locking every super_admin row first", () => {
    expect(body).toMatch(/if v_previous_role = 'super_admin' and p_role <> 'super_admin' then/);
    expect(body).toMatch(/perform 1 from public\.user_roles ur where ur\.role = 'super_admin' for update;/);
    expect(body).toMatch(/raise exception 'Cannot demote the last remaining super admin\.' using detail = 'LAST_SUPER_ADMIN';/);

    const lockoutIdx = body.indexOf("LAST_SUPER_ADMIN");
    const insertIdx = body.indexOf("insert into public.user_roles");
    expect(lockoutIdx).toBeLessThan(insertIdx);
  });

  it("still writes exactly one admin_audit_logs row, after the upsert, with the correct granted/changed action", () => {
    const auditMatches = body.match(/insert into public\.admin_audit_logs/g) ?? [];
    expect(auditMatches).toHaveLength(1);

    const upsertIdx = body.indexOf("insert into public.user_roles");
    const auditIdx = body.indexOf("insert into public.admin_audit_logs");
    expect(auditIdx).toBeGreaterThan(upsertIdx);

    expect(body).toMatch(
      /case when v_previous_role is null then 'admin_role_granted' else 'admin_role_changed' end,/,
    );
  });
});
