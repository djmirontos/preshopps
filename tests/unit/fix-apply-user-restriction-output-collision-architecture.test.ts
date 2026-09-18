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

const MIGRATION_PATH = "supabase/migrations/0097_fix_apply_user_restriction_output_collision.sql";
const APPLY_ANCHOR = "create or replace function public.apply_user_restriction(";

function getFunctionBody(source: string, anchor: string): string {
  const fnStart = source.indexOf(anchor);
  expect(fnStart).toBeGreaterThan(-1);
  const bodyStart = source.indexOf("begin\n", fnStart);
  const bodyEnd = source.indexOf("end;\n$$;", bodyStart);
  return source.slice(bodyStart, bodyEnd);
}

describe("0097: touches exactly apply_user_restriction, nothing else structural", () => {
  const source = readFile(MIGRATION_PATH);
  const code = stripSqlComments(source);

  it("contains exactly one create or replace function statement", () => {
    const createMatches = code.match(/^create or replace function public\.\w+/gm) ?? [];
    expect(createMatches).toEqual(["create or replace function public.apply_user_restriction"]);
  });

  it("does not touch 0095's enum, does not touch 0096's notifications.restriction_id column, does not create/alter any table", () => {
    expect(code).not.toMatch(/alter type/i);
    expect(code).not.toMatch(/alter table/i);
    expect(code).not.toMatch(/create table/i);
  });

  it("does not redefine lift_user_restriction or get_my_active_restrictions", () => {
    expect(source).not.toMatch(/create or replace function public\.lift_user_restriction/);
    expect(source).not.toMatch(/create or replace function public\.get_my_active_restrictions/);
  });

  it("adds no RLS policy", () => {
    expect(code).not.toMatch(/create policy/i);
  });
});

describe("0097: apply_user_restriction signature and RETURNS TABLE shape are unchanged", () => {
  const source = readFile(MIGRATION_PATH);

  it("has the exact same parameter list as 0096", () => {
    expect(source).toMatch(
      /create or replace function public\.apply_user_restriction\(p_user_id uuid, p_restriction_type restriction_type_enum, p_reason text\)/,
    );
  });

  it("has the exact same RETURNS TABLE shape as 0096, including the created_at OUT parameter name -- not renamed", () => {
    expect(source).toMatch(
      /returns table \(restriction_id uuid, user_id uuid, restriction_type restriction_type_enum, was_already_active boolean, created_at timestamp with time zone\)/,
    );
  });

  it("is still SECURITY DEFINER with an empty search_path", () => {
    const fnStart = source.indexOf(APPLY_ANCHOR);
    const fnRegion = source.slice(fnStart, source.indexOf("$$;", fnStart) + 3);
    expect(fnRegion).toMatch(/security definer/);
    expect(fnRegion).toMatch(/set search_path = ''/);
  });
});

describe("0097: the fresh-insert RETURNING clause is table-qualified -- the actual fix", () => {
  const source = readFile(MIGRATION_PATH);
  const body = getFunctionBody(source, APPLY_ANCHOR);

  it("no longer contains the bare ambiguous 'returning id, created_at' pattern anywhere in the executable function body", () => {
    expect(body).not.toMatch(/returning id, created_at/);
  });

  it("inserts into user_restrictions with an explicit alias and returns table-qualified columns", () => {
    expect(body).toMatch(
      /insert into public\.user_restrictions as ur \(user_id, restriction_type, reason, issued_by\)\s*\n\s*values \(p_user_id, p_restriction_type, v_reason, v_caller\)\s*\n\s*returning ur\.id, ur\.created_at into v_new_id, v_new_created_at;/,
    );
  });

  it("every remaining bare (non-alias-qualified) 'created_at' in the body is only ever the RETURNS TABLE type declaration or a v_*created_at variable, never a value-expression reference", () => {
    // Word-boundary matches of the bare token `created_at` inside identifiers
    // like v_new_created_at/v_existing_created_at don't occur (underscore is
    // a word character, so \b never splits them) -- so any remaining match
    // here is a real bare column reference, and there should be none left.
    const bareMatches = body.match(/(?<!ur\.)\bcreated_at\b/g) ?? [];
    expect(bareMatches).toEqual([]);
  });
});

describe("0097: every existing apply_user_restriction behavior is preserved verbatim", () => {
  const source = readFile(MIGRATION_PATH);
  const body = getFunctionBody(source, APPLY_ANCHOR);

  it("still requires admin authorization before touching any row", () => {
    expect(body).toMatch(
      /if not exists \(select 1 from public\.user_roles ur where ur\.user_id = v_caller\) then\s*\n\s*raise exception 'Admin access required\.' using detail = 'NOT_ADMIN';/,
    );
  });

  it("still requires a non-blank reason", () => {
    expect(body).toMatch(/raise exception 'A reason is required\.' using detail = 'REASON_REQUIRED';/);
  });

  it("still returns early (was_already_active = true) on the idempotent branch, before any write", () => {
    const idempotentIdx = body.indexOf("select v_existing_id, p_user_id, p_restriction_type, true, v_existing_created_at;");
    const insertIdx = body.indexOf("insert into public.user_restrictions");
    expect(idempotentIdx).toBeGreaterThan(-1);
    expect(idempotentIdx).toBeLessThan(insertIdx);
  });

  it("still writes exactly one moderation_actions row on a real apply", () => {
    expect(body).toMatch(
      /insert into public\.moderation_actions \(admin_id, action_type, target_user_id, restriction_type, restriction_id, reason\)\s*\n\s*values \(v_caller, 'restriction_applied', p_user_id, p_restriction_type, v_new_id, v_reason\);/,
    );
  });

  it("still calls recalculate_trusted_seller only for seller_suspended/account_suspended", () => {
    expect(body).toMatch(/if p_restriction_type in \('seller_suspended', 'account_suspended'\) then/);
    expect(body).toMatch(/perform public\.recalculate_trusted_seller\(v_shop_id\);/);
  });

  it("still enqueues the moderation_restriction_applied email", () => {
    expect(body).toMatch(/perform public\.enqueue_email\(\s*\n\s*'moderation_restriction_applied'::public\.email_event_type_enum,/);
  });

  it("still inserts exactly one in-app notification, after the email enqueue call, with the same dedupe/anonymized-recipient guard", () => {
    const notificationMatches = body.match(/insert into public\.notifications/g) ?? [];
    expect(notificationMatches).toHaveLength(1);

    const emailIdx = body.indexOf("perform public.enqueue_email(");
    const notificationIdx = body.indexOf("insert into public.notifications");
    expect(notificationIdx).toBeGreaterThan(emailIdx);

    const notificationBlock = body.slice(notificationIdx, body.indexOf("on conflict on constraint notifications_recipient_type_dedupe_key do nothing;") + 1);
    expect(notificationBlock).toMatch(/select p_user_id, 'moderation_restriction_applied', v_caller, v_new_id, v_new_id::text \|\| ':applied'/);
    expect(notificationBlock).toMatch(/where not exists \(\s*\n\s*select 1 from public\.profiles p where p\.id = p_user_id and p\.deleted_at is not null\s*\n\s*\)/);
  });

  it("grants/revokes are unchanged -- anon still has no access, authenticated still does", () => {
    expect(source).toMatch(/revoke all on function public\.apply_user_restriction\(uuid, restriction_type_enum, text\) from public;/);
    expect(source).toMatch(/revoke all on function public\.apply_user_restriction\(uuid, restriction_type_enum, text\) from anon;/);
    expect(source).toMatch(/grant execute on function public\.apply_user_restriction\(uuid, restriction_type_enum, text\) to authenticated;/);
    expect(source).not.toMatch(/grant execute on function public\.apply_user_restriction\([^;]*to anon/);
  });
});
