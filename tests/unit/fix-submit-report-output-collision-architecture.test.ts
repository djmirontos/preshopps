import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

function readFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf-8");
}

function stripSqlComments(sql: string): string {
  return sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

const MIGRATION_PATH = "supabase/migrations/0098_fix_submit_report_output_collision.sql";
const SUBMIT_REPORT_ANCHOR = "create or replace function public.submit_report(";

function getFunctionBody(source: string, anchor: string): string {
  const fnStart = source.indexOf(anchor);
  expect(fnStart).toBeGreaterThan(-1);
  const bodyStart = source.indexOf("begin\n", fnStart);
  const bodyEnd = source.indexOf("end;\n$$;", bodyStart);
  return source.slice(bodyStart, bodyEnd);
}

describe("0098: touches exactly submit_report, nothing else structural", () => {
  const source = readFile(MIGRATION_PATH);
  const code = stripSqlComments(source);

  it("contains exactly one create or replace function statement", () => {
    const createMatches = code.match(/^create or replace function public\.\w+/gm) ?? [];
    expect(createMatches).toEqual(["create or replace function public.submit_report"]);
  });

  it("does not touch reports/moderation_actions schema, does not touch any other RPC", () => {
    expect(code).not.toMatch(/alter table/i);
    expect(code).not.toMatch(/create table/i);
    expect(code).not.toMatch(/alter type/i);
    expect(source).not.toMatch(/create or replace function public\.(get_admin_reports|get_admin_report_detail|resolve_admin_report|apply_user_restriction|lift_user_restriction)/);
  });

  it("adds no RLS policy and no duplicate/rate-limit restriction", () => {
    expect(code).not.toMatch(/create policy/i);
    expect(code).not.toMatch(/on conflict/i);
    expect(code).not.toMatch(/unique/i);
  });
});

describe("0098: submit_report signature and RETURNS TABLE shape are unchanged", () => {
  const source = readFile(MIGRATION_PATH);

  it("has the exact same parameter list as 0067", () => {
    expect(source).toMatch(
      /create or replace function public\.submit_report\(\s*\n\s*p_target_type public\.report_target_type_enum,\s*\n\s*p_target_id uuid,\s*\n\s*p_reason public\.report_reason_enum,\s*\n\s*p_description text default null\s*\n\)/,
    );
  });

  it("has the exact same RETURNS TABLE shape as 0067, including the created_at OUT parameter name -- not renamed", () => {
    expect(source).toMatch(/returns table \(\s*\n\s*report_id uuid,\s*\n\s*created_at timestamptz\s*\n\)/);
  });

  it("is still SECURITY DEFINER with an empty search_path", () => {
    const fnStart = source.indexOf(SUBMIT_REPORT_ANCHOR);
    const fnRegion = source.slice(fnStart, source.indexOf("$$;", fnStart) + 3);
    expect(fnRegion).toMatch(/security definer/);
    expect(fnRegion).toMatch(/set search_path = ''/);
  });
});

describe("0098: the insert RETURNING clause is table-qualified -- the actual fix", () => {
  const source = readFile(MIGRATION_PATH);
  const body = getFunctionBody(source, SUBMIT_REPORT_ANCHOR);

  it("no longer contains the bare ambiguous 'returning id, created_at' pattern anywhere in the executable function body", () => {
    expect(body).not.toMatch(/returning id, created_at/);
  });

  it("inserts into reports with an explicit alias and returns table-qualified columns", () => {
    expect(body).toMatch(
      /insert into public\.reports as r \(reporter_id, target_type, listing_id, shop_id, review_id, conversation_id, reason, description\)\s*\n\s*values \(v_caller, p_target_type, v_listing_id, v_shop_id, v_review_id, v_conversation_id, p_reason, v_description\)\s*\n\s*returning r\.id, r\.created_at into v_report_id, v_created_at;/,
    );
  });

  it("every remaining bare (non-alias-qualified) 'created_at' in the body is only ever a v_*created_at variable, never a value-expression column reference", () => {
    const bareMatches = body.match(/(?<!r\.)\bcreated_at\b/g) ?? [];
    expect(bareMatches).toEqual([]);
  });
});

describe("0098: every existing submit_report behavior is preserved verbatim", () => {
  const source = readFile(MIGRATION_PATH);
  const body = getFunctionBody(source, SUBMIT_REPORT_ANCHOR);

  it("requires authentication and blocks a deleted caller", () => {
    expect(body).toMatch(/'Authentication required\.' using detail = 'NOT_AUTHENTICATED'/);
    expect(body).toMatch(/'Your account cannot submit reports\.' using detail = 'INTERACTION_BLOCKED'/);
  });

  it("caps description length at 1000 chars", () => {
    expect(body).toMatch(/char_length\(v_description\) > 1000/);
    expect(body).toMatch(/'REPORT_DESCRIPTION_TOO_LONG'/);
  });

  it("validates existence and rejects self-report for listing/shop/review targets, exactly three times", () => {
    expect(body).toMatch(/'Listing not found\.' using detail = 'LISTING_NOT_FOUND'/);
    expect(body).toMatch(/'Shop not found\.' using detail = 'SHOP_NOT_FOUND'/);
    expect(body).toMatch(/'Review not found\.' using detail = 'REVIEW_NOT_FOUND'/);
    const selfReportMatches = body.match(/SELF_REPORT_NOT_ALLOWED/g) ?? [];
    expect(selfReportMatches.length).toBe(3);
  });

  it("requires conversation-report callers to be an actual participant", () => {
    expect(body).toMatch(/'Conversation not found\.' using detail = 'CONVERSATION_NOT_FOUND'/);
    expect(body).toMatch(/if v_caller <> v_buyer_id and v_caller <> v_owner_id then/);
    expect(body).toMatch(/'NOT_CONVERSATION_PARTICIPANT'/);
  });

  it("rejects an unsupported target type", () => {
    expect(body).toMatch(/else\s*\n\s*raise exception 'Unsupported report target\.' using detail = 'TARGET_TYPE_INVALID';/);
  });

  it("never applies a restriction or mutates any target row -- only inserts into reports", () => {
    expect(body).not.toMatch(/update public\.(listings|shops|reviews|conversations)/);
    expect(body).not.toMatch(/insert into public\.user_restrictions/);
    expect(body).toMatch(/insert into public\.reports/);
  });

  it("never accepts a client-supplied reporter id -- reporter_id is always auth.uid()-derived v_caller", () => {
    expect(body).not.toMatch(/p_reporter_id/);
    expect(body).toMatch(/insert into public\.reports as r \(reporter_id,[\s\S]*?values \(v_caller,/);
  });

  it("adds no duplicate-report restriction -- repeated reports against the same target remain allowed triage signal", () => {
    expect(body).not.toMatch(/already.*report|report.*exists|duplicate/i);
  });

  it("grants/revokes are unchanged -- anon still has no access, authenticated still does", () => {
    expect(source).toMatch(
      /revoke all on function public\.submit_report\(public\.report_target_type_enum, uuid, public\.report_reason_enum, text\) from public;/,
    );
    expect(source).toMatch(
      /revoke all on function public\.submit_report\(public\.report_target_type_enum, uuid, public\.report_reason_enum, text\) from anon;/,
    );
    expect(source).toMatch(
      /grant execute on function public\.submit_report\(public\.report_target_type_enum, uuid, public\.report_reason_enum, text\) to authenticated;/,
    );
    expect(source).not.toMatch(/grant execute on function public\.submit_report\([^;]*to anon/);
  });
});
