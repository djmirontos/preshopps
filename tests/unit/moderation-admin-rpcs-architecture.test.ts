import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

function readFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf-8");
}

const MIGRATION_PATH = "supabase/migrations/0067_moderation_admin_rpcs.sql";

function getFunctionBody(source: string, fnName: string, afterMarker?: string): string {
  const searchFrom = afterMarker ? source.indexOf(afterMarker) : 0;
  const start = source.indexOf(`create or replace function public.${fnName}(`, searchFrom);
  const bodyStart = source.indexOf("begin\n", start);
  const bodyEnd = source.indexOf("end;\n$$;", bodyStart);
  return source.slice(bodyStart, bodyEnd);
}

const ADMIN_RPCS = [
  { name: "get_admin_reports", sig: "public.report_status_enum, integer, timestamptz, uuid" },
  { name: "get_admin_report_detail", sig: "uuid" },
  { name: "resolve_admin_report", sig: "uuid, public.report_status_enum, text" },
  { name: "apply_user_restriction", sig: "uuid, public.restriction_type_enum, text" },
  { name: "lift_user_restriction", sig: "uuid, text" },
  { name: "get_admin_user_restrictions", sig: "uuid" },
];

describe("0067 is scoped to seven new RPCs -- no schema/enum change, no existing RPC redefined", () => {
  const source = readFile(MIGRATION_PATH);

  it("creates exactly submit_report plus six admin RPCs", () => {
    expect(source).toMatch(/create or replace function public\.submit_report\(/);
    for (const rpc of ADMIN_RPCS) {
      expect(source).toMatch(new RegExp(`create or replace function public\\.${rpc.name}\\(`));
    }
  });

  it("never touches recalculate_trusted_seller's own definition -- only calls it", () => {
    expect(source).not.toMatch(/create or replace function public\.recalculate_trusted_seller/);
    expect(source).toMatch(/perform public\.recalculate_trusted_seller\(/);
  });

  it("never redefines any other existing RPC", () => {
    expect(source).not.toMatch(/create or replace function public\.(create|update)_listing\(/i);
    expect(source).not.toMatch(/create or replace function public\.publish_listing/i);
    expect(source).not.toMatch(/create or replace function public\.complete_order/i);
    expect(source).not.toMatch(/create or replace function public\.create_review\(/i);
    expect(source).not.toMatch(/create or replace function public\.update_review\(/i);
  });

  it("submit_report is granted to authenticated only (not anon)", () => {
    expect(source).toMatch(/revoke all on function public\.submit_report\([^)]*\) from public/);
    expect(source).toMatch(/revoke all on function public\.submit_report\([^)]*\) from anon/);
    expect(source).toMatch(/grant execute on function public\.submit_report\([^)]*\) to authenticated/);
  });

  it("every admin RPC is granted to authenticated (role-checked inside the body), never to anon", () => {
    for (const rpc of ADMIN_RPCS) {
      const grantPattern = new RegExp(`grant execute on function public\\.${rpc.name}\\([^)]*\\) to authenticated`);
      const anonPattern = new RegExp(`grant execute on function public\\.${rpc.name}\\([^)]*\\) to anon`);
      expect(source).toMatch(grantPattern);
      expect(source).not.toMatch(anonPattern);
    }
  });

  it("every admin RPC checks user_roles for the caller before touching any application data", () => {
    for (const rpc of ADMIN_RPCS) {
      const body = getFunctionBody(source, rpc.name);
      expect(body).toMatch(/exists \(select 1 from public\.user_roles ur where ur\.user_id = v_caller\)/);
      expect(body).toMatch(/'Admin access required\.' using detail = 'NOT_ADMIN'/);
    }
  });

  it("no RPC ever branches on role = 'super_admin' specifically -- admin and super_admin are treated identically", () => {
    const codeOnly = source
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");
    expect(codeOnly).not.toMatch(/'super_admin'/);
  });

  it("no RPC accepts a client-supplied role/admin flag", () => {
    const codeOnly = source
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");
    expect(codeOnly).not.toMatch(/p_role|p_is_admin|p_admin/);
  });
});

describe("0067 submit_report", () => {
  const source = readFile(MIGRATION_PATH);
  const body = getFunctionBody(source, "submit_report");

  it("requires authentication and blocks a deleted caller", () => {
    expect(body).toMatch(/'Authentication required\.' using detail = 'NOT_AUTHENTICATED'/);
    expect(body).toMatch(/'Your account cannot submit reports\.' using detail = 'INTERACTION_BLOCKED'/);
  });

  it("caps description length at 1000 chars", () => {
    expect(body).toMatch(/char_length\(v_description\) > 1000/);
    expect(body).toMatch(/'REPORT_DESCRIPTION_TOO_LONG'/);
  });

  it("validates existence and rejects self-report for listing/shop/review targets", () => {
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

  it("never applies a restriction or mutates any target row -- only inserts into reports", () => {
    expect(body).not.toMatch(/update public\.(listings|shops|reviews|conversations)/);
    expect(body).not.toMatch(/insert into public\.user_restrictions/);
    expect(body).toMatch(/insert into public\.reports/);
  });

  it("never accepts a client-supplied reporter id -- reporter_id is always auth.uid()", () => {
    expect(body).not.toMatch(/p_reporter_id/);
    expect(body).toMatch(/insert into public\.reports \(reporter_id,[\s\S]*?values \(v_caller,/);
  });
});

describe("0067 get_admin_reports / get_admin_report_detail -- read-only, privacy-conscious projections", () => {
  const source = readFile(MIGRATION_PATH);

  it("get_admin_reports is cursor-paginated on (created_at, id) DESC with a [1,50] limit clamp, same as every other admin list RPC", () => {
    const body = getFunctionBody(source, "get_admin_reports");
    expect(body).toMatch(/if p_limit is null or p_limit < 1 or p_limit > 50 then/);
    expect(body).toMatch(/order by r\.created_at desc, r\.id desc/);
    expect(body).toMatch(/\(r\.created_at, r\.id\) < \(p_before_created_at, p_before_id\)/);
  });

  it("get_admin_reports never selects a reporter email or raw auth identity -- only display_name", () => {
    const body = getFunctionBody(source, "get_admin_reports");
    expect(body).not.toMatch(/\.email\b/);
    expect(body).toMatch(/rp\.display_name as reporter_display_name/);
  });

  it("get_admin_report_detail raises REPORT_NOT_FOUND for a missing report and resolves every one of the four target shapes", () => {
    const body = getFunctionBody(source, "get_admin_report_detail");
    expect(body).toMatch(/'Report not found\.' using detail = 'REPORT_NOT_FOUND'/);
    expect(body).toMatch(/listing_shop_owner_id/);
    expect(body).toMatch(/shop_owner_id/);
    expect(body).toMatch(/review_author_id/);
    expect(body).toMatch(/conversation_buyer_id/);
    expect(body).toMatch(/conversation_shop_owner_id/);
  });

  it("get_admin_report_detail never selects an email anywhere in its wide projection", () => {
    const body = getFunctionBody(source, "get_admin_report_detail");
    expect(body).not.toMatch(/\.email\b/);
  });
});

describe("0067 resolve_admin_report", () => {
  const source = readFile(MIGRATION_PATH);
  const body = getFunctionBody(source, "resolve_admin_report");

  it("rejects 'pending' as a target status before locking any row", () => {
    const inputCheckIndex = body.indexOf("structural input validation");
    const lockIndex = body.indexOf("lock the report row");
    expect(inputCheckIndex).toBeGreaterThan(-1);
    expect(lockIndex).toBeGreaterThan(inputCheckIndex);
    expect(body).toMatch(/if p_status is null or p_status = 'pending' then/);
    expect(body).toMatch(/'TARGET_STATUS_NOT_ALLOWED'/);
  });

  it("is idempotent -- requesting the current status is a safe no-op", () => {
    expect(body).toMatch(/if v_current_status = p_status then/);
    expect(body).toMatch(/select p_report_id, v_current_status, true, v_current_resolved_at;/);
  });

  it("never applies or lifts a restriction -- resolving a report is independent of acting on its target", () => {
    expect(body).not.toMatch(/insert into public\.user_restrictions/);
    expect(body).not.toMatch(/recalculate_trusted_seller/);
  });

  it("caps the resolution note at 1000 chars", () => {
    expect(body).toMatch(/char_length\(v_note\) > 1000/);
    expect(body).toMatch(/'RESOLUTION_NOTE_TOO_LONG'/);
  });
});

describe("0067 apply_user_restriction", () => {
  const source = readFile(MIGRATION_PATH);
  const body = getFunctionBody(source, "apply_user_restriction");

  it("requires a non-blank reason before locking any row", () => {
    const reasonCheckIndex = body.indexOf("REASON_REQUIRED");
    const lockIndex = body.indexOf("lock the target profile row");
    expect(reasonCheckIndex).toBeGreaterThan(-1);
    expect(lockIndex).toBeGreaterThan(reasonCheckIndex);
    expect(body).toMatch(/v_reason := btrim\(p_reason\);/);
    expect(body).toMatch(/if v_reason is null or length\(v_reason\) = 0 then/);
  });

  it("locks the target profile row FOR UPDATE as the universal serialization point", () => {
    expect(body).toMatch(/perform 1 from public\.profiles p where p\.id = p_user_id for update;/);
    expect(body).toMatch(/'User not found\.' using detail = 'USER_NOT_FOUND'/);
  });

  it("is idempotent -- an already-active restriction of the same type is a safe no-op, no duplicate row", () => {
    expect(body).toMatch(/and ur\.lifted_at is null/);
    expect(body).toMatch(/select v_existing_id, p_user_id, p_restriction_type, true, v_existing_created_at;/);
  });

  it("writes exactly one user_restrictions row and one moderation_actions row on a genuine apply", () => {
    const inserts = body.match(/insert into public\./g) ?? [];
    expect(inserts).toHaveLength(2);
    expect(body).toMatch(/insert into public\.user_restrictions \(user_id, restriction_type, reason, issued_by\)/);
    expect(body).toMatch(/insert into public\.moderation_actions \(admin_id, action_type, target_user_id, restriction_type, restriction_id, reason\)\s*\n\s*values \(v_caller, 'restriction_applied'/);
  });

  it("never accepts a client-supplied issued_by/admin id -- issued_by is always the caller", () => {
    expect(body).not.toMatch(/p_issued_by|p_admin_id/);
    expect(body).toMatch(/values \(p_user_id, p_restriction_type, v_reason, v_caller\)/);
  });

  it("recalculates Trusted Seller only for seller_suspended/account_suspended, never for buyer_restricted", () => {
    expect(body).toMatch(/if p_restriction_type in \('seller_suspended', 'account_suspended'\) then/);
    expect(body).not.toMatch(/'buyer_restricted'[\s\S]*recalculate_trusted_seller/);
  });

  it("resolves the target's shop via shops.owner_id, and skips the recalculation call entirely when no shop exists", () => {
    expect(body).toMatch(/select s\.id into v_shop_id from public\.shops s where s\.owner_id = p_user_id;/);
    expect(body).toMatch(/if found then\s*\n\s*perform public\.recalculate_trusted_seller\(v_shop_id\);\s*\n\s*end if;/);
  });
});

describe("0067 lift_user_restriction", () => {
  const source = readFile(MIGRATION_PATH);
  const body = getFunctionBody(source, "lift_user_restriction");

  it("locks the specific restriction row by id FOR UPDATE", () => {
    expect(body).toMatch(/from public\.user_restrictions ur\s*\n\s*where ur\.id = p_restriction_id\s*\n\s*for update;/);
    expect(body).toMatch(/'Restriction not found\.' using detail = 'RESTRICTION_NOT_FOUND'/);
  });

  it("is idempotent -- an already-lifted row is a safe no-op", () => {
    expect(body).toMatch(/if v_existing_lifted_at is not null then/);
    expect(body).toMatch(/select p_restriction_id, v_user_id, v_restriction_type, true, v_existing_lifted_at;/);
  });

  it("does not require a note to lift a restriction (optional, unlike applying one)", () => {
    expect(body).not.toMatch(/'A note is required'|NOTE_REQUIRED/);
    expect(body).toMatch(/v_note := nullif\(btrim\(p_note\), ''\);/);
  });

  it("only ever writes lifted_at/lifted_by on the target row -- reason/issued_by/created_at untouched", () => {
    const updateBlock = body.slice(body.indexOf("update public.user_restrictions"), body.indexOf("insert into public.moderation_actions"));
    expect(updateBlock).toMatch(/set lifted_at = v_lifted_at,\s*\n\s*lifted_by = v_caller/);
    expect(updateBlock).not.toMatch(/reason\s*=/);
    expect(updateBlock).not.toMatch(/issued_by\s*=/);
  });

  it("writes exactly one moderation_actions row (action_type = restriction_lifted) on a genuine lift", () => {
    expect(body).toMatch(/insert into public\.moderation_actions \(admin_id, action_type, target_user_id, restriction_type, restriction_id, reason\)\s*\n\s*values \(v_caller, 'restriction_lifted'/);
  });

  it("recalculates Trusted Seller only for seller_suspended/account_suspended, gated on the restriction's own stored type", () => {
    expect(body).toMatch(/if v_restriction_type in \('seller_suspended', 'account_suspended'\) then/);
    expect(body).toMatch(/select s\.id into v_shop_id from public\.shops s where s\.owner_id = v_user_id;/);
  });
});

describe("0067 get_admin_user_restrictions", () => {
  const source = readFile(MIGRATION_PATH);
  const body = getFunctionBody(source, "get_admin_user_restrictions");

  it("returns full restriction history (current and historical) newest first, with issuer/lifter display names", () => {
    expect(body).toMatch(/order by ur\.created_at desc;/);
    expect(body).toMatch(/ip\.display_name as issued_by_display_name/);
    expect(body).toMatch(/lp\.display_name as lifted_by_display_name/);
  });

  it("raises USER_NOT_FOUND for a nonexistent user before querying restrictions", () => {
    expect(body).toMatch(/'User not found\.' using detail = 'USER_NOT_FOUND'/);
  });
});
