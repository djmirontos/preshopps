import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

function readFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf-8");
}

const MIGRATION_PATH = "supabase/migrations/0070_admin_support_ticket_rpcs.sql";

describe("0070 is scoped to exactly two new admin read RPCs -- no schema/enum/policy change", () => {
  const source = readFile(MIGRATION_PATH);

  it("creates get_admin_support_tickets and get_admin_support_ticket_detail, nothing else", () => {
    expect(source).toMatch(/create or replace function public\.get_admin_support_tickets\(/);
    expect(source).toMatch(/create or replace function public\.get_admin_support_ticket_detail\(/);
    expect(source).not.toMatch(/create table|alter table|drop table/i);
    expect(source).not.toMatch(/create type|alter type|drop type/i);
    expect(source).not.toMatch(/create policy|alter policy|drop policy/i);
  });

  it("never redefines submit_support_ticket or any other existing RPC", () => {
    expect(source).not.toMatch(/create or replace function public\.submit_support_ticket/i);
    expect(source).not.toMatch(/create or replace function public\.(create|update)_listing\(/i);
    expect(source).not.toMatch(/create or replace function public\.submit_report/i);
  });

  it("invents no mutable status/workflow column or resolve-style RPC", () => {
    const code = source.slice(source.indexOf("create or replace function"));
    expect(code).not.toMatch(/status|resolved_by|resolved_at|assign/i);
    expect(code).not.toMatch(/create or replace function public\.resolve_admin_support_ticket/i);
  });

  it("sends no email and adds no comments/notes column", () => {
    const code = source.slice(source.indexOf("create or replace function"));
    expect(code).not.toMatch(/sendEmail|resend\.emails|pg_net|http_post/i);
    expect(code).not.toMatch(/internal_note|admin_note/i);
  });
});

for (const rpc of [
  { name: "get_admin_support_tickets", sig: "integer, timestamptz, uuid" },
  { name: "get_admin_support_ticket_detail", sig: "uuid" },
]) {
  describe(`0070 ${rpc.name}`, () => {
    const source = readFile(MIGRATION_PATH);
    const start = source.indexOf(`create or replace function public.${rpc.name}(`);
    const nextFnIndex = source.indexOf("create or replace function public.", start + 1);
    const body = source.slice(start, nextFnIndex === -1 ? source.length : nextFnIndex);

    it("requires authentication before anything else", () => {
      expect(body).toMatch(/v_caller := auth\.uid\(\);/);
      expect(body).toMatch(/if v_caller is null then\s*\n\s*raise exception 'Authentication required\.' using detail = 'NOT_AUTHENTICATED';/);
    });

    it("checks public.user_roles for admin access -- the same role-agnostic pattern as 0067's admin RPCs", () => {
      expect(body).toMatch(/if not exists \(select 1 from public\.user_roles ur where ur\.user_id = v_caller\) then/);
      expect(body).toMatch(/'NOT_ADMIN'/);
    });

    it("is security definer with search_path locked, revoked from public/anon, granted to authenticated only", () => {
      expect(body).toMatch(/security definer/);
      expect(body).toMatch(/set search_path = ''/);
      expect(source).toMatch(new RegExp(`revoke all on function public\\.${rpc.name}\\(${rpc.sig}\\) from public;`));
      expect(source).toMatch(new RegExp(`revoke all on function public\\.${rpc.name}\\(${rpc.sig}\\) from anon;`));
      expect(source).toMatch(new RegExp(`grant execute on function public\\.${rpc.name}\\(${rpc.sig}\\) to authenticated;`));
    });

    it("exposes exactly ticket id, category, message, user id, user display name, and created_at -- no email or other profiles column", () => {
      expect(body).toMatch(/ticket_id uuid/);
      expect(body).toMatch(/category public\.support_ticket_category_enum/);
      expect(body).toMatch(/message text/);
      expect(body).toMatch(/user_id uuid/);
      expect(body).toMatch(/user_display_name text/);
      expect(body).toMatch(/created_at timestamptz/);
      expect(body).not.toMatch(/\.email\b/);
    });

    it("selects from support_tickets joined to profiles -- never a bare unauthenticated table read", () => {
      expect(body).toMatch(/from public\.support_tickets st/);
      expect(body).toMatch(/join public\.profiles p on p\.id = st\.user_id/);
    });
  });
}

describe("0070 get_admin_support_tickets pagination", () => {
  const source = readFile(MIGRATION_PATH);
  const start = source.indexOf("create or replace function public.get_admin_support_tickets(");
  const nextFnIndex = source.indexOf("create or replace function public.", start + 1);
  const body = source.slice(start, nextFnIndex);

  it("validates limit is between 1 and 50", () => {
    expect(body).toMatch(/if p_limit is null or p_limit < 1 or p_limit > 50 then/);
    expect(body).toMatch(/'LIMIT_INVALID'/);
  });

  it("requires cursor values to be supplied together", () => {
    expect(body).toMatch(/if \(p_before_created_at is null\) <> \(p_before_id is null\) then/);
    expect(body).toMatch(/'CURSOR_INVALID'/);
  });

  it("orders newest-first using a stable (created_at, id) keyset", () => {
    expect(body).toMatch(/order by st\.created_at desc, st\.id desc/);
    expect(body).toMatch(/\(st\.created_at, st\.id\) < \(p_before_created_at, p_before_id\)/);
  });
});

describe("0070 get_admin_support_ticket_detail", () => {
  const source = readFile(MIGRATION_PATH);
  const start = source.indexOf("create or replace function public.get_admin_support_ticket_detail(");
  const body = source.slice(start);

  it("raises TICKET_NOT_FOUND for a nonexistent ticket", () => {
    expect(body).toMatch(/if not exists \(select 1 from public\.support_tickets st where st\.id = p_ticket_id\) then/);
    expect(body).toMatch(/'TICKET_NOT_FOUND'/);
  });
});
