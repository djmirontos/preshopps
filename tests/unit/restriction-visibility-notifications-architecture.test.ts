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

const ENUM_MIGRATION_PATH = "supabase/migrations/0095_restriction_visibility_notifications.sql";
const SCHEMA_MIGRATION_PATH = "supabase/migrations/0096_restriction_visibility_notifications.sql";

function getFunctionBody(source: string, anchor: string): string {
  const fnStart = source.indexOf(anchor);
  expect(fnStart).toBeGreaterThan(-1);
  const bodyStart = source.indexOf("begin\n", fnStart);
  const bodyEnd = source.indexOf("end;\n$$;", bodyStart);
  return source.slice(bodyStart, bodyEnd);
}

const APPLY_ANCHOR = "create or replace function public.apply_user_restriction(";
const LIFT_ANCHOR = "create or replace function public.lift_user_restriction(p_restriction_id uuid, p_note text default null::text)";
const SELF_READ_ANCHOR = "create or replace function public.get_my_active_restrictions()";

// ============================================================
// 0095 -- enum additions ONLY. PostgreSQL forbids using a value added to a
// pre-existing enum type inside the same transaction that added it, so
// this migration must contain nothing that could reference either new
// value beyond the two ALTER TYPE statements themselves.
// ============================================================
describe("0095: enum additions only -- no dependent schema/function change", () => {
  const source = readFile(ENUM_MIGRATION_PATH);
  const code = stripSqlComments(source);

  it("adds exactly the two moderation notification enum values, nothing else", () => {
    const addValueMatches = code.match(/alter type public\.\w+ add value '\w+';/g) ?? [];
    expect(addValueMatches).toEqual([
      "alter type public.notification_type_enum add value 'moderation_restriction_applied';",
      "alter type public.notification_type_enum add value 'moderation_restriction_lifted';",
    ]);
  });

  it("both new values are added to the pre-existing notification_type_enum, not a freshly-created type", () => {
    expect(code).not.toMatch(/create type public\.notification_type_enum/);
    expect(code).toMatch(/alter type public\.notification_type_enum add value/);
  });

  it("creates no table, no new enum type, no function, no grant/revoke", () => {
    expect(code).not.toMatch(/create table/i);
    expect(code).not.toMatch(/create type/i);
    expect(code).not.toMatch(/create (or replace )?function/i);
    expect(code).not.toMatch(/grant execute|revoke all/i);
  });

  it("never touches public.notifications, public.user_restrictions, or any restriction RPC", () => {
    expect(code).not.toMatch(/alter table public\.notifications/);
    expect(code).not.toMatch(/apply_user_restriction|lift_user_restriction|get_my_active_restrictions/);
  });

  it("does not itself use either new enum value beyond the ADD VALUE statement that defines it -- only the bare literal appears, never a cast or column reference", () => {
    // The only two occurrences of each literal must be the ADD VALUE
    // statements captured above -- a third occurrence anywhere would mean
    // this migration is using the value it just added, which is exactly
    // what must not happen in the same transaction.
    const appliedMatches = code.match(/moderation_restriction_applied/g) ?? [];
    const liftedMatches = code.match(/moderation_restriction_lifted/g) ?? [];
    expect(appliedMatches).toHaveLength(1);
    expect(liftedMatches).toHaveLength(1);
  });

  it("adds no RLS policy anywhere", () => {
    expect(code).not.toMatch(/create policy/i);
  });
});

// ============================================================
// 0096 -- everything that depends on the two enum values 0095 committed:
// the notifications.restriction_id column, the self-read RPC, and the two
// redefined restriction RPCs.
// ============================================================
describe("0096: depends on 0095's committed enum values; contains the dependent schema/functions", () => {
  const source = readFile(SCHEMA_MIGRATION_PATH);
  const code = stripSqlComments(source);

  it("adds no enum value itself -- it only uses the two 0095 already committed", () => {
    expect(code).not.toMatch(/alter type public\.notification_type_enum add value/);
  });

  it("is the first migration that actually uses either new enum value (a cast or column value, not merely an ADD VALUE statement)", () => {
    expect(code).toMatch(/'moderation_restriction_applied'::public\.email_event_type_enum/);
    expect(code).toMatch(/select p_user_id, 'moderation_restriction_applied', v_caller, v_new_id/);
    expect(code).toMatch(/'moderation_restriction_lifted'::public\.email_event_type_enum/);
    expect(code).toMatch(/select v_user_id, 'moderation_restriction_lifted', v_caller, p_restriction_id/);
  });

  it("adds notifications.restriction_id as a nullable FK to user_restrictions, ON DELETE CASCADE (matching order_id/conversation_id/review_id's own convention)", () => {
    expect(source).toMatch(
      /alter table public\.notifications\s*\n\s*add column restriction_id uuid references public\.user_restrictions\(id\) on delete cascade;/,
    );
  });

  it("creates no new table and no new enum type", () => {
    expect(code).not.toMatch(/create table/i);
    expect(code).not.toMatch(/create type/i);
  });

  it("adds no RLS policy to notifications or user_restrictions -- the new self-read RPC is the only new access path", () => {
    expect(code).not.toMatch(/create policy/i);
  });

  it("does not widen get_my_notifications' own column list", () => {
    expect(source).not.toMatch(/create or replace function public\.get_my_notifications/);
  });

  it("touches exactly the three named functions -- self-read plus the two redefined restriction RPCs", () => {
    const createMatches = code.match(/^create or replace function public\.\w+/gm) ?? [];
    expect(createMatches).toEqual([
      "create or replace function public.get_my_active_restrictions",
      "create or replace function public.apply_user_restriction",
      "create or replace function public.lift_user_restriction",
    ]);
  });
});

describe("0096: get_my_active_restrictions -- self-read, active-only, no moderator identity", () => {
  const source = readFile(SCHEMA_MIGRATION_PATH);
  const body = getFunctionBody(source, SELF_READ_ANCHOR);

  it("takes no parameters at all -- identity is exclusively auth.uid()", () => {
    const signature = source.slice(source.indexOf(SELF_READ_ANCHOR), source.indexOf("returns table", source.indexOf(SELF_READ_ANCHOR)));
    expect(signature).toMatch(/get_my_active_restrictions\(\)/);
    expect(signature).not.toMatch(/p_user_id|p_uid|p_target/);
  });

  it("rejects an unauthenticated caller with NOT_AUTHENTICATED", () => {
    expect(body).toMatch(/v_caller := auth\.uid\(\);/);
    expect(body).toMatch(/if v_caller is null then\s*\n\s*raise exception 'Authentication required\.' using detail = 'NOT_AUTHENTICATED';/);
  });

  it("returns zero rows (not an error) for a missing or deleted/anonymized caller profile, matching get_my_notifications' own convention", () => {
    expect(body).toMatch(/if not found or v_deleted_at is not null then\s*\n\s*return;\s*\n\s*end if;/);
  });

  it("filters to the caller's own user_id and only currently-active rows (lifted_at is null)", () => {
    expect(body).toMatch(/where ur\.user_id = v_caller\s*\n\s*and ur\.lifted_at is null/);
  });

  it("never accepts or reads a client-supplied target user id -- there is no id to forge", () => {
    expect(body).not.toMatch(/p_user_id|p_target_user_id/);
  });

  it("returns only restriction_id/restriction_type/reason/created_at -- never issued_by, lifted_by, or any display name (moderator identity)", () => {
    const returnBlock = source.slice(source.indexOf("returns table", source.indexOf(SELF_READ_ANCHOR)), source.indexOf("language plpgsql", source.indexOf(SELF_READ_ANCHOR)));
    expect(returnBlock).toMatch(/restriction_id uuid/);
    expect(returnBlock).toMatch(/restriction_type public\.restriction_type_enum/);
    expect(returnBlock).toMatch(/reason text/);
    expect(returnBlock).toMatch(/created_at timestamptz/);
    expect(returnBlock).not.toMatch(/issued_by|lifted_by|display_name/);
    expect(body).not.toMatch(/issued_by|lifted_by|display_name/);
  });

  it("never selects from moderation_actions or exposes any admin-only audit metadata", () => {
    expect(body).not.toMatch(/moderation_actions/);
  });

  it("is SECURITY DEFINER with an empty search_path, revoked from public/anon, granted to authenticated only", () => {
    const fnStart = source.indexOf(SELF_READ_ANCHOR);
    const fnRegion = source.slice(fnStart, source.indexOf("$$;", fnStart) + 3);
    expect(fnRegion).toMatch(/security definer/);
    expect(fnRegion).toMatch(/set search_path = ''/);

    expect(source).toMatch(/revoke all on function public\.get_my_active_restrictions\(\) from public;/);
    expect(source).toMatch(/revoke all on function public\.get_my_active_restrictions\(\) from anon;/);
    expect(source).toMatch(/grant execute on function public\.get_my_active_restrictions\(\) to authenticated;/);
    expect(source).not.toMatch(/grant execute on function public\.get_my_active_restrictions\(\)[^;]*to anon/);
  });
});

describe("0096: apply_user_restriction -- every prior behavior preserved, exactly one notification insert added", () => {
  const source = readFile(SCHEMA_MIGRATION_PATH);
  const body = getFunctionBody(source, APPLY_ANCHOR);

  it("still requires admin authorization before touching any row", () => {
    expect(body).toMatch(/if not exists \(select 1 from public\.user_roles ur where ur\.user_id = v_caller\) then\s*\n\s*raise exception 'Admin access required\.' using detail = 'NOT_ADMIN';/);
  });

  it("still requires a non-blank reason", () => {
    expect(body).toMatch(/raise exception 'A reason is required\.' using detail = 'REASON_REQUIRED';/);
  });

  it("still returns early (was_already_active = true) on the idempotent branch, before any write", () => {
    const idempotentIdx = body.indexOf("select v_existing_id, p_user_id, p_restriction_type, true, v_existing_created_at;");
    const insertIdx = body.indexOf("insert into public.user_restrictions");
    const notificationIdx = body.indexOf("'moderation_restriction_applied', v_caller, v_new_id");
    expect(idempotentIdx).toBeGreaterThan(-1);
    expect(idempotentIdx).toBeLessThan(insertIdx);
    expect(idempotentIdx).toBeLessThan(notificationIdx);
  });

  it("still writes exactly one moderation_actions row on a real apply", () => {
    expect(body).toMatch(/insert into public\.moderation_actions \(admin_id, action_type, target_user_id, restriction_type, restriction_id, reason\)\s*\n\s*values \(v_caller, 'restriction_applied', p_user_id, p_restriction_type, v_new_id, v_reason\);/);
  });

  it("still calls recalculate_trusted_seller only for seller_suspended/account_suspended", () => {
    expect(body).toMatch(/if p_restriction_type in \('seller_suspended', 'account_suspended'\) then/);
    expect(body).toMatch(/perform public\.recalculate_trusted_seller\(v_shop_id\);/);
  });

  it("still enqueues the moderation_restriction_applied email", () => {
    expect(body).toMatch(/perform public\.enqueue_email\(\s*\n\s*'moderation_restriction_applied'::public\.email_event_type_enum,/);
  });

  it("adds exactly one insert into public.notifications, positioned AFTER the email enqueue call", () => {
    const notificationMatches = body.match(/insert into public\.notifications/g) ?? [];
    expect(notificationMatches).toHaveLength(1);

    const emailIdx = body.indexOf("perform public.enqueue_email(");
    const notificationIdx = body.indexOf("insert into public.notifications");
    expect(emailIdx).toBeGreaterThan(-1);
    expect(notificationIdx).toBeGreaterThan(emailIdx);
  });

  it("the notification is typed moderation_restriction_applied, recipient is the restricted user, actor is the acting admin, linked to the new restriction row", () => {
    const notificationBlock = body.slice(body.indexOf("insert into public.notifications"), body.indexOf("on conflict on constraint notifications_recipient_type_dedupe_key do nothing;") + 1);
    expect(notificationBlock).toMatch(/select p_user_id, 'moderation_restriction_applied', v_caller, v_new_id, v_new_id::text \|\| ':applied'/);
  });

  it("guards the notification insert against an already-anonymized recipient, same as the email path", () => {
    const notificationBlock = body.slice(body.indexOf("insert into public.notifications"), body.indexOf("return query", body.indexOf("insert into public.notifications")));
    expect(notificationBlock).toMatch(/where not exists \(\s*\n\s*select 1 from public\.profiles p where p\.id = p_user_id and p\.deleted_at is not null\s*\n\s*\)/);
  });

  it("uses ON CONFLICT DO NOTHING on the notification insert as defense-in-depth against a duplicate dedupe_key", () => {
    const notificationIdx = body.indexOf("insert into public.notifications");
    const notificationBlock = body.slice(notificationIdx, body.indexOf("on conflict on constraint notifications_recipient_type_dedupe_key do nothing;", notificationIdx) + 100);
    expect(notificationBlock).toMatch(/on conflict on constraint notifications_recipient_type_dedupe_key do nothing;/);
  });

  it("grants/revokes are unchanged -- anon still has no access, authenticated still does", () => {
    expect(source).toMatch(/revoke all on function public\.apply_user_restriction\(uuid, restriction_type_enum, text\) from anon;/);
    expect(source).toMatch(/grant execute on function public\.apply_user_restriction\(uuid, restriction_type_enum, text\) to authenticated;/);
    expect(source).not.toMatch(/grant execute on function public\.apply_user_restriction\([^;]*to anon/);
  });
});

describe("0096: lift_user_restriction -- every prior behavior preserved, exactly one notification insert added", () => {
  const source = readFile(SCHEMA_MIGRATION_PATH);
  const body = getFunctionBody(source, LIFT_ANCHOR);

  it("still requires admin authorization before touching any row", () => {
    expect(body).toMatch(/if not exists \(select 1 from public\.user_roles ur where ur\.user_id = v_caller\) then\s*\n\s*raise exception 'Admin access required\.' using detail = 'NOT_ADMIN';/);
  });

  it("still returns early (was_already_lifted = true) on the idempotent branch, before any write", () => {
    const idempotentIdx = body.indexOf("select p_restriction_id, v_user_id, v_restriction_type, true, v_existing_lifted_at;");
    const updateIdx = body.indexOf("update public.user_restrictions as ur");
    const notificationIdx = body.indexOf("'moderation_restriction_lifted', v_caller, p_restriction_id");
    expect(idempotentIdx).toBeGreaterThan(-1);
    expect(idempotentIdx).toBeLessThan(updateIdx);
    expect(idempotentIdx).toBeLessThan(notificationIdx);
  });

  it("still rejects lifting an anonymized target's account_suspended restriction, before any write", () => {
    const guardIdx = body.indexOf("TARGET_ACCOUNT_ANONYMIZED");
    const updateIdx = body.indexOf("update public.user_restrictions as ur");
    expect(guardIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeLessThan(updateIdx);
  });

  it("still writes exactly one moderation_actions row on a real lift", () => {
    expect(body).toMatch(/insert into public\.moderation_actions \(admin_id, action_type, target_user_id, restriction_type, restriction_id, reason\)\s*\n\s*values \(v_caller, 'restriction_lifted', v_user_id, v_restriction_type, p_restriction_id, v_note\);/);
  });

  it("still calls recalculate_trusted_seller only for seller_suspended/account_suspended", () => {
    expect(body).toMatch(/if v_restriction_type in \('seller_suspended', 'account_suspended'\) then/);
    expect(body).toMatch(/perform public\.recalculate_trusted_seller\(v_shop_id\);/);
  });

  it("still enqueues the moderation_restriction_lifted email", () => {
    expect(body).toMatch(/perform public\.enqueue_email\(\s*\n\s*'moderation_restriction_lifted'::public\.email_event_type_enum,/);
  });

  it("adds exactly one insert into public.notifications, positioned AFTER the email enqueue call", () => {
    const notificationMatches = body.match(/insert into public\.notifications/g) ?? [];
    expect(notificationMatches).toHaveLength(1);

    const emailIdx = body.indexOf("perform public.enqueue_email(");
    const notificationIdx = body.indexOf("insert into public.notifications");
    expect(emailIdx).toBeGreaterThan(-1);
    expect(notificationIdx).toBeGreaterThan(emailIdx);
  });

  it("the notification is typed moderation_restriction_lifted, recipient is the restricted user, actor is the acting admin, linked to the lifted restriction row", () => {
    const notificationBlock = body.slice(body.indexOf("insert into public.notifications"), body.indexOf("on conflict on constraint notifications_recipient_type_dedupe_key do nothing;") + 1);
    expect(notificationBlock).toMatch(/select v_user_id, 'moderation_restriction_lifted', v_caller, p_restriction_id, p_restriction_id::text \|\| ':lifted'/);
  });

  it("guards the notification insert against an already-anonymized recipient, same as the email path", () => {
    const notificationBlock = body.slice(body.indexOf("insert into public.notifications"), body.indexOf("return query", body.indexOf("insert into public.notifications")));
    expect(notificationBlock).toMatch(/where not exists \(\s*\n\s*select 1 from public\.profiles p where p\.id = v_user_id and p\.deleted_at is not null\s*\n\s*\)/);
  });

  it("grants/revokes are unchanged -- anon still has no access, authenticated still does", () => {
    expect(source).toMatch(/revoke all on function public\.lift_user_restriction\(uuid, text\) from anon;/);
    expect(source).toMatch(/grant execute on function public\.lift_user_restriction\(uuid, text\) to authenticated;/);
    expect(source).not.toMatch(/grant execute on function public\.lift_user_restriction\([^;]*to anon/);
  });
});

describe("0095+0096 together: no unrelated behavior changed", () => {
  const combined = readFile(ENUM_MIGRATION_PATH) + "\n" + readFile(SCHEMA_MIGRATION_PATH);

  it("never mentions listing/review removal, appeal forms, or admin user management -- out of this step's scope", () => {
    expect(combined).not.toMatch(/admin_hide_listing|admin_remove_listing|admin_remove_review|appeal_ticket|find_user_for_restriction/i);
  });

  it("never touches escrow, refund, or payment processing", () => {
    expect(combined).not.toMatch(/escrow|refund processing|payment processing/i);
  });

  it("never grants anything to anon anywhere in either file", () => {
    expect(stripSqlComments(combined)).not.toMatch(/grant execute[^;]*to anon/);
  });
});
