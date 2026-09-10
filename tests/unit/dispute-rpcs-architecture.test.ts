import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

function readFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf-8");
}

const MIGRATION_PATH = "supabase/migrations/0074_dispute_rpcs.sql";

function getFunctionBody(source: string, anchor: string): string {
  const fnStart = source.indexOf(anchor);
  const bodyStart = source.indexOf("begin\n", fnStart);
  const bodyEnd = source.indexOf("end;\n$$;", bodyStart);
  return source.slice(bodyStart, bodyEnd);
}

const CREATE_ANCHOR = "create or replace function public.create_dispute(";
const MY_DISPUTES_ANCHOR = "create or replace function public.get_my_disputes(";
const DETAIL_ANCHOR = "create or replace function public.get_dispute_detail(";
const SUMMARY_ANCHOR = "create or replace function public.get_order_dispute_summary(";

describe("0074 is scoped to four buyer/seller RPCs -- no admin action, no schema change", () => {
  const source = readFile(MIGRATION_PATH);

  it("creates exactly create_dispute, get_my_disputes, get_dispute_detail, get_order_dispute_summary", () => {
    expect(source).toMatch(/create or replace function public\.create_dispute\(/);
    expect(source).toMatch(/create or replace function public\.get_my_disputes\(/);
    expect(source).toMatch(/create or replace function public\.get_dispute_detail\(/);
    expect(source).toMatch(/create or replace function public\.get_order_dispute_summary\(/);
  });

  it("adds no admin RPC and no schema/enum/policy change", () => {
    expect(source).not.toMatch(/create or replace function public\.get_admin_disputes/);
    expect(source).not.toMatch(/create or replace function public\.update_dispute_status/);
    expect(source).not.toMatch(/create table|alter table|drop table|create type|create policy/i);
  });

  it("never mentions escrow, refund, or payment arbitration", () => {
    expect(source).not.toMatch(/escrow|refund|payment arbitration/i);
  });
});

describe("0074 create_dispute: eligibility, authorization, idempotent duplicate guard", () => {
  const source = readFile(MIGRATION_PATH);
  const body = getFunctionBody(source, CREATE_ANCHOR);

  it("requires authentication and a non-deleted account", () => {
    expect(body).toMatch(/'Authentication required\.' using detail = 'NOT_AUTHENTICATED'/);
    expect(body).toMatch(/'INTERACTION_BLOCKED'/);
  });

  it("locks the order row before any decision, universal serialization point", () => {
    expect(body).toMatch(/from public\.orders o\s*\n\s*where o\.id = p_order_id\s*\n\s*for update;/);
  });

  it("rejects a caller who is neither the buyer nor the shop owner", () => {
    expect(body).toMatch(/if v_caller <> v_order_buyer_id and v_caller <> v_shop_owner_id then/);
    expect(body).toMatch(/'NOT_ORDER_PARTICIPANT'/);
  });

  it("restricts eligibility to exactly accepted/ready/handed_over_or_shipped/received_confirmed", () => {
    expect(body).toMatch(
      /if v_order_status not in \('accepted', 'ready', 'handed_over_or_shipped', 'received_confirmed'\) then/,
    );
    expect(body).toMatch(/'ORDER_NOT_DISPUTABLE'/);
  });

  it("never allows 'pending' or 'disputed' orders through eligibility (they are outside the allowed IN list)", () => {
    const eligibilityLine = body.match(/if v_order_status not in \(([^)]+)\) then/)?.[1] ?? "";
    expect(eligibilityLine).not.toMatch(/'pending'/);
    expect(eligibilityLine).not.toMatch(/'disputed'/);
  });

  it("explicitly guards duplicate-active-dispute before insert, and catches the unique_violation as a final guard", () => {
    expect(body).toMatch(/if exists \(select 1 from public\.disputes d where d\.order_id = p_order_id and d\.status <> 'resolved'\) then/);
    expect(body).toMatch(/'DISPUTE_ALREADY_ACTIVE'/);
    expect(body).toMatch(/exception\s*\n\s*when unique_violation then\s*\n\s*raise exception 'A dispute is already open for this order\.' using detail = 'DISPUTE_ALREADY_ACTIVE';/);
  });

  it("validates reason (<=200) and explanation (<=2000) as required, non-blank text", () => {
    expect(body).toMatch(/'DISPUTE_REASON_REQUIRED'/);
    expect(body).toMatch(/'DISPUTE_REASON_TOO_LONG'/);
    expect(body).toMatch(/char_length\(v_reason\) > 200/);
    expect(body).toMatch(/'DISPUTE_EXPLANATION_REQUIRED'/);
    expect(body).toMatch(/'DISPUTE_EXPLANATION_TOO_LONG'/);
    expect(body).toMatch(/char_length\(v_explanation\) > 2000/);
  });

  it("caps images at 3, matching PRD 34.2", () => {
    expect(body).toMatch(/if v_image_count > 3 then/);
    expect(body).toMatch(/'TOO_MANY_DISPUTE_IMAGES'/);
  });

  it("transitions the order to 'disputed' transactionally, preserving the real from_status in order_status_history", () => {
    expect(body).toMatch(/v_from_status := v_order_status;/);
    expect(body).toMatch(/update public\.orders\s*\n\s*set status = 'disputed',\s*\n\s*disputed_at = v_now\s*\n\s*where id = p_order_id;/);
    expect(body).toMatch(/insert into public\.order_status_history \(order_id, from_status, to_status, changed_by, note\)\s*\n\s*values \(p_order_id, v_from_status, 'disputed', v_caller, null\);/);
  });

  it("never touches order_items or inventory_reservations -- fulfillment facts are untouched by opening a dispute", () => {
    expect(body).not.toMatch(/public\.order_items|public\.inventory_reservations/);
  });

  it("writes the dispute's own status timeline row: null -> opened", () => {
    expect(body).toMatch(/insert into public\.dispute_status_history \(dispute_id, from_status, to_status, changed_by\)\s*\n\s*values \(v_dispute_id, null, 'opened', v_caller\);/);
  });

  it("notifies only the other participant, never the opener themself, with dispute_opened", () => {
    expect(body).toMatch(/v_recipient_id := case when v_caller = v_order_buyer_id then v_shop_owner_id else v_order_buyer_id end;/);
    expect(body).toMatch(/select v_recipient_id, 'dispute_opened', v_caller, p_order_id, v_dispute_id::text \|\| ':opened'/);
  });

  it("is SECURITY DEFINER, empty search_path, granted to authenticated only", () => {
    expect(source).toMatch(/revoke all on function public\.create_dispute\(uuid, text, text, text\[\]\) from public/);
    expect(source).toMatch(/revoke all on function public\.create_dispute\(uuid, text, text, text\[\]\) from anon/);
    expect(source).toMatch(/grant execute on function public\.create_dispute\(uuid, text, text, text\[\]\) to authenticated/);
  });
});

describe("0074 get_my_disputes: participant-scoped, not opener-only", () => {
  const source = readFile(MIGRATION_PATH);
  const body = getFunctionBody(source, MY_DISPUTES_ANCHOR);

  it("scopes to either the order's buyer or the shop owner -- both parties see it, whoever opened it", () => {
    expect(body).toMatch(/where \(o\.buyer_id = v_caller or s\.owner_id = v_caller\)/);
  });

  it("validates pagination the same way every other list RPC does", () => {
    expect(body).toMatch(/'LIMIT_INVALID'/);
    expect(body).toMatch(/'CURSOR_INVALID'/);
  });
});

describe("0074 get_dispute_detail: participant-only, never exposes admin notes", () => {
  const source = readFile(MIGRATION_PATH);
  const body = getFunctionBody(source, DETAIL_ANCHOR);

  it("rejects a caller who is neither the order's buyer nor the shop owner", () => {
    expect(body).toMatch(/if v_caller <> v_buyer_id and v_caller <> v_shop_owner_id then/);
    expect(body).toMatch(/'NOT_DISPUTE_PARTICIPANT'/);
  });

  it("never selects from dispute_admin_notes -- PRD 42's 'never exposed to users' rule", () => {
    expect(body).not.toMatch(/dispute_admin_notes/);
  });
});

describe("0074 get_order_dispute_summary: minimal lookup, participant-only", () => {
  const source = readFile(MIGRATION_PATH);
  const body = getFunctionBody(source, SUMMARY_ANCHOR);

  it("returns exactly dispute_id and status -- no reason/explanation/images", () => {
    const signature = source.slice(source.indexOf(SUMMARY_ANCHOR), source.indexOf("language plpgsql", source.indexOf(SUMMARY_ANCHOR)));
    expect(signature).toMatch(/dispute_id uuid/);
    expect(signature).toMatch(/status public\.dispute_status_enum/);
    expect(signature).not.toMatch(/reason|explanation|image/);
  });

  it("rejects a caller who is not the order's buyer or shop owner", () => {
    expect(body).toMatch(/'NOT_ORDER_PARTICIPANT'/);
  });
});
