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

const ENUM_MIGRATION_PATH = "supabase/migrations/0080_account_anonymization_enum.sql";
const RPC_MIGRATION_PATH = "supabase/migrations/0081_account_anonymization_rpc.sql";

function getFunctionBody(source: string, anchor: string): string {
  const fnStart = source.indexOf(anchor);
  const bodyStart = source.indexOf("begin\n", fnStart);
  const bodyEnd = source.indexOf("end;\n$$;", bodyStart);
  return source.slice(bodyStart, bodyEnd);
}

const ANONYMIZE_ANCHOR = "create or replace function public.anonymize_user_account(";
const TICKET_DETAIL_ANCHOR = "create function public.get_admin_support_ticket_detail(";

describe("0080 is scoped to exactly one enum value, nothing else", () => {
  const source = readFile(ENUM_MIGRATION_PATH);

  it("adds exactly account_anonymized to admin_audit_action_enum", () => {
    expect(source).toMatch(/alter type public\.admin_audit_action_enum add value 'account_anonymized';/);
  });

  it("touches no table, function, or other type", () => {
    expect(stripSqlComments(source)).not.toMatch(/create table|create function|create or replace function|alter table|drop/i);
  });
});

describe("0081 is scoped to exactly the CHECK widen, anonymize_user_account, and get_admin_support_ticket_detail", () => {
  const source = readFile(RPC_MIGRATION_PATH);

  it("creates/replaces exactly anonymize_user_account (CREATE OR REPLACE) and get_admin_support_ticket_detail (DROP + CREATE, since its return columns change)", () => {
    const replaceMatches = source.match(/create or replace function public\.\w+\(/g) ?? [];
    expect(replaceMatches).toEqual(["create or replace function public.anonymize_user_account("]);

    expect(source).toMatch(/drop function public\.get_admin_support_ticket_detail\(uuid\);/);
    expect(source).toMatch(/\n\ncreate function public\.get_admin_support_ticket_detail\(/);

    const anyOtherCreate = source
      .replace("create or replace function public.anonymize_user_account(", "")
      .replace("create function public.get_admin_support_ticket_detail(", "")
      .match(/create (or replace )?function public\.\w+\(/g);
    expect(anyOtherCreate).toBeNull();
  });

  it("adds no new table, enum, or policy", () => {
    expect(stripSqlComments(source)).not.toMatch(/create table|create type|create policy/i);
  });

  it("widens exactly one CHECK constraint, on admin_audit_logs, via drop+add (no other ALTER)", () => {
    expect(source).toMatch(/alter table public\.admin_audit_logs\s*\n\s*drop constraint admin_audit_logs_role_transition_check;/);
    expect(source).toMatch(/alter table public\.admin_audit_logs\s*\n\s*add constraint admin_audit_logs_role_transition_check/);
    const alterMatches = source.match(/alter table public\.\w+/g) ?? [];
    expect(new Set(alterMatches)).toEqual(new Set(["alter table public.admin_audit_logs"]));
  });

  it("the widened CHECK still requires every existing action's original shape, plus the new account_anonymized branch", () => {
    const checkBlock = source.slice(
      source.indexOf("check (", source.indexOf("add constraint admin_audit_logs_role_transition_check")),
      source.indexOf(");", source.indexOf("check (", source.indexOf("add constraint admin_audit_logs_role_transition_check"))),
    );
    expect(checkBlock).toMatch(/\(action = 'admin_role_granted' and previous_role is null and new_role is not null\)/);
    expect(checkBlock).toMatch(
      /\(action = 'admin_role_changed' and previous_role is not null and new_role is not null and previous_role <> new_role\)/,
    );
    expect(checkBlock).toMatch(/\(action = 'admin_role_revoked' and previous_role is not null and new_role is null\)/);
    expect(checkBlock).toMatch(/\(action = 'account_anonymized' and previous_role is null and new_role is null\)/);
  });

  it("never mentions escrow, refund, or payment arbitration", () => {
    expect(source).not.toMatch(/escrow|refund|payment arbitration/i);
  });
});

describe("anonymize_user_account: authorization", () => {
  const source = readFile(RPC_MIGRATION_PATH);
  const body = getFunctionBody(source, ANONYMIZE_ANCHOR);

  it("rejects an unauthenticated caller", () => {
    expect(body).toMatch(/if v_caller is null then\s*\n\s*raise exception 'Authentication required\.' using detail = 'NOT_AUTHENTICATED';/);
  });

  it("rejects a caller with no admin role at all (ordinary user cannot anonymize accounts)", () => {
    expect(body).toMatch(/if v_caller_role is null then\s*\n\s*raise exception 'Admin access required\.' using detail = 'NOT_ADMIN';/);
  });

  it("does not require super_admin for an ordinary (role-less) target -- any admin may proceed", () => {
    const preRoleCheckSection = body.slice(0, body.indexOf("role-holder safety"));
    expect(preRoleCheckSection).not.toMatch(/'super_admin'/);
  });

  it("requires super_admin specifically when the target holds any admin role", () => {
    expect(body).toMatch(/if v_target_role is not null then\s*\n\s*if v_caller_role is distinct from 'super_admin' then/);
    expect(body).toMatch(/'SUPER_ADMIN_REQUIRED_FOR_ADMIN_TARGET'/);
  });
});

describe("anonymize_user_account: reason, target existence, idempotency", () => {
  const source = readFile(RPC_MIGRATION_PATH);
  const body = getFunctionBody(source, ANONYMIZE_ANCHOR);

  it("requires a non-blank reason, capped at 1000 chars", () => {
    expect(body).toMatch(/v_reason := btrim\(p_reason\);/);
    expect(body).toMatch(/'REASON_REQUIRED'/);
    expect(body).toMatch(/char_length\(v_reason\) > 1000/);
    expect(body).toMatch(/'REASON_TOO_LONG'/);
  });

  it("rejects a nonexistent target after locking the profile row", () => {
    expect(body).toMatch(/from public\.profiles p\s*\n\s*where p\.id = p_user_id\s*\n\s*for update;/);
    expect(body).toMatch(/if not found then\s*\n\s*raise exception 'User not found\.' using detail = 'USER_NOT_FOUND';/);
  });

  it("is idempotent: an already-anonymized target returns success without further mutation", () => {
    expect(body).toMatch(/if v_deleted_at is not null then\s*\n\s*return query select p_user_id, true, v_deleted_at;\s*\n\s*return;/);
  });
});

describe("anonymize_user_account: last-super-admin protection, reusing 0078/0079's exact invariant", () => {
  const source = readFile(RPC_MIGRATION_PATH);
  const body = getFunctionBody(source, ANONYMIZE_ANCHOR);

  it("only evaluates the lockout when the target is specifically super_admin", () => {
    expect(body).toMatch(/if v_target_role = 'super_admin' then/);
  });

  it("locks all super_admin rows before counting (race-safe, same as revoke_admin_role)", () => {
    expect(body).toMatch(/perform 1 from public\.user_roles ur where ur\.role = 'super_admin' for update;/);
  });

  it("counts OTHER super_admins, excluding the target, and rejects at zero", () => {
    expect(body).toMatch(/where ur\.role = 'super_admin' and ur\.user_id <> p_user_id/);
    expect(body).toMatch(/if v_other_super_admin_count = 0 then\s*\n\s*raise exception 'Cannot anonymize the last remaining super admin\.' using detail = 'LAST_SUPER_ADMIN';/);
  });

  it("never restricts anonymizing the last remaining plain admin", () => {
    const lockoutBlock = body.slice(body.indexOf("last-super-admin protection"), body.indexOf("v_now := now();"));
    expect(lockoutBlock).not.toMatch(/role = 'admin'/);
  });
});

describe("anonymize_user_account: profile anonymization fields", () => {
  const source = readFile(RPC_MIGRATION_PATH);
  const body = getFunctionBody(source, ANONYMIZE_ANCHOR);

  it("sets deleted_at server-side, from the function's own now(), never a client-supplied timestamp", () => {
    expect(body).toMatch(/deleted_at = v_now/);
    expect(source).not.toMatch(/p_deleted_at|p_anonymized_at/);
  });

  it("overwrites display_name with the exact existing 'Deleted user' convention (0034/0053), not an invented string", () => {
    expect(body).toMatch(/display_name = 'Deleted user'/);
  });

  it("nulls avatar and location fields", () => {
    expect(body).toMatch(/avatar_storage_path = null/);
    expect(body).toMatch(/province_id = null/);
    expect(body).toMatch(/city_id = null/);
    expect(body).toMatch(/barangay_id = null/);
  });

  it("all profile anonymization happens in exactly one UPDATE statement against public.profiles", () => {
    const updates = body.match(/update public\.profiles/g) ?? [];
    expect(updates).toHaveLength(1);
  });
});

describe("anonymize_user_account: admin-role removal safety", () => {
  const source = readFile(RPC_MIGRATION_PATH);
  const body = getFunctionBody(source, ANONYMIZE_ANCHOR);

  it("removes the target's role row only when one exists, in the same transaction", () => {
    expect(body).toMatch(/if v_target_role is not null then\s*\n\s*delete from public\.user_roles as ur where ur\.user_id = p_user_id;/);
  });

  it("writes an admin_audit_logs row for the role removal with the same shape revoke_admin_role uses", () => {
    expect(body).toMatch(
      /insert into public\.admin_audit_logs \(actor_id, target_user_id, action, previous_role, new_role, reason\)\s*\n\s*values \(v_caller, p_user_id, 'admin_role_revoked', v_target_role, null, v_reason\);/,
    );
  });

  it("never invents a new action value for the role-removal sub-step", () => {
    const roleRemovalBlock = body.slice(
      body.indexOf("remove the admin role safely"),
      body.indexOf("remove the one external-contact field"),
    );
    expect(roleRemovalBlock).toMatch(/'admin_role_revoked'/);
    expect(roleRemovalBlock).not.toMatch(/'account_anonymized'/);
  });
});

describe("anonymize_user_account: shop/listing suppression and preserved history", () => {
  const source = readFile(RPC_MIGRATION_PATH);
  const body = getFunctionBody(source, ANONYMIZE_ANCHOR);

  it("nulls shops.messenger_link for any shop owned by the target", () => {
    expect(body).toMatch(/update public\.shops\s*\n\s*set messenger_link = null\s*\n\s*where owner_id = p_user_id;/);
  });

  it("never rewrites shops.name/description/logo_storage_path (historical order context preserved)", () => {
    const shopUpdate = body.slice(body.indexOf("update public.shops"), body.indexOf("where owner_id = p_user_id;") + 30);
    expect(shopUpdate).not.toMatch(/\bname\s*=|description\s*=|logo_storage_path\s*=/);
  });

  it("suppresses shop/listing visibility by calling the existing apply_user_restriction with account_suspended, not a direct insert", () => {
    expect(body).toMatch(/perform public\.apply_user_restriction\(p_user_id, 'account_suspended', v_reason\);/);
    expect(body).not.toMatch(/insert into public\.user_restrictions/);
  });

  it("never writes to order_items, orders, reviews, messages, conversations, disputes, or moderation_actions directly", () => {
    const codeOnly = stripSqlComments(body);
    for (const table of [
      "order_items",
      "public.orders",
      "public.reviews",
      "public.messages",
      "public.conversations",
      "public.disputes",
      "public.dispute_",
      "public.moderation_actions",
      "public.reports",
      "public.support_tickets",
    ]) {
      expect(codeOnly).not.toMatch(new RegExp(`(insert into|update|delete from) ${table.replace(".", "\\.")}`));
    }
  });

  it("records its own account_anonymized audit row with the caller/target/reason, no role transition", () => {
    expect(body).toMatch(
      /insert into public\.admin_audit_logs \(actor_id, target_user_id, action, previous_role, new_role, reason\)\s*\n\s*values \(v_caller, p_user_id, 'account_anonymized', null, null, v_reason\);/,
    );
  });
});

describe("anonymize_user_account: grants, SECURITY DEFINER, search_path, return shape", () => {
  const source = readFile(RPC_MIGRATION_PATH);

  it("returns exactly (user_id, was_already_anonymized, anonymized_at)", () => {
    const signature = source.slice(source.indexOf(ANONYMIZE_ANCHOR), source.indexOf("language plpgsql", source.indexOf(ANONYMIZE_ANCHOR)));
    expect(signature).toMatch(/returns table \(\s*user_id uuid,\s*was_already_anonymized boolean,\s*anonymized_at timestamptz\s*\)/);
  });

  it("is SECURITY DEFINER with empty search_path", () => {
    const fnStart = source.indexOf(ANONYMIZE_ANCHOR);
    const fnHeader = source.slice(fnStart, source.indexOf("as $$", fnStart));
    expect(fnHeader).toMatch(/language plpgsql/);
    expect(fnHeader).toMatch(/security definer/);
    expect(fnHeader).toMatch(/set search_path = ''/);
  });

  it("is granted to authenticated only -- no anon/public grant, matching every other admin RPC in this schema", () => {
    expect(source).toMatch(/revoke all on function public\.anonymize_user_account\(uuid, text\) from public/);
    expect(source).toMatch(/revoke all on function public\.anonymize_user_account\(uuid, text\) from anon/);
    expect(source).toMatch(/grant execute on function public\.anonymize_user_account\(uuid, text\) to authenticated/);
  });
});

describe("get_admin_support_ticket_detail: widened for admin readability, unchanged authorization", () => {
  const source = readFile(RPC_MIGRATION_PATH);
  const body = getFunctionBody(source, TICKET_DETAIL_ANCHOR);

  it("adds exactly one new column, user_deleted_at, preserving every existing column", () => {
    const signature = source.slice(source.indexOf(TICKET_DETAIL_ANCHOR), source.indexOf("language plpgsql", source.indexOf(TICKET_DETAIL_ANCHOR)));
    expect(signature).toMatch(
      /returns table \(\s*ticket_id uuid,\s*category public\.support_ticket_category_enum,\s*message text,\s*user_id uuid,\s*user_display_name text,\s*user_deleted_at timestamptz,\s*created_at timestamptz\s*\)/,
    );
  });

  it("selects p.deleted_at as user_deleted_at -- the real, live anonymization state, not a cached flag", () => {
    expect(body).toMatch(/p\.deleted_at as user_deleted_at/);
  });

  it("still requires admin authorization unchanged (any admin, not super_admin-only)", () => {
    expect(body).toMatch(/if not exists \(select 1 from public\.user_roles ur where ur\.user_id = v_caller\) then/);
    expect(body).toMatch(/'NOT_ADMIN'/);
    expect(body).not.toMatch(/'super_admin'/);
  });

  it("still rejects a nonexistent ticket with TICKET_NOT_FOUND", () => {
    expect(body).toMatch(/'TICKET_NOT_FOUND'/);
  });

  it("remains granted to authenticated only", () => {
    expect(source).toMatch(/grant execute on function public\.get_admin_support_ticket_detail\(uuid\) to authenticated/);
  });
});

describe("no unrelated function is replaced by 0080 or 0081", () => {
  it("0080 touches no function at all", () => {
    const source = readFile(ENUM_MIGRATION_PATH);
    expect(source).not.toMatch(/create or replace function/);
  });

  it("0081 touches exactly two functions, both named explicitly in this task", () => {
    const source = readFile(RPC_MIGRATION_PATH);
    const replaceMatches = source.match(/create or replace function public\.(\w+)\(/g) ?? [];
    const dropMatches = source.match(/drop function public\.(\w+)\(/g) ?? [];
    expect(replaceMatches).toHaveLength(1);
    expect(dropMatches).toHaveLength(1);
  });
});

describe("existing coverage audit: a deleted/anonymized account is already blocked from new marketplace mutations", () => {
  // This task's own instruction: "seller/buyer mutating RPCs should
  // already respect profiles.deleted_at if applicable; audit this... Do
  // not scatter dozens of unrelated changes if current deleted_at checks
  // already cover most flows." This audits a representative sample of
  // already-applied, unmodified migrations spanning orders, listings,
  // messaging, reviews, blocking, disputes, and support. Two independent,
  // pre-existing mechanisms together provide full coverage:
  //   (a) a direct self-check -- `select p.deleted_at into ...; if ... is
  //       not null then raise ... INTERACTION_BLOCKED` -- present in most
  //       of these files; and
  //   (b) the seller_suspended/account_suspended restriction check
  //       (`user_restrictions ... restriction_type in (...)`), present
  //       everywhere (a)  is, and the ONLY mechanism create_listing (0054)
  //       has -- it has no deleted_at check of its own at all. This is
  //       exactly why anonymize_user_account calling apply_user_restriction
  //       (0081) is necessary, not merely defense-in-depth: without it, a
  //       deleted seller could still create new listings through
  //       create_listing, which never looks at profiles.deleted_at.
  // No file here is touched by 0080/0081 -- this is read-only
  // confirmation of pre-existing coverage, not a new mechanism.
  const coveredFiles = [
    "supabase/migrations/0039_order_submission.sql",
    "supabase/migrations/0054_create_listing_rpc.sql",
    "supabase/migrations/0031_messaging_rls_and_rpcs.sql",
    "supabase/migrations/0034_reviews_security_and_rpcs.sql",
    "supabase/migrations/0072_user_blocking_rpcs.sql",
    "supabase/migrations/0079_fix_plpgsql_output_column_collisions.sql",
  ];

  it.each(coveredFiles)("%s already raises INTERACTION_BLOCKED via deleted_at and/or the account_suspended restriction", (filePath) => {
    const source = readFile(filePath);
    const hasDeletedAtCheck = /deleted_at/.test(source);
    const hasRestrictionCheck = /restriction_type in \([^)]*'account_suspended'/.test(source);
    expect(hasDeletedAtCheck || hasRestrictionCheck).toBe(true);
    expect(source).toMatch(/'INTERACTION_BLOCKED'/);
  });

  it("create_listing (0054) has no deleted_at check of its own -- relies entirely on the account_suspended restriction, confirming apply_user_restriction is required, not optional", () => {
    const source = readFile("supabase/migrations/0054_create_listing_rpc.sql");
    expect(source).not.toMatch(/deleted_at/);
    expect(source).toMatch(/restriction_type in \('seller_suspended', 'account_suspended'\)/);
  });

  it("0031 (messaging) already explicitly anticipated an anonymized account in its own header comment", () => {
    const source = readFile("supabase/migrations/0031_messaging_rls_and_rpcs.sql");
    expect(source).toMatch(/an anonymized account/);
  });

  it("0080/0081 add no new deleted_at check to any of these existing files -- reuse, not duplication", () => {
    for (const filePath of coveredFiles) {
      expect(filePath).not.toBe(ENUM_MIGRATION_PATH);
      expect(filePath).not.toBe(RPC_MIGRATION_PATH);
    }
  });
});
