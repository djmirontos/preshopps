import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Source-text architecture tests only -- these assert on the literal SQL
 * in 0111_fix_grant_admin_role_audit_action_type.sql. They prove the
 * migration casts the audit-action CASE expression to the correct enum
 * type while reproducing 0110's own conflict-target fix and every other
 * line of grant_admin_role verbatim. They do NOT prove the "column
 * "action" is of type public.admin_audit_action_enum but expression is
 * of type text" error is actually gone at runtime, or that a real role
 * grant now succeeds end-to-end -- that requires a real database (local
 * Supabase CLI or a review/staging branch), which this unit-test suite
 * cannot exercise. See the migration's own header comment and the prior
 * diagnosis (HEAD 9d5aff3) for the live-log evidence this fix is based
 * on.
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

const MIGRATION_PATH = "supabase/migrations/0111_fix_grant_admin_role_audit_action_type.sql";
const PRIOR_MIGRATION_PATH = "supabase/migrations/0110_fix_grant_admin_role_conflict_target.sql";
const GRANT_ANCHOR = "create or replace function public.grant_admin_role(";

const source = readFile(MIGRATION_PATH);
const code = stripSqlComments(source);
const body = getFunctionBody(source, GRANT_ANCHOR);

describe("0111: touches exactly grant_admin_role, nothing else structural", () => {
  it("contains exactly one create or replace function statement", () => {
    const createMatches = code.match(/^create or replace function public\.\w+/gm) ?? [];
    expect(createMatches).toEqual(["create or replace function public.grant_admin_role"]);
  });

  it("creates or alters no table, type, index, or policy", () => {
    expect(code).not.toMatch(/alter table|create table|alter type|create type|create index|create policy|enable row level security/i);
  });

  it("does not redefine revoke_admin_role or bootstrap_first_super_admin", () => {
    expect(source).not.toMatch(/create or replace function public\.revoke_admin_role/);
    expect(source).not.toMatch(/create or replace function public\.bootstrap_first_super_admin/);
  });

  it("does not edit historical migrations 0078 or 0110", () => {
    const h0078 = readFile("supabase/migrations/0078_admin_role_management_rpcs.sql");
    const h0110 = readFile(PRIOR_MIGRATION_PATH);
    expect(h0078).toMatch(/case when v_previous_role is null then 'admin_role_granted' else 'admin_role_changed' end,/);
    expect(h0110).toMatch(/case when v_previous_role is null then 'admin_role_granted' else 'admin_role_changed' end,/);
    expect(h0110).not.toMatch(/::public\.admin_audit_action_enum/);
  });
});

describe("0111: preserves 0110's own conflict-target fix", () => {
  it("still names the conflict target by its unique constraint, not the ambiguous bare column", () => {
    expect(body).toMatch(/on conflict on constraint user_roles_user_id_key do update/);
    expect(body).not.toMatch(/on conflict \(user_id\)/);
  });
});

describe("0111: the audit-action cast is the only change", () => {
  it("casts the CASE expression to the enum type", () => {
    expect(body).toMatch(
      /\(case when v_previous_role is null then 'admin_role_granted' else 'admin_role_changed' end\)::public\.admin_audit_action_enum,/,
    );
  });

  it("no longer leaves the CASE expression's result uncast", () => {
    expect(body).not.toMatch(/case when v_previous_role is null then 'admin_role_granted' else 'admin_role_changed' end,/);
  });

  it("the remaining admin_audit_logs columns and their values are unchanged", () => {
    expect(body).toMatch(
      /insert into public\.admin_audit_logs \(actor_id, target_user_id, action, previous_role, new_role, reason\)\s*\n\s*values \(\s*\n\s*v_caller,\s*\n\s*p_user_id,/,
    );
    expect(body).toMatch(/::public\.admin_audit_action_enum,\s*\n\s*v_previous_role,\s*\n\s*p_role,\s*\n\s*v_reason\s*\n\s*\);/);
  });
});

describe("0111: grant_admin_role signature, security settings, and grants are preserved", () => {
  it("has the exact same parameter list as 0078/0110", () => {
    expect(source).toMatch(
      /create or replace function public\.grant_admin_role\(\s*\n\s*p_user_id uuid,\s*\n\s*p_role public\.user_role_enum,\s*\n\s*p_reason text default null\s*\n\)/,
    );
  });

  it("has the exact same RETURNS TABLE shape, including the user_id OUT parameter name -- not renamed", () => {
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

describe("0111: every existing grant_admin_role behavior is preserved verbatim", () => {
  it("still requires authentication, then super_admin, then a valid target, in that order", () => {
    const authIdx = body.indexOf("NOT_AUTHENTICATED");
    const superAdminIdx = body.indexOf("NOT_SUPER_ADMIN");
    const targetIdx = body.indexOf("TARGET_USER_NOT_FOUND");
    expect(authIdx).toBeGreaterThan(-1);
    expect(authIdx).toBeLessThan(superAdminIdx);
    expect(superAdminIdx).toBeLessThan(targetIdx);
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

  it("still enforces the last-super-admin lockout before any write", () => {
    expect(body).toMatch(/if v_previous_role = 'super_admin' and p_role <> 'super_admin' then/);
    expect(body).toMatch(/raise exception 'Cannot demote the last remaining super admin\.' using detail = 'LAST_SUPER_ADMIN';/);

    const lockoutIdx = body.indexOf("LAST_SUPER_ADMIN");
    const insertIdx = body.indexOf("insert into public.user_roles");
    expect(lockoutIdx).toBeLessThan(insertIdx);
  });

  it("still writes exactly one admin_audit_logs row, after the upsert", () => {
    const auditMatches = body.match(/insert into public\.admin_audit_logs/g) ?? [];
    expect(auditMatches).toHaveLength(1);

    const upsertIdx = body.indexOf("insert into public.user_roles");
    const auditIdx = body.indexOf("insert into public.admin_audit_logs");
    expect(auditIdx).toBeGreaterThan(upsertIdx);
  });
});
