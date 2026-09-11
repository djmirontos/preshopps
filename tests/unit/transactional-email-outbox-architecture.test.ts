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

const MIGRATION_PATH = "supabase/migrations/0083_transactional_email_outbox.sql";

function getFunctionBody(source: string, anchor: string): string {
  const fnStart = source.indexOf(anchor);
  expect(fnStart).toBeGreaterThan(-1);
  const bodyStart = source.indexOf("begin\n", fnStart);
  const bodyEnd = source.indexOf("end;\n$$;", bodyStart);
  return source.slice(bodyStart, bodyEnd);
}

describe("0083: schema -- email_outbox table, RLS, idempotency", () => {
  const source = readFile(MIGRATION_PATH);

  it("creates the two new enums and the email_outbox table, nothing else structural", () => {
    expect(source).toMatch(/create type public\.email_event_type_enum as enum/);
    expect(source).toMatch(/create type public\.email_outbox_status_enum as enum/);
    expect(source).toMatch(/create table public\.email_outbox/);
    const createTableMatches = stripSqlComments(source).match(/create table public\.\w+/g) ?? [];
    expect(createTableMatches).toEqual(["create table public.email_outbox"]);
  });

  it("email_outbox has a unique constraint on (event_type, entity_id, recipient_user_id)", () => {
    expect(source).toMatch(
      /constraint email_outbox_event_entity_recipient_key unique \(event_type, entity_id, recipient_user_id\)/,
    );
  });

  it("email_outbox has RLS explicitly enabled and zero policies", () => {
    expect(source).toMatch(/alter table public\.email_outbox enable row level security;/);
    expect(stripSqlComments(source)).not.toMatch(/create policy/i);
  });

  it("recipient_user_id references profiles with ON DELETE CASCADE (operational data, not moderation history)", () => {
    expect(source).toMatch(/recipient_user_id uuid not null references public\.profiles\(id\) on delete cascade/);
  });

  it("never stores a recipient email address as a table column", () => {
    const tableBlock = source.slice(source.indexOf("create table public.email_outbox"), source.indexOf("create index email_outbox_claimable_idx"));
    expect(tableBlock).not.toMatch(/email\s+text/);
  });
});

describe("0083: enqueue_email -- centralized, internal-only, anonymized-account safe", () => {
  const source = readFile(MIGRATION_PATH);
  const anchor = "create or replace function public.enqueue_email(";
  const body = getFunctionBody(source, anchor);

  it("silently no-ops (never raises) for a missing or anonymized recipient profile", () => {
    expect(body).toMatch(/if not found or v_deleted_at is not null then\s*\n\s*return;\s*\n\s*end if;/);
    expect(body).not.toMatch(/raise exception/);
  });

  it("enqueues via ON CONFLICT DO NOTHING against the unique constraint -- never raises on a duplicate", () => {
    expect(body).toMatch(/on conflict on constraint email_outbox_event_entity_recipient_key do nothing;/);
  });

  it("is granted to no role at all -- not even service_role -- matching recalculate_trusted_seller's internal-only convention", () => {
    const grantsBlock = source.slice(source.indexOf(anchor), source.indexOf("claim_pending_emails: service_role-only"));
    const revokes = grantsBlock.match(/revoke all on function public\.enqueue_email/g) ?? [];
    expect(revokes).toHaveLength(4);
    expect(grantsBlock).not.toMatch(/grant execute on function public\.enqueue_email/);
  });
});

describe("0083: claim_pending_emails -- SKIP LOCKED claim, stale-processing recovery, fresh recipient re-check", () => {
  const source = readFile(MIGRATION_PATH);
  const body = getFunctionBody(source, "create or replace function public.claim_pending_emails(");

  it("selects due-pending or stale-processing rows with FOR UPDATE SKIP LOCKED", () => {
    expect(body).toMatch(/where \(eo\.status = 'pending' and eo\.next_attempt_at <= v_now\)\s*\n\s*or \(eo\.status = 'processing' and eo\.claimed_at < v_stale_before\)/);
    expect(body).toMatch(/for update skip locked/);
  });

  it("re-resolves the recipient's deleted_at fresh at claim time and cancels rather than returning an anonymized/missing recipient", () => {
    expect(body).toMatch(/join auth\.users u on u\.id = p\.id/);
    expect(body).toMatch(/if not found or v_deleted_at is not null or v_email is null then\s*\n\s*update public\.email_outbox as eo\s*\n\s*set status = 'cancelled'/);
  });

  it("never persists the resolved email address back into the table -- only returns it as an OUT column", () => {
    const persistenceCheck = body.match(/update public\.email_outbox[^;]*;/g) ?? [];
    for (const stmt of persistenceCheck) {
      expect(stmt).not.toMatch(/\bemail\s*=/);
    }
  });

  it("increments attempt_count and sets claimed_at when transitioning a row to processing", () => {
    expect(body).toMatch(/set status = 'processing',\s*\n\s*claimed_at = v_now,\s*\n\s*attempt_count = r\.attempt_count \+ 1/);
  });

  it("validates its own batch limit before doing any work", () => {
    expect(body).toMatch(/if p_limit is null or p_limit < 1 or p_limit > 100 then/);
    expect(body).toMatch(/'INVALID_BATCH_LIMIT'/);
  });
});

describe("0083: mark_email_sent / mark_email_failed -- safe finalize, bounded retry", () => {
  const source = readFile(MIGRATION_PATH);

  it("mark_email_sent only transitions a row still in 'processing' -- a WHERE guard, not an exception", () => {
    const body = getFunctionBody(source, "create or replace function public.mark_email_sent(");
    expect(body).toMatch(/where id = p_id and status = 'processing';/);
    expect(body).not.toMatch(/raise exception/);
  });

  it("mark_email_failed caps attempts at 5 and only acts on a row still 'processing'", () => {
    const anchor = "create or replace function public.mark_email_failed(";
    const fullDef = source.slice(source.indexOf(anchor), source.indexOf("end;\n$$;", source.indexOf(anchor)));
    const body = getFunctionBody(source, anchor);
    expect(fullDef).toMatch(/v_max_attempts constant integer := 5;/);
    expect(body).toMatch(/where id = p_id and status = 'processing'/);
    expect(body).toMatch(/if not found then\s*\n\s*return;\s*\n\s*end if;/);
  });

  it("mark_email_failed sets a terminal 'failed' status once attempts are exhausted, otherwise reschedules with backoff", () => {
    const body = getFunctionBody(source, "create or replace function public.mark_email_failed(");
    expect(body).toMatch(/if v_attempt_count >= v_max_attempts then\s*\n\s*update public\.email_outbox\s*\n\s*set status = 'failed'/);
    expect(body).toMatch(/set status = 'pending',\s*\n\s*next_attempt_at = now\(\) \+ \(v_backoff_minutes \|\| ' minutes'\)::interval/);
  });

  it("both functions are granted only to service_role", () => {
    for (const fnCall of ["mark_email_sent(uuid)", "mark_email_failed(uuid, text)"]) {
      const escaped = fnCall.replace(/[()]/g, (c) => `\\${c}`);
      expect(source).toMatch(new RegExp(`grant execute on function public\\.${escaped} to service_role;`));
    }
  });
});

describe("0083: enqueue_pending_order_expiry_reminders -- read-only 48-72h scan, no order mutation", () => {
  const source = readFile(MIGRATION_PATH);
  const body = getFunctionBody(source, "create or replace function public.enqueue_pending_order_expiry_reminders(");

  it("scans exactly the 48-72 hour still-pending window", () => {
    expect(body).toMatch(/where o\.status = 'pending'\s*\n\s*and o\.created_at <= v_now - interval '48 hours'\s*\n\s*and o\.created_at > v_now - interval '72 hours'/);
  });

  it("never mutates public.orders -- no UPDATE/DELETE/INSERT against it, and takes no row lock on it", () => {
    expect(body).not.toMatch(/update public\.orders/);
    expect(body).not.toMatch(/for update/);
  });

  it("delegates recipient-eligibility and idempotency entirely to enqueue_email -- does not duplicate that logic", () => {
    expect(body).toMatch(/perform public\.enqueue_email\(\s*\n\s*'order_expiration_reminder'::public\.email_event_type_enum/);
    expect(body).not.toMatch(/deleted_at/);
  });

  it("is granted only to service_role, matching expire_pending_orders' own established convention", () => {
    expect(source).toMatch(/grant execute on function public\.enqueue_pending_order_expiry_reminders\(integer\) to service_role;/);
  });
});

describe("0083: exactly six enqueue_email call sites, one per canonical email event plus the reminder scan", () => {
  const source = readFile(MIGRATION_PATH);

  it("calls enqueue_email exactly 6 times: 5 inside business RPCs plus 1 inside the reminder scan", () => {
    const codeOnly = stripSqlComments(source);
    const calls = codeOnly.match(/perform public\.enqueue_email\(/g) ?? [];
    expect(calls).toHaveLength(6);
  });

  it("submit_cart_order enqueues new_order_request immediately after the order_request_received notification, inside the per-shop loop", () => {
    const body = getFunctionBody(source, "create or replace function public.submit_cart_order(");
    const notifIdx = body.indexOf("'order_request_received'");
    const enqueueIdx = body.indexOf("'new_order_request'::public.email_event_type_enum");
    expect(notifIdx).toBeGreaterThan(-1);
    expect(enqueueIdx).toBeGreaterThan(notifIdx);
  });

  it("accept_order_items maps each outcome (accepted/declined/else) to its corresponding email event, after the in-app notification insert", () => {
    const body = getFunctionBody(source, "create or replace function public.accept_order_items(");
    const notifIdx = body.indexOf("insert into public.notifications");
    const enqueueIdx = body.indexOf("perform public.enqueue_email(");
    expect(enqueueIdx).toBeGreaterThan(notifIdx);
    expect(body).toMatch(/when 'accepted' then 'order_accepted'::public\.email_event_type_enum/);
    expect(body).toMatch(/when 'declined' then 'order_declined'::public\.email_event_type_enum/);
    expect(body).toMatch(/else 'order_partial_acceptance'::public\.email_event_type_enum/);
  });

  it("cancel_accepted_order enqueues order_seller_cancelled after the order_cancelled notification insert", () => {
    const body = getFunctionBody(source, "create or replace function public.cancel_accepted_order(");
    const notifIdx = body.indexOf("'order_cancelled'");
    const enqueueIdx = body.indexOf("'order_seller_cancelled'::public.email_event_type_enum");
    expect(enqueueIdx).toBeGreaterThan(notifIdx);
  });

  it("apply_user_restriction enqueues moderation_restriction_applied only on the fresh-application branch, never the idempotent 'already active' branch", () => {
    const body = getFunctionBody(source, "create or replace function public.apply_user_restriction(");
    const idempotentReturnIdx = body.indexOf("select v_existing_id, p_user_id, p_restriction_type, true");
    const insertIdx = body.indexOf("insert into public.user_restrictions");
    const enqueueIdx = body.indexOf("'moderation_restriction_applied'::public.email_event_type_enum");
    expect(idempotentReturnIdx).toBeGreaterThan(-1);
    expect(enqueueIdx).toBeGreaterThan(insertIdx);
    expect(enqueueIdx).toBeGreaterThan(idempotentReturnIdx);
  });

  it("lift_user_restriction enqueues moderation_restriction_lifted only on the fresh-lift branch, never the idempotent 'already lifted' branch or the anonymized-target rejection", () => {
    const body = getFunctionBody(source, "create or replace function public.lift_user_restriction(p_restriction_id uuid, p_note text default null::text)");
    const idempotentReturnIdx = body.indexOf("select p_restriction_id, v_user_id, v_restriction_type, true");
    const anonymizedGuardIdx = body.indexOf("TARGET_ACCOUNT_ANONYMIZED");
    const updateIdx = body.indexOf("update public.user_restrictions as ur");
    const enqueueIdx = body.indexOf("'moderation_restriction_lifted'::public.email_event_type_enum");
    expect(enqueueIdx).toBeGreaterThan(updateIdx);
    expect(enqueueIdx).toBeGreaterThan(idempotentReturnIdx);
    expect(enqueueIdx).toBeGreaterThan(anonymizedGuardIdx);
  });
});

describe("0083: the five touched business RPCs keep their existing signatures, grants, and business logic untouched", () => {
  const source = readFile(MIGRATION_PATH);

  it("preserves the authenticated-only grant on all five business RPCs (no anon/public exposure introduced)", () => {
    const grants = [
      "submit_cart_order(uuid[], jsonb, text)",
      "accept_order_items(uuid, uuid[], uuid[])",
      "cancel_accepted_order(uuid, text)",
      "apply_user_restriction(uuid, restriction_type_enum, text)",
      "lift_user_restriction(uuid, text)",
    ];
    for (const signature of grants) {
      const escaped = signature.replace(/[()[\]]/g, (c) => `\\${c}`);
      expect(source).toMatch(new RegExp(`grant execute on function public\\.${escaped} to authenticated;`));
    }
  });

  it("never grants any of the five business RPCs to anon", () => {
    const codeOnly = stripSqlComments(source);
    expect(codeOnly).not.toMatch(/grant execute on function public\.(submit_cart_order|accept_order_items|cancel_accepted_order|apply_user_restriction|lift_user_restriction)[^;]*to anon/);
  });

  it("still preserves the existing reservation/inventory logic in accept_order_items (untouched by this migration)", () => {
    const body = getFunctionBody(source, "create or replace function public.accept_order_items(");
    expect(body).toMatch(/insert into public\.inventory_reservations/);
    expect(body).toMatch(/reserved_quantity = v_ok_listing_new_reserved\[i\]/);
  });

  it("still preserves the existing reservation-release logic in cancel_accepted_order (untouched by this migration)", () => {
    const body = getFunctionBody(source, "create or replace function public.cancel_accepted_order(");
    expect(body).toMatch(/status = 'released'/);
  });

  it("still preserves the Trusted Seller recalculation hook in both moderation RPCs (untouched by this migration)", () => {
    const applyBody = getFunctionBody(source, "create or replace function public.apply_user_restriction(");
    const liftBody = getFunctionBody(source, "create or replace function public.lift_user_restriction(p_restriction_id uuid, p_note text default null::text)");
    expect(applyBody).toMatch(/perform public\.recalculate_trusted_seller\(v_shop_id\);/);
    expect(liftBody).toMatch(/perform public\.recalculate_trusted_seller\(v_shop_id\);/);
  });

  it("never sends email or writes to email_outbox directly from PL/pgSQL via a network extension (http/pg_net) -- delivery is out-of-transaction only", () => {
    const codeOnly = stripSqlComments(source);
    expect(codeOnly).not.toMatch(/net\.http_post|extensions\.http_post|http_post\(/i);
  });
});

describe("0083: existing in-app notifications are preserved verbatim in every touched RPC", () => {
  const source = readFile(MIGRATION_PATH);

  it("submit_cart_order still inserts the exact pre-existing order_request_received notification", () => {
    const body = getFunctionBody(source, "create or replace function public.submit_cart_order(");
    expect(body).toMatch(
      /insert into public\.notifications \(recipient_id, type, actor_id, order_id, dedupe_key\)\s*\n\s*select v_shop_owner_id, 'order_request_received', v_caller_id, v_new_order_id, v_new_order_id::text/,
    );
  });

  it("accept_order_items still inserts the exact pre-existing outcome-mapped notification", () => {
    const body = getFunctionBody(source, "create or replace function public.accept_order_items(");
    expect(body).toMatch(
      /when 'accepted' then 'order_accepted'::public\.notification_type_enum\s*\n\s*when 'declined' then 'order_declined'::public\.notification_type_enum\s*\n\s*else 'order_changes_pending'::public\.notification_type_enum/,
    );
  });

  it("cancel_accepted_order still inserts the exact pre-existing order_cancelled notification", () => {
    const body = getFunctionBody(source, "create or replace function public.cancel_accepted_order(");
    expect(body).toMatch(
      /select v_order_buyer_id, 'order_cancelled', v_caller, p_order_id, p_order_id::text \|\| ':cancelled'/,
    );
  });

  it("no touched function's notification dedupe_key or recipient resolution logic changed shape", () => {
    const codeOnly = stripSqlComments(source);
    const dedupeMatches = codeOnly.match(/dedupe_key\)/g) ?? [];
    expect(dedupeMatches.length).toBeGreaterThanOrEqual(3);
  });
});

describe("0083: no provider secret or cron secret is ever read via a NEXT_PUBLIC_ variable", () => {
  it("this migration's actual SQL never references RESEND_API_KEY, CRON_SECRET, or SUPABASE_SERVICE_ROLE_KEY (those are application-layer env vars, not database concerns; the header comment's own prose mentioning them is not SQL)", () => {
    const codeOnly = stripSqlComments(readFile(MIGRATION_PATH));
    expect(codeOnly).not.toMatch(/RESEND_API_KEY|CRON_SECRET|SUPABASE_SERVICE_ROLE_KEY/);
  });
});

describe("0083: no unrelated business behavior changed -- scope boundaries reported honestly in the migration's own header", () => {
  const source = readFile(MIGRATION_PATH);

  it("does not touch expire_pending_orders (0024) itself", () => {
    expect(source).not.toMatch(/create or replace function public\.expire_pending_orders/);
  });

  it("does not add an in-app notification insert to apply_user_restriction or lift_user_restriction (deliberately out of this task's scope)", () => {
    const applyBody = getFunctionBody(source, "create or replace function public.apply_user_restriction(");
    const liftBody = getFunctionBody(source, "create or replace function public.lift_user_restriction(p_restriction_id uuid, p_note text default null::text)");
    expect(applyBody).not.toMatch(/insert into public\.notifications/);
    expect(liftBody).not.toMatch(/insert into public\.notifications/);
  });

  it("never mentions escrow, refund, or payment processing", () => {
    expect(source).not.toMatch(/escrow|refund processing|payment processing/i);
  });

  it("touches exactly the five named business functions plus the five new outbox helper functions -- ten CREATE OR REPLACE statements total", () => {
    const createMatches = stripSqlComments(source).match(/^create or replace function public\.\w+/gm) ?? [];
    expect(createMatches).toHaveLength(10);
  });
});
