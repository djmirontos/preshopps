import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

function readFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf-8");
}

const MIGRATION_PATH = "supabase/migrations/0066_moderation_schema.sql";

describe("0066 is scoped to the reports/moderation_actions schema only", () => {
  const source = readFile(MIGRATION_PATH);

  it("creates exactly four new enums and two new tables -- no RPC, no policy DDL", () => {
    expect(source).toMatch(/create type public\.report_target_type_enum as enum/);
    expect(source).toMatch(/create type public\.report_reason_enum as enum/);
    expect(source).toMatch(/create type public\.report_status_enum as enum/);
    expect(source).toMatch(/create type public\.moderation_action_type_enum as enum/);
    expect(source).toMatch(/create table public\.reports/);
    expect(source).toMatch(/create table public\.moderation_actions/);
    expect(source).not.toMatch(/create or replace function/i);
    expect(source).not.toMatch(/create policy|alter policy|drop policy/i);
    expect(source).not.toMatch(/alter table.*enable row level security/i);
  });

  it("report_target_type_enum has exactly the four canonical PRD 31 targets", () => {
    const block = source.slice(source.indexOf("create type public.report_target_type_enum"), source.indexOf(";", source.indexOf("create type public.report_target_type_enum")));
    expect(block).toMatch(/'listing'/);
    expect(block).toMatch(/'shop'/);
    expect(block).toMatch(/'review'/);
    expect(block).toMatch(/'conversation'/);
    expect(block).not.toMatch(/'user'/);
  });

  it("report_reason_enum has exactly the seven canonical PRD 31 reasons", () => {
    const block = source.slice(source.indexOf("create type public.report_reason_enum"), source.indexOf(";", source.indexOf("create type public.report_reason_enum")));
    for (const reason of ["scam_fraud", "prohibited_item", "misleading", "harassment", "spam", "duplicate_spam", "other"]) {
      expect(block).toMatch(new RegExp(`'${reason}'`));
    }
  });

  it("moderation_action_type_enum is scoped to restriction actions only -- no listing/review-removal action type invented", () => {
    const block = source.slice(source.indexOf("create type public.moderation_action_type_enum"), source.indexOf(";", source.indexOf("create type public.moderation_action_type_enum")));
    expect(block).toMatch(/'restriction_applied'/);
    expect(block).toMatch(/'restriction_lifted'/);
    expect(block).not.toMatch(/listing_removed|review_removed|role_change/);
  });
});

describe("0066 reports table", () => {
  const source = readFile(MIGRATION_PATH);
  const table = source.slice(source.indexOf("create table public.reports"), source.indexOf("create index reports_reporter_id_idx"));

  it("has exactly one reporter and one target-type column, plus four nullable polymorphic target FKs", () => {
    expect(table).toMatch(/reporter_id uuid not null references public\.profiles\(id\) on delete restrict/);
    expect(table).toMatch(/target_type public\.report_target_type_enum not null/);
    expect(table).toMatch(/listing_id uuid references public\.listings\(id\) on delete restrict/);
    expect(table).toMatch(/shop_id uuid references public\.shops\(id\) on delete restrict/);
    expect(table).toMatch(/review_id uuid references public\.reviews\(id\) on delete restrict/);
    expect(table).toMatch(/conversation_id uuid references public\.conversations\(id\) on delete restrict/);
  });

  it("enforces exactly one populated target column matching target_type at the database level", () => {
    expect(table).toMatch(/reports_exactly_one_target_check/);
    expect(table).toMatch(/target_type = 'listing' and listing_id is not null and shop_id is null and review_id is null and conversation_id is null/);
    expect(table).toMatch(/target_type = 'conversation' and conversation_id is not null and listing_id is null and shop_id is null and review_id is null/);
  });

  it("caps description and resolution_note at 1000 chars, matching the review-body convention", () => {
    expect(table).toMatch(/reports_description_length_check[\s\S]*?char_length\(description\) <= 1000/);
    expect(table).toMatch(/reports_resolution_note_length_check[\s\S]*?char_length\(resolution_note\) <= 1000/);
  });

  it("enforces resolution-state consistency at the database level -- pending has no resolver, resolved/dismissed always does", () => {
    expect(table).toMatch(/reports_resolution_state_check/);
    expect(table).toMatch(/status = 'pending' and resolved_by is null and resolved_at is null/);
    expect(table).toMatch(/status <> 'pending' and resolved_by is not null and resolved_at is not null/);
  });

  it("defaults status to pending", () => {
    expect(table).toMatch(/status public\.report_status_enum not null default 'pending'/);
  });
});

describe("0066 moderation_actions table -- dedicated audit trail, separate from user_restrictions", () => {
  const source = readFile(MIGRATION_PATH);
  const table = source.slice(source.indexOf("create table public.moderation_actions"), source.length);

  it("captures admin identity, action type, target user, restriction type/row, reason, and timestamp", () => {
    expect(table).toMatch(/admin_id uuid not null references public\.profiles\(id\) on delete restrict/);
    expect(table).toMatch(/action_type public\.moderation_action_type_enum not null/);
    expect(table).toMatch(/target_user_id uuid not null references public\.profiles\(id\) on delete restrict/);
    expect(table).toMatch(/restriction_type public\.restriction_type_enum not null/);
    expect(table).toMatch(/restriction_id uuid not null references public\.user_restrictions\(id\) on delete restrict/);
    expect(table).toMatch(/reason text/);
    expect(table).toMatch(/created_at timestamptz not null default now\(\)/);
  });

  it("requires a non-blank reason for a restriction_applied row, but not for restriction_lifted", () => {
    expect(table).toMatch(/moderation_actions_reason_required_for_apply_check/);
    expect(table).toMatch(/action_type <> 'restriction_applied' or \(reason is not null and length\(btrim\(reason\)\) > 0\)/);
  });

  it("has no report_id column -- a restriction action is not required to originate from a formal report", () => {
    expect(table).not.toMatch(/report_id/);
  });

  it("has no updated_at column or update trigger -- every row is append-only, never edited after insert", () => {
    expect(table).not.toMatch(/updated_at/);
    expect(source).not.toMatch(/create trigger.*moderation_actions/i);
  });
});
