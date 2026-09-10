import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

function readFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf-8");
}

const MIGRATION_PATH = "supabase/migrations/0078_admin_role_management_rpcs.sql";

function getFunctionBody(source: string, anchor: string): string {
  const fnStart = source.indexOf(anchor);
  const bodyStart = source.indexOf("begin\n", fnStart);
  const bodyEnd = source.indexOf("end;\n$$;", bodyStart);
  return source.slice(bodyStart, bodyEnd);
}

const MY_ROLE_ANCHOR = "create or replace function public.get_my_admin_role(";
const USERS_ANCHOR = "create or replace function public.get_admin_users(";
const FIND_ANCHOR = "create or replace function public.find_user_for_role_assignment(";
const GRANT_ANCHOR = "create or replace function public.grant_admin_role(";
const REVOKE_ANCHOR = "create or replace function public.revoke_admin_role(";

const SUPER_ADMIN_CHECK = "if not exists (select 1 from public.user_roles ur where ur.user_id = v_caller and ur.role = 'super_admin') then";

describe("0078 is scoped to exactly five role-management RPCs, no schema change", () => {
  const source = readFile(MIGRATION_PATH);

  it("creates exactly get_my_admin_role, get_admin_users, find_user_for_role_assignment, grant_admin_role, revoke_admin_role", () => {
    const matches = (source.match(/create or replace function public\.\w+\(/g) ?? []).sort();
    expect(matches.sort()).toEqual(
      [
        "create or replace function public.find_user_for_role_assignment(",
        "create or replace function public.get_admin_users(",
        "create or replace function public.get_my_admin_role(",
        "create or replace function public.grant_admin_role(",
        "create or replace function public.revoke_admin_role(",
      ].sort(),
    );
  });

  it("adds no table, enum, or policy", () => {
    expect(source).not.toMatch(/create table|create type|create policy|alter table|drop table/i);
  });

  it("never touches an existing admin-agnostic RPC (0067/0070/0075 stay role-agnostic)", () => {
    expect(source).not.toMatch(/get_admin_reports|get_admin_support_tickets|get_admin_disputes\b/);
  });

  it("never mentions escrow, refund, or payment arbitration", () => {
    expect(source).not.toMatch(/escrow|refund|payment arbitration/i);
  });
});

describe("0078 get_my_admin_role: self-only, role-agnostic by design", () => {
  const source = readFile(MIGRATION_PATH);
  const body = getFunctionBody(source, MY_ROLE_ANCHOR);

  it("returns null for a guest, never raises", () => {
    expect(body).toMatch(/if v_caller is null then\s*\n\s*return null;\s*\n\s*end if;/);
  });

  it("derives the role from auth.uid() only -- no parameter accepts a client-supplied user id", () => {
    expect(source).toMatch(/create or replace function public\.get_my_admin_role\(\s*\)/);
  });

  it("is granted to every authenticated user (self-only data, no privilege concern)", () => {
    expect(source).toMatch(/grant execute on function public\.get_my_admin_role\(\) to authenticated/);
  });
});

describe("0078 get_admin_users / find_user_for_role_assignment: super_admin-only reads", () => {
  const source = readFile(MIGRATION_PATH);

  it("get_admin_users requires super_admin, not merely any admin role", () => {
    const body = getFunctionBody(source, USERS_ANCHOR);
    expect(body).toMatch(SUPER_ADMIN_CHECK);
    expect(body).toMatch(/'NOT_SUPER_ADMIN'/);
  });

  it("get_admin_users joins auth.users for email -- profiles deliberately does not duplicate it", () => {
    const body = getFunctionBody(source, USERS_ANCHOR);
    expect(body).toMatch(/join auth\.users u on u\.id = ur\.user_id/);
  });

  it("get_admin_users returns no pagination params -- the roster is always small", () => {
    const signature = source.slice(USERS_ANCHOR.length + source.indexOf(USERS_ANCHOR), source.indexOf("returns table", source.indexOf(USERS_ANCHOR)));
    expect(signature.trim()).toBe(")");
  });

  it("find_user_for_role_assignment requires super_admin", () => {
    const body = getFunctionBody(source, FIND_ANCHOR);
    expect(body).toMatch(SUPER_ADMIN_CHECK);
    expect(body).toMatch(/'NOT_SUPER_ADMIN'/);
  });

  it("find_user_for_role_assignment requires a non-blank email", () => {
    const body = getFunctionBody(source, FIND_ANCHOR);
    expect(body).toMatch(/'EMAIL_REQUIRED'/);
  });

  it("find_user_for_role_assignment matches case-insensitively and excludes deleted accounts", () => {
    const body = getFunctionBody(source, FIND_ANCHOR);
    expect(body).toMatch(/lower\(u\.email\) = lower\(v_email\)/);
    expect(body).toMatch(/and p\.deleted_at is null/);
  });

  it("find_user_for_role_assignment returns only minimal identity fields, never a browsable directory", () => {
    const returnsBlock = source.slice(
      source.indexOf("returns table", source.indexOf(FIND_ANCHOR)),
      source.indexOf("language plpgsql", source.indexOf(FIND_ANCHOR)),
    );
    expect(returnsBlock).toMatch(/user_id uuid/);
    expect(returnsBlock).toMatch(/display_name text/);
    expect(returnsBlock).toMatch(/email text/);
    expect(returnsBlock).toMatch(/existing_role public\.user_role_enum/);
    expect(returnsBlock).not.toMatch(/avatar|province|city|barangay/);
  });
});

describe("0078 grant_admin_role: super_admin auth, no client-supplied grantor, upsert, lockout guard", () => {
  const source = readFile(MIGRATION_PATH);
  const body = getFunctionBody(source, GRANT_ANCHOR);

  it("requires super_admin", () => {
    expect(body).toMatch(SUPER_ADMIN_CHECK);
    expect(body).toMatch(/'NOT_SUPER_ADMIN'/);
  });

  it("rejects a nonexistent or deleted target before writing anything", () => {
    expect(body).toMatch(/if not exists \(select 1 from public\.profiles p where p\.id = p_user_id and p\.deleted_at is null\) then/);
    expect(body).toMatch(/'TARGET_USER_NOT_FOUND'/);
  });

  it("granted_by is always v_caller (auth.uid()), never a client-supplied parameter", () => {
    expect(source).not.toMatch(/p_granted_by|p_grantor|p_actor/);
    expect(body).toMatch(/values \(p_user_id, p_role, v_caller\)/);
  });

  it("upserts via ON CONFLICT(user_id) -- never risks a duplicate-row unique_violation", () => {
    expect(body).toMatch(/on conflict \(user_id\) do update/);
  });

  it("is idempotent when the target already holds exactly this role -- no audit row on a true no-op", () => {
    expect(body).toMatch(/if v_previous_role is not distinct from p_role then/);
    const idempotentBranch = body.slice(
      body.indexOf("if v_previous_role is not distinct from p_role then"),
      body.indexOf("end if;", body.indexOf("if v_previous_role is not distinct from p_role then")),
    );
    expect(idempotentBranch).not.toMatch(/admin_audit_logs/);
  });

  it("blocks demoting the last remaining super_admin, locking all super_admin rows before counting", () => {
    expect(body).toMatch(/if v_previous_role = 'super_admin' and p_role <> 'super_admin' then/);
    expect(body).toMatch(/perform 1 from public\.user_roles ur where ur\.role = 'super_admin' for update;/);
    expect(body).toMatch(/where ur\.role = 'super_admin' and ur\.user_id <> p_user_id/);
    expect(body).toMatch(/'LAST_SUPER_ADMIN'/);
  });

  it("does not restrict demoting/removing the last plain admin -- only super_admin is protected", () => {
    const lockoutBlock = body.slice(
      body.indexOf("if v_previous_role = 'super_admin' and p_role <> 'super_admin' then"),
      body.indexOf("insert into public.user_roles"),
    );
    expect(lockoutBlock).not.toMatch(/role = 'admin'/);
  });

  it("writes admin_audit_logs distinguishing a fresh grant from a role change", () => {
    expect(body).toMatch(
      /case when v_previous_role is null then 'admin_role_granted' else 'admin_role_changed' end,/,
    );
  });

  it("validates an optional reason's length but never requires one", () => {
    expect(source).toMatch(/create or replace function public\.grant_admin_role\(\s*p_user_id uuid,\s*p_role public\.user_role_enum,\s*p_reason text default null\s*\)/);
    expect(body).toMatch(/'REASON_TOO_LONG'/);
  });

  it("may assign either admin or super_admin -- no CHECK narrows p_role beyond the enum itself", () => {
    expect(body).not.toMatch(/p_role not in|p_role <> 'admin' and p_role <> 'super_admin'/);
  });

  it("is granted to authenticated only (server-side super_admin check gates the real authorization)", () => {
    expect(source).toMatch(/revoke all on function public\.grant_admin_role\(uuid, public\.user_role_enum, text\) from public/);
    expect(source).toMatch(/revoke all on function public\.grant_admin_role\(uuid, public\.user_role_enum, text\) from anon/);
    expect(source).toMatch(/grant execute on function public\.grant_admin_role\(uuid, public\.user_role_enum, text\) to authenticated/);
  });
});

describe("0078 revoke_admin_role: super_admin auth, self-removal-safe lockout, no target-exists re-check", () => {
  const source = readFile(MIGRATION_PATH);
  const body = getFunctionBody(source, REVOKE_ANCHOR);

  it("requires super_admin", () => {
    expect(body).toMatch(SUPER_ADMIN_CHECK);
    expect(body).toMatch(/'NOT_SUPER_ADMIN'/);
  });

  it("rejects a target with no role row at all", () => {
    expect(body).toMatch(/if v_previous_role is null then/);
    expect(body).toMatch(/'TARGET_HAS_NO_ROLE'/);
  });

  it("blocks removing the last remaining super_admin, whether self-removal or another target, via the same invariant", () => {
    expect(body).toMatch(/if v_previous_role = 'super_admin' then/);
    expect(body).toMatch(/perform 1 from public\.user_roles ur where ur\.role = 'super_admin' for update;/);
    expect(body).toMatch(/where ur\.role = 'super_admin' and ur\.user_id <> p_user_id/);
    expect(body).toMatch(/'LAST_SUPER_ADMIN'/);
  });

  it("does not special-case self vs. other-target removal -- one count-based check covers both", () => {
    expect(body).not.toMatch(/v_caller = p_user_id|p_user_id = v_caller/);
  });

  it("deletes the role row outright -- there is no status column to flip", () => {
    expect(body).toMatch(/delete from public\.user_roles where user_id = p_user_id;/);
  });

  it("logs the revocation with the real previous_role and a null new_role", () => {
    expect(body).toMatch(
      /insert into public\.admin_audit_logs \(actor_id, target_user_id, action, previous_role, new_role, reason\)\s*\n\s*values \(v_caller, p_user_id, 'admin_role_revoked', v_previous_role, null, v_reason\);/,
    );
  });

  it("does not re-check profile deletion state -- revoking is always allowed regardless of account state", () => {
    expect(body).not.toMatch(/deleted_at/);
  });

  it("is granted to authenticated only (server-side super_admin check gates the real authorization)", () => {
    expect(source).toMatch(/revoke all on function public\.revoke_admin_role\(uuid, text\) from public/);
    expect(source).toMatch(/revoke all on function public\.revoke_admin_role\(uuid, text\) from anon/);
    expect(source).toMatch(/grant execute on function public\.revoke_admin_role\(uuid, text\) to authenticated/);
  });
});

describe("0078: every RPC is SECURITY DEFINER with empty search_path", () => {
  const source = readFile(MIGRATION_PATH);

  it.each([
    ["get_my_admin_role", MY_ROLE_ANCHOR],
    ["get_admin_users", USERS_ANCHOR],
    ["find_user_for_role_assignment", FIND_ANCHOR],
    ["grant_admin_role", GRANT_ANCHOR],
    ["revoke_admin_role", REVOKE_ANCHOR],
  ])("%s", (_name, anchor) => {
    const fnStart = source.indexOf(anchor);
    const fnHeader = source.slice(fnStart, source.indexOf("as $$", fnStart));
    expect(fnHeader).toMatch(/language plpgsql/);
    expect(fnHeader).toMatch(/security definer/);
    expect(fnHeader).toMatch(/set search_path = ''/);
  });
});
