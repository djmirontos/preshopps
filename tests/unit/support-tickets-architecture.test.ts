import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

function readFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf-8");
}

const MIGRATION_PATH = "supabase/migrations/0069_support_tickets.sql";

describe("0069 is scoped to support_tickets only", () => {
  const source = readFile(MIGRATION_PATH);

  it("creates exactly one new enum, one new table, and one new RPC -- no unrelated DDL", () => {
    expect(source).toMatch(/create type public\.support_ticket_category_enum as enum/);
    expect(source).toMatch(/create table public\.support_tickets/);
    expect(source).toMatch(/create or replace function public\.submit_support_ticket/);
    expect(source).not.toMatch(/create policy|alter policy|drop policy/i);
    expect(source).not.toMatch(/alter table.*enable row level security/i);
    expect(source).not.toMatch(/drop table|drop function/i);
  });

  it("support_ticket_category_enum has exactly the four canonical PRD 43.1 categories", () => {
    const block = source.slice(
      source.indexOf("create type public.support_ticket_category_enum"),
      source.indexOf(";", source.indexOf("create type public.support_ticket_category_enum")),
    );
    expect(block).toMatch(/'general_inquiry'/);
    expect(block).toMatch(/'account_issue'/);
    expect(block).toMatch(/'order_dispute_issue'/);
    expect(block).toMatch(/'report_a_problem'/);
  });
});

describe("0069 support_tickets table", () => {
  const source = readFile(MIGRATION_PATH);
  const table = source.slice(source.indexOf("create table public.support_tickets"), source.indexOf("create index"));

  it("captures the submitting user, category, message, and timestamp", () => {
    expect(table).toMatch(/user_id uuid not null references public\.profiles\(id\) on delete restrict/);
    expect(table).toMatch(/category public\.support_ticket_category_enum not null/);
    expect(table).toMatch(/message text not null/);
    expect(table).toMatch(/created_at timestamptz not null default now\(\)/);
  });

  it("bounds message length between 1 and 2000 chars", () => {
    expect(table).toMatch(/support_tickets_message_length_check[\s\S]*?char_length\(btrim\(message\)\) between 1 and 2000/);
  });

  it("has no status/resolution columns -- an admin queue is a separate, not-yet-built feature", () => {
    expect(table).not.toMatch(/status|resolved_by|resolved_at/);
  });
});

describe("0069 submit_support_ticket RPC", () => {
  const source = readFile(MIGRATION_PATH);
  const rpc = source.slice(source.indexOf("create or replace function public.submit_support_ticket"), source.length);

  it("requires authentication", () => {
    expect(rpc).toMatch(/v_caller := auth\.uid\(\);/);
    expect(rpc).toMatch(/if v_caller is null then\s*\n\s*raise exception 'Authentication required\.' using detail = 'NOT_AUTHENTICATED';/);
  });

  it("blocks a deleted account but does NOT gate on user_restrictions -- support must stay reachable while suspended (PRD 33.2)", () => {
    expect(rpc).toMatch(/v_caller_deleted_at is not null/);
    expect(rpc).toMatch(/'INTERACTION_BLOCKED'/);
    expect(rpc).not.toMatch(/user_restrictions/);
  });

  it("validates the message is non-blank and at most 2000 chars", () => {
    expect(rpc).toMatch(/'MESSAGE_REQUIRED'/);
    expect(rpc).toMatch(/char_length\(v_message\) > 2000/);
    expect(rpc).toMatch(/'MESSAGE_TOO_LONG'/);
  });

  it("never sends email -- out of scope for this task", () => {
    expect(source).not.toMatch(/sendEmail|resend\.emails|pg_net|http_post/i);
  });

  it("is security definer with search_path locked and restricted to authenticated callers", () => {
    expect(rpc).toMatch(/security definer/);
    expect(rpc).toMatch(/set search_path = ''/);
    expect(source).toMatch(/revoke all on function public\.submit_support_ticket\([^)]*\) from public;/);
    expect(source).toMatch(/revoke all on function public\.submit_support_ticket\([^)]*\) from anon;/);
    expect(source).toMatch(/grant execute on function public\.submit_support_ticket\([^)]*\) to authenticated;/);
  });
});
