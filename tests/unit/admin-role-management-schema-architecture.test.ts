import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

function readFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf-8");
}

const MIGRATION_PATH = "supabase/migrations/0077_admin_role_management_schema.sql";

function getFunctionBody(source: string, anchor: string): string {
  const fnStart = source.indexOf(anchor);
  const bodyStart = source.indexOf("begin\n", fnStart);
  const bodyEnd = source.indexOf("end;\n$$;", bodyStart);
  return source.slice(bodyStart, bodyEnd);
}

/**
 * This migration's own header comment discusses future ALTER TYPE ...
 * ADD VALUE possibilities in prose (documenting that admin_audit_logs can
 * grow later) -- strip `-- ...` line comments before asserting absence of
 * DDL, so the check reflects actual SQL, not commentary about it.
 */
function stripSqlComments(sql: string): string {
  return sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

const BOOTSTRAP_ANCHOR = "create or replace function public.bootstrap_first_super_admin(";

describe("0077 is scoped to admin_audit_logs schema + single bootstrap function", () => {
  const source = readFile(MIGRATION_PATH);

  it("creates exactly one enum, one table, and one function", () => {
    expect(source).toMatch(/create type public\.admin_audit_action_enum as enum \(/);
    expect(source).toMatch(/create table public\.admin_audit_logs \(/);
    expect(source).toMatch(/create or replace function public\.bootstrap_first_super_admin\(/);
    const createFunctionMatches = source.match(/create or replace function public\.\w+\(/g) ?? [];
    expect(createFunctionMatches).toEqual(["create or replace function public.bootstrap_first_super_admin("]);
  });

  it("adds no RLS policy and no role-management RPC (those belong to 0078)", () => {
    expect(source).not.toMatch(/create policy/i);
    expect(source).not.toMatch(/grant_admin_role|revoke_admin_role|get_admin_users|get_my_admin_role|find_user_for_role_assignment/);
  });

  it("does not touch any existing table, enum, or function", () => {
    expect(stripSqlComments(source)).not.toMatch(/alter table|alter type|drop table|drop function/i);
  });

  it("never mentions escrow, refund, or payment arbitration", () => {
    expect(source).not.toMatch(/escrow|refund|payment arbitration/i);
  });
});

describe("0077 admin_audit_action_enum and admin_audit_logs", () => {
  const source = readFile(MIGRATION_PATH);

  it("enum has exactly the three role-management action values", () => {
    const enumBlock = source.slice(
      source.indexOf("create type public.admin_audit_action_enum as enum ("),
      source.indexOf(");", source.indexOf("create type public.admin_audit_action_enum as enum (")),
    );
    expect(enumBlock).toMatch(/'admin_role_granted'/);
    expect(enumBlock).toMatch(/'admin_role_changed'/);
    expect(enumBlock).toMatch(/'admin_role_revoked'/);
  });

  it("actor_id is nullable (bootstrap has no auth.uid()) but ON DELETE RESTRICT once populated", () => {
    expect(source).toMatch(/actor_id uuid references public\.profiles\(id\) on delete restrict,/);
    expect(source).not.toMatch(/actor_id uuid not null/);
  });

  it("target_user_id is required and ON DELETE RESTRICT", () => {
    expect(source).toMatch(/target_user_id uuid not null references public\.profiles\(id\) on delete restrict,/);
  });

  it("caps reason at 1000 characters, matching this schema's established note-length convention", () => {
    expect(source).toMatch(/check \(reason is null or char_length\(reason\) <= 1000\)/);
  });

  it("enforces the role-transition shape per action type at the database level", () => {
    expect(source).toMatch(
      /\(action = 'admin_role_granted' and previous_role is null and new_role is not null\)/,
    );
    expect(source).toMatch(
      /\(action = 'admin_role_changed' and previous_role is not null and new_role is not null and previous_role <> new_role\)/,
    );
    expect(source).toMatch(
      /\(action = 'admin_role_revoked' and previous_role is not null and new_role is null\)/,
    );
  });

  it("indexes by target_user_id for history lookups", () => {
    expect(source).toMatch(/create index admin_audit_logs_target_user_created_at_idx\s*\n\s*on public\.admin_audit_logs \(target_user_id, created_at desc, id desc\);/);
  });
});

describe("0077 bootstrap_first_super_admin: only-when-empty, single-use, service_role-only", () => {
  const source = readFile(MIGRATION_PATH);
  const body = getFunctionBody(source, BOOTSTRAP_ANCHOR);

  it("takes a uuid target, not an email", () => {
    expect(source).toMatch(/create or replace function public\.bootstrap_first_super_admin\(\s*p_user_id uuid\s*\)/);
  });

  it("refuses to run unless user_roles is completely empty", () => {
    expect(body).toMatch(/if exists \(select 1 from public\.user_roles\) then/);
    expect(body).toMatch(/'BOOTSTRAP_ALREADY_USED'/);
  });

  it("does not merely check for an existing super_admin -- checks the whole table is empty", () => {
    expect(body).not.toMatch(/role = 'super_admin'/);
  });

  it("validates the target user exists and is not deleted", () => {
    expect(body).toMatch(/if not exists \(select 1 from public\.profiles p where p\.id = p_user_id and p\.deleted_at is null\) then/);
    expect(body).toMatch(/'TARGET_USER_NOT_FOUND'/);
  });

  it("inserts exactly one super_admin row, never 'admin', with no granted_by (no human actor)", () => {
    expect(body).toMatch(/insert into public\.user_roles \(user_id, role, granted_by\)\s*\n\s*values \(p_user_id, 'super_admin', null\)/);
    expect(body).not.toMatch(/values \(p_user_id, 'admin'/);
  });

  it("logs the bootstrap grant to admin_audit_logs with a null actor (no human caller exists)", () => {
    expect(body).toMatch(
      /insert into public\.admin_audit_logs \(actor_id, target_user_id, action, previous_role, new_role, reason\)\s*\n\s*values \(null, p_user_id, 'admin_role_granted', null, 'super_admin',/,
    );
  });

  it("has no authenticated/anon/public execute grant -- service_role only", () => {
    expect(source).toMatch(/revoke all on function public\.bootstrap_first_super_admin\(uuid\) from public/);
    expect(source).toMatch(/revoke all on function public\.bootstrap_first_super_admin\(uuid\) from anon/);
    expect(source).toMatch(/revoke all on function public\.bootstrap_first_super_admin\(uuid\) from authenticated/);
    expect(source).toMatch(/grant execute on function public\.bootstrap_first_super_admin\(uuid\) to service_role/);
    expect(source).not.toMatch(/grant execute on function public\.bootstrap_first_super_admin\(uuid\) to authenticated/);
    expect(source).not.toMatch(/grant execute on function public\.bootstrap_first_super_admin\(uuid\) to (anon|public)/);
  });

  it("is SECURITY DEFINER with empty search_path, matching this schema's universal convention", () => {
    const fnStart = source.indexOf(BOOTSTRAP_ANCHOR);
    const fnHeader = source.slice(fnStart, source.indexOf("as $$", fnStart));
    expect(fnHeader).toMatch(/language plpgsql/);
    expect(fnHeader).toMatch(/security definer/);
    expect(fnHeader).toMatch(/set search_path = ''/);
  });
});
