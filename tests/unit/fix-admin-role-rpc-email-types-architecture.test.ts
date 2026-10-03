import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Source-text architecture tests only -- these assert on the literal SQL
 * in 0109_fix_admin_role_rpc_email_types.sql. They prove the migration
 * casts the returned email expression to text in both functions while
 * reproducing every other signature/authorization/grant detail verbatim
 * from 0078's own live definitions. They do NOT prove the "structure of
 * query does not match function result type" error is actually gone at
 * runtime, or that either RPC now executes successfully end-to-end --
 * that requires a real database (local Supabase CLI or a review/staging
 * branch), which this unit-test suite cannot exercise. See the
 * migration's own header comment and the prior diagnosis (HEAD 0bd620d)
 * for the live-log evidence this fix is based on.
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

const MIGRATION_PATH = "supabase/migrations/0109_fix_admin_role_rpc_email_types.sql";
const GET_ADMIN_USERS_ANCHOR = "create or replace function public.get_admin_users()";
const FIND_USER_ANCHOR = "create or replace function public.find_user_for_role_assignment(";

const source = readFile(MIGRATION_PATH);
const code = stripSqlComments(source);

describe("0109: touches exactly get_admin_users and find_user_for_role_assignment, nothing else structural", () => {
  it("contains exactly two create or replace function statements", () => {
    const createMatches = code.match(/^create or replace function public\.\w+/gm) ?? [];
    expect(createMatches).toEqual([
      "create or replace function public.get_admin_users",
      "create or replace function public.find_user_for_role_assignment",
    ]);
  });

  it("creates or alters no table, type, index, or policy", () => {
    expect(code).not.toMatch(/alter table|create table|alter type|create type|create index|create policy|enable row level security/i);
  });

  it("does not redefine grant_admin_role or revoke_admin_role", () => {
    expect(source).not.toMatch(/create or replace function public\.grant_admin_role/);
    expect(source).not.toMatch(/create or replace function public\.revoke_admin_role/);
  });

  it("does not edit historical migration 0078 -- this is a separate, new file", () => {
    const historical = readFile("supabase/migrations/0078_admin_role_management_rpcs.sql");
    expect(historical).toMatch(/select\s*\n\s*ur\.user_id,\s*\n\s*p\.display_name,\s*\n\s*u\.email,\s*\n\s*ur\.role,/);
    expect(historical).toMatch(/select p\.id, p\.display_name, u\.email, ur\.role/);
  });
});

describe("0109: get_admin_users -- the cast is the only change", () => {
  const body = getFunctionBody(source, GET_ADMIN_USERS_ANCHOR);

  it("casts the returned email expression to text", () => {
    expect(body).toMatch(/u\.email::text,/);
  });

  it("no longer returns the bare, uncast u.email in the select list", () => {
    const selectListMatch = body.match(/return query\s*\n\s*select[\s\S]*?from public\.user_roles ur/);
    expect(selectListMatch).not.toBeNull();
    expect(selectListMatch?.[0]).not.toMatch(/\bu\.email,(?!:)/); // bare "u.email," never appears uncast
    expect(selectListMatch?.[0]).toMatch(/u\.email::text,/);
  });

  it("has the exact same parameter list and RETURNS TABLE shape as 0078", () => {
    expect(source).toMatch(/create or replace function public\.get_admin_users\(\)/);
    expect(source).toMatch(
      /returns table \(\s*\n\s*user_id uuid,\s*\n\s*display_name text,\s*\n\s*email text,\s*\n\s*role public\.user_role_enum,\s*\n\s*granted_by uuid,\s*\n\s*granted_by_display_name text,\s*\n\s*created_at timestamptz\s*\n\)/,
    );
  });

  it("is still SECURITY DEFINER with an empty search_path", () => {
    const fnStart = source.indexOf(GET_ADMIN_USERS_ANCHOR);
    const fnRegion = source.slice(fnStart, source.indexOf("$$;", fnStart) + 3);
    expect(fnRegion).toMatch(/security definer/);
    expect(fnRegion).toMatch(/set search_path = ''/);
  });

  it("still requires authentication, then super_admin, before querying anything", () => {
    expect(body).toMatch(/raise exception 'Authentication required\.' using detail = 'NOT_AUTHENTICATED';/);
    expect(body).toMatch(
      /if not exists \(select 1 from public\.user_roles ur where ur\.user_id = v_caller and ur\.role = 'super_admin'\) then\s*\n\s*raise exception 'Super admin access required\.' using detail = 'NOT_SUPER_ADMIN';/,
    );
  });

  it("still joins profiles/auth.users/profiles(granted_by) exactly as before, ordered by created_at ascending", () => {
    expect(body).toMatch(/join public\.profiles p on p\.id = ur\.user_id/);
    expect(body).toMatch(/join auth\.users u on u\.id = ur\.user_id/);
    expect(body).toMatch(/left join public\.profiles gp on gp\.id = ur\.granted_by/);
    expect(body).toMatch(/order by ur\.created_at asc;/);
  });

  it("grants/revokes are unchanged -- anon still has no access, authenticated still does", () => {
    expect(source).toMatch(/revoke all on function public\.get_admin_users\(\) from public;/);
    expect(source).toMatch(/revoke all on function public\.get_admin_users\(\) from anon;/);
    expect(source).toMatch(/grant execute on function public\.get_admin_users\(\) to authenticated;/);
    expect(source).not.toMatch(/grant execute on function public\.get_admin_users\(\)[^;]*to anon/);
  });
});

describe("0109: find_user_for_role_assignment -- the cast is the only change", () => {
  const body = getFunctionBody(source, FIND_USER_ANCHOR);

  it("casts the returned email expression to text", () => {
    expect(body).toMatch(/select p\.id, p\.display_name, u\.email::text, ur\.role/);
  });

  it("still uses the bare, uncast email only in the WHERE-clause comparison -- never in the returned select list", () => {
    expect(body).toMatch(/where lower\(u\.email\) = lower\(v_email\)/);
    const returnedListMatch = body.match(/return query\s*\n\s*select ([^\n]+)/);
    expect(returnedListMatch).not.toBeNull();
    expect(returnedListMatch?.[1]).not.toMatch(/\bu\.email\b(?!::text)/);
  });

  it("has the exact same parameter list and RETURNS TABLE shape as 0078", () => {
    expect(source).toMatch(/create or replace function public\.find_user_for_role_assignment\(\s*\n\s*p_email text\s*\n\)/);
    expect(source).toMatch(
      /returns table \(\s*\n\s*user_id uuid,\s*\n\s*display_name text,\s*\n\s*email text,\s*\n\s*existing_role public\.user_role_enum\s*\n\)/,
    );
  });

  it("is still SECURITY DEFINER with an empty search_path", () => {
    const fnStart = source.indexOf(FIND_USER_ANCHOR);
    const fnRegion = source.slice(fnStart, source.indexOf("$$;", fnStart) + 3);
    expect(fnRegion).toMatch(/security definer/);
    expect(fnRegion).toMatch(/set search_path = ''/);
  });

  it("still requires authentication, super_admin, and a non-blank email, in that order", () => {
    expect(body).toMatch(/raise exception 'Authentication required\.' using detail = 'NOT_AUTHENTICATED';/);
    expect(body).toMatch(/raise exception 'Super admin access required\.' using detail = 'NOT_SUPER_ADMIN';/);
    expect(body).toMatch(/raise exception 'An email is required\.' using detail = 'EMAIL_REQUIRED';/);

    const authIdx = body.indexOf("NOT_AUTHENTICATED");
    const superAdminIdx = body.indexOf("NOT_SUPER_ADMIN");
    const emailIdx = body.indexOf("EMAIL_REQUIRED");
    expect(authIdx).toBeLessThan(superAdminIdx);
    expect(superAdminIdx).toBeLessThan(emailIdx);
  });

  it("still excludes deleted/anonymized profiles and left-joins user_roles for existing_role", () => {
    expect(body).toMatch(/left join public\.user_roles ur on ur\.user_id = p\.id/);
    expect(body).toMatch(/and p\.deleted_at is null;/);
  });

  it("grants/revokes are unchanged -- anon still has no access, authenticated still does", () => {
    expect(source).toMatch(/revoke all on function public\.find_user_for_role_assignment\(text\) from public;/);
    expect(source).toMatch(/revoke all on function public\.find_user_for_role_assignment\(text\) from anon;/);
    expect(source).toMatch(/grant execute on function public\.find_user_for_role_assignment\(text\) to authenticated;/);
    expect(source).not.toMatch(/grant execute on function public\.find_user_for_role_assignment\(text\)[^;]*to anon/);
  });
});
