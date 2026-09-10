import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

function readFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf-8");
}

const MIGRATION_PATH = "supabase/migrations/0075_admin_dispute_rpcs.sql";

function getFunctionBody(source: string, anchor: string): string {
  const fnStart = source.indexOf(anchor);
  const bodyStart = source.indexOf("begin\n", fnStart);
  const bodyEnd = source.indexOf("end;\n$$;", bodyStart);
  return source.slice(bodyStart, bodyEnd);
}

const QUEUE_ANCHOR = "create or replace function public.get_admin_disputes(";
const DETAIL_ANCHOR = "create or replace function public.get_admin_dispute_detail(";
const MESSAGES_ANCHOR = "create or replace function public.get_admin_dispute_messages(";
const NOTE_ANCHOR = "create or replace function public.add_dispute_admin_note(";
const STATUS_ANCHOR = "create or replace function public.update_dispute_status(";
const CANCEL_ANCHOR = "create or replace function public.admin_cancel_disputed_order(";
const COMPLETE_ANCHOR = "create or replace function public.admin_complete_disputed_order(";
const COMPLETE_ORDER_ANCHOR = "create or replace function public.complete_order(p_order_id uuid)";

describe("0075 is scoped to seven dispute-admin RPCs plus a widened complete_order", () => {
  const source = readFile(MIGRATION_PATH);

  it("creates exactly the seven named admin RPCs", () => {
    for (const anchor of [QUEUE_ANCHOR, DETAIL_ANCHOR, MESSAGES_ANCHOR, NOTE_ANCHOR, STATUS_ANCHOR, CANCEL_ANCHOR, COMPLETE_ANCHOR]) {
      expect(source).toMatch(new RegExp(anchor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
  });

  it("redefines complete_order under its identical uuid signature -- never a DROP FUNCTION", () => {
    expect(source).toMatch(/create or replace function public\.complete_order\(p_order_id uuid\)/);
    expect(source).not.toMatch(/drop function/i);
  });

  it("never redefines cancel_accepted_order -- a fresh admin_cancel_disputed_order is used instead", () => {
    expect(source).not.toMatch(/create or replace function public\.cancel_accepted_order/);
  });

  it("creates no new table/enum/policy", () => {
    expect(source).not.toMatch(/create table|alter table|create type|create policy/i);
  });

  it("never mentions escrow, refund, or payment arbitration", () => {
    expect(source).not.toMatch(/escrow|refund|payment arbitration/i);
  });
});

for (const [name, anchor] of [
  ["get_admin_disputes", QUEUE_ANCHOR],
  ["get_admin_dispute_detail", DETAIL_ANCHOR],
  ["get_admin_dispute_messages", MESSAGES_ANCHOR],
  ["add_dispute_admin_note", NOTE_ANCHOR],
  ["update_dispute_status", STATUS_ANCHOR],
  ["admin_cancel_disputed_order", CANCEL_ANCHOR],
  ["admin_complete_disputed_order", COMPLETE_ANCHOR],
] as const) {
  describe(`0075 ${name}: admin authorization`, () => {
    const source = readFile(MIGRATION_PATH);
    const body = getFunctionBody(source, anchor);

    it("requires authentication then admin role, the same role-agnostic user_roles check as 0067/0070", () => {
      expect(body).toMatch(/'NOT_AUTHENTICATED'/);
      expect(body).toMatch(/if not exists \(select 1 from public\.user_roles ur where ur\.user_id = v_caller\) then/);
      expect(body).toMatch(/'NOT_ADMIN'/);
    });
  });
}

describe("0075 get_admin_dispute_detail: full context, admin notes as a nested aggregate", () => {
  const source = readFile(MIGRATION_PATH);
  const body = getFunctionBody(source, DETAIL_ANCHOR);

  it("aggregates dispute_admin_notes via jsonb_agg -- one round trip, admin-only exposure", () => {
    expect(body).toMatch(/jsonb_agg\(/);
    expect(body).toMatch(/from public\.dispute_admin_notes dan/);
  });

  it("exposes both parties' identity (buyer and shop owner) for admin context", () => {
    expect(body).toMatch(/o\.buyer_id/);
    expect(body).toMatch(/s\.owner_id as shop_owner_id/);
  });
});

describe("0075 get_admin_dispute_messages: dispute-scoped, buyer+shop conversation history", () => {
  const source = readFile(MIGRATION_PATH);
  const body = getFunctionBody(source, MESSAGES_ANCHOR);

  it("resolves the order's buyer and shop, then joins every matching conversation's messages", () => {
    expect(body).toMatch(/select o\.buyer_id, o\.shop_id into v_buyer_id, v_shop_id/);
    expect(body).toMatch(/where c\.initiator_id = v_buyer_id\s*\n\s*and c\.shop_id = v_shop_id/);
  });

  it("orders oldest first for a readable timeline", () => {
    expect(body).toMatch(/order by m\.created_at asc, m\.id asc/);
  });
});

describe("0075 add_dispute_admin_note", () => {
  const source = readFile(MIGRATION_PATH);
  const body = getFunctionBody(source, NOTE_ANCHOR);

  it("requires a non-blank note capped at 2000 chars", () => {
    expect(body).toMatch(/'NOTE_REQUIRED'/);
    expect(body).toMatch(/'NOTE_TOO_LONG'/);
    expect(body).toMatch(/char_length\(v_note\) > 2000/);
  });

  it("records the acting admin's own id, never a client-supplied admin id", () => {
    expect(body).toMatch(/values \(p_dispute_id, v_caller, v_note\)/);
  });
});

describe("0075 update_dispute_status: forward-only, never touches orders", () => {
  const source = readFile(MIGRATION_PATH);
  const body = getFunctionBody(source, STATUS_ANCHOR);

  it("rejects any transition once already resolved", () => {
    expect(body).toMatch(/if v_current_status = 'resolved' then\s*\n\s*raise exception 'This dispute is already resolved\.' using detail = 'DISPUTE_ALREADY_RESOLVED';/);
  });

  it("rejects moving backward from under_review to opened", () => {
    expect(body).toMatch(/if v_current_status = 'under_review' and p_status = 'opened' then/);
    expect(body).toMatch(/'DISPUTE_STATUS_BACKWARD_NOT_ALLOWED'/);
  });

  it("never updates public.orders -- resolving a dispute does not restore or change order status", () => {
    expect(body).not.toMatch(/update public\.orders/);
  });

  it("stamps resolved_by/resolved_at together only when transitioning to resolved", () => {
    expect(body).toMatch(/if p_status = 'resolved' then\s*\n\s*update public\.disputes\s*\n\s*set status = 'resolved',\s*\n\s*resolved_by = v_caller,\s*\n\s*resolved_at = v_now/);
  });

  it("notifies both order participants only when the new status is resolved", () => {
    const resolvedBlock = body.slice(body.indexOf("notification: both order participants"));
    expect(resolvedBlock).toMatch(/'dispute_resolved'/);
    expect(resolvedBlock).toMatch(/o\.buyer_id/);
    expect(resolvedBlock).toMatch(/s\.owner_id/);
  });
});

describe("0075 admin_cancel_disputed_order: fresh function, admin-authorized, disputed-only", () => {
  const source = readFile(MIGRATION_PATH);
  const body = getFunctionBody(source, CANCEL_ANCHOR);

  it("only a currently-disputed order is eligible", () => {
    expect(body).toMatch(/if v_order_status <> 'disputed' then/);
    expect(body).toMatch(/'ORDER_NOT_CANCELLABLE'/);
  });

  it("requires a non-blank cancellation reason", () => {
    expect(body).toMatch(/'INVALID_CANCELLATION_REASON'/);
  });

  it("releases reservations back to available, the same arithmetic shape as cancel_accepted_order", () => {
    expect(body).toMatch(/status = 'released',\s*\n\s*resolved_at = now\(\)/);
    expect(body).toMatch(/'available'::public\.listing_status_enum/);
  });

  it("writes order_status_history with the honest from_status 'disputed'", () => {
    expect(body).toMatch(/values \(v_order_id, 'disputed', 'cancelled', v_caller, v_reason\);/);
  });

  it("notifies both buyer and shop owner -- admin is the actor, neither is self-notifying", () => {
    expect(body).toMatch(/select v_order_buyer_id, 'order_cancelled', v_caller,/);
    expect(body).toMatch(/select v_shop_owner_id, 'order_cancelled', v_caller,/);
  });
});

describe("0075 admin_complete_disputed_order: delegates entirely to complete_order, no duplicated arithmetic", () => {
  const source = readFile(MIGRATION_PATH);
  const body = getFunctionBody(source, COMPLETE_ANCHOR);

  it("contains no reservation/stock arithmetic of its own", () => {
    expect(body).not.toMatch(/inventory_reservations|stock_quantity|reserved_quantity/);
  });

  it("calls public.complete_order with the dispute's own order id", () => {
    expect(body).toMatch(/from public\.complete_order\(v_order_id\) c/);
  });
});

describe("0075 complete_order (widened): accepts 'disputed' as well as 'received_confirmed'", () => {
  const source = readFile(MIGRATION_PATH);
  const body = getFunctionBody(source, COMPLETE_ORDER_ANCHOR);

  it("widens the eligibility check to include 'disputed'", () => {
    expect(body).toMatch(/if v_order_status not in \('received_confirmed', 'disputed'\) then/);
  });

  it("captures the real from_status in a variable instead of a hardcoded 'received_confirmed' literal", () => {
    expect(body).toMatch(/v_from_status := v_order_status;/);
    expect(body).toMatch(/values \(p_order_id, v_from_status, 'completed', null, null\);/);
    expect(body).not.toMatch(/values \(p_order_id, 'received_confirmed', 'completed', null, null\);/);
  });

  it("preserves the Trusted Seller recalculation call and both-party order_completed notifications unchanged", () => {
    expect(body).toMatch(/perform public\.recalculate_trusted_seller\(v_order_shop_id\);/);
    expect(body).toMatch(/select v_order_buyer_id, 'order_completed', null,/);
    expect(body).toMatch(/select v_shop_owner_id, 'order_completed', null,/);
  });

  it("remains service_role-only -- never granted to authenticated directly", () => {
    expect(source).toMatch(/revoke all on function public\.complete_order\(uuid\) from authenticated;/);
    expect(source).toMatch(/grant execute on function public\.complete_order\(uuid\) to service_role;/);
    expect(source).not.toMatch(/grant execute on function public\.complete_order\(uuid\) to authenticated/);
  });
});
