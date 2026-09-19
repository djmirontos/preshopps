import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

function readFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf-8");
}

/** Strips SQL "-- " line comments so a static assertion about actual
 * executable SQL can't false-positive on a comment's own prose discussing
 * (by name) the exact pattern being asserted against -- same technique
 * already established in fix-submit-report-output-collision-architecture
 * .test.ts and buy-now-architecture.test.ts. */
function stripSqlComments(sql: string): string {
  return sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

function getFunctionBody(source: string, anchor: string): string {
  const fnStart = source.indexOf(anchor);
  expect(fnStart).toBeGreaterThan(-1);
  const bodyStart = source.indexOf("begin\n", fnStart);
  const bodyEnd = source.indexOf("end;\n$$;", bodyStart);
  return source.slice(bodyStart, bodyEnd);
}

const SCHEDULER_MIGRATION_PATH = "supabase/migrations/0099_schedule_pending_order_expiry.sql";
// expire_pending_orders' current live definition is 0040 (0024's original
// body, superseded to add the order_expired notification) -- 0083 never
// touched it (confirmed by 0083's own header and by
// transactional-email-outbox-architecture.test.ts's own coverage).
const EXPIRE_MIGRATION_PATH = "supabase/migrations/0040_notifications.sql";
const EXPIRE_ANCHOR = "create or replace function public.expire_pending_orders(";
const REMINDER_MIGRATION_PATH = "supabase/migrations/0083_transactional_email_outbox.sql";
const REMINDER_ANCHOR = "create or replace function public.enqueue_pending_order_expiry_reminders(";
// Grants are declared once, in 0024 (the function's original migration) --
// 0040's own `create or replace function` redefinition does not, and does
// not need to, restate them: REPLACE FUNCTION never resets existing grants.
const GRANTS_MIGRATION_PATH = "supabase/migrations/0024_pending_order_expiry.sql";

describe("0099: migration-list snapshot includes the new scheduler migration", () => {
  it("0099_schedule_pending_order_expiry.sql exists and is the only file newer than 0098", () => {
    const migrationFiles = readdirSync(path.join(process.cwd(), "supabase/migrations")).filter((f) => f.endsWith(".sql"));
    expect(migrationFiles).toContain("0099_schedule_pending_order_expiry.sql");
    const newerThan0098 = migrationFiles.filter((f) => f > "0098_fix_submit_report_output_collision.sql");
    expect(newerThan0098).toEqual(["0099_schedule_pending_order_expiry.sql"]);
  });
});

describe("0099: creates exactly one pg_cron schedule, nothing else", () => {
  const source = readFile(SCHEDULER_MIGRATION_PATH);
  const code = stripSqlComments(source);

  it("contains exactly one cron.schedule(...) call", () => {
    const scheduleMatches = code.match(/cron\.schedule\(/g) ?? [];
    expect(scheduleMatches).toHaveLength(1);
  });

  it("uses the expected job name and cadence", () => {
    expect(code).toMatch(/cron\.schedule\(\s*\n?\s*'expire-pending-orders-every-15-min',\s*\n?\s*'\*\/15 \* \* \* \*',/);
  });

  it("the scheduled command calls expire_pending_orders(200) directly -- no wrapping, no extra args", () => {
    expect(code).toMatch(/\$\$select public\.expire_pending_orders\(200\);\$\$/);
  });

  it("does not redefine expire_pending_orders -- the existing 0040 definition is reused as-is", () => {
    expect(code).not.toMatch(/create or replace function public\.expire_pending_orders/);
    expect(code).not.toMatch(/create or replace function/i);
  });

  it("contains no HTTP call, no pg_net, and no Edge Function URL", () => {
    expect(code).not.toMatch(/net\.http_post/);
    expect(code).not.toMatch(/create extension if not exists pg_net/);
    expect(code).not.toMatch(/functions\/v1/);
    expect(code).not.toMatch(/supabase\.co\/functions/);
  });

  it("contains no secret/Vault usage of any kind", () => {
    expect(code).not.toMatch(/vault/i);
    expect(code).not.toMatch(/decrypted_secret/);
    expect(code).not.toMatch(/x-cron-secret/);
    expect(code).not.toMatch(/cron_secret/i);
  });

  it("adds no email logic -- no enum change, no enqueue_email call", () => {
    expect(code).not.toMatch(/alter type/i);
    expect(code).not.toMatch(/email_event_type_enum/);
    expect(code).not.toMatch(/enqueue_email/);
  });

  it("adds no unrelated schema/table/policy change", () => {
    expect(code).not.toMatch(/create table/i);
    expect(code).not.toMatch(/alter table/i);
    expect(code).not.toMatch(/create policy/i);
    expect(code).not.toMatch(/drop table/i);
    expect(code).not.toMatch(/create type/i);
  });

  it("only enables pg_cron (idempotent, matching 0084's own defensive style) -- no other extension", () => {
    const extensionMatches = code.match(/create extension if not exists (\w+)/g) ?? [];
    expect(extensionMatches).toEqual(["create extension if not exists pg_cron"]);
  });
});

describe("expire_pending_orders (0040, current live definition): eligibility and boundary", () => {
  const source = readFile(EXPIRE_MIGRATION_PATH);
  const body = getFunctionBody(source, EXPIRE_ANCHOR);

  it("selects only status='pending' rows", () => {
    expect(body).toMatch(/where o\.status = 'pending'/);
  });

  it("uses an inclusive 72-hour cutoff (<=, not <) measured off created_at, never updated_at", () => {
    expect(body).toMatch(/and o\.created_at <= v_now - interval '72 hours'/);
    expect(body).not.toMatch(/updated_at/);
  });

  it("validates p_limit (1-1000) before touching any row", () => {
    expect(body).toMatch(/if p_limit is null or p_limit < 1 or p_limit > 1000 then/);
    expect(body).toMatch(/'INVALID_BATCH_LIMIT'/);
  });
});

describe("expire_pending_orders (0040): locking and ordering", () => {
  const source = readFile(EXPIRE_MIGRATION_PATH);
  const body = getFunctionBody(source, EXPIRE_ANCHOR);

  it("locks with FOR UPDATE SKIP LOCKED", () => {
    expect(body).toMatch(/for update skip locked/);
  });

  it("processes oldest-first (created_at, id)", () => {
    expect(body).toMatch(/order by o\.created_at, o\.id/);
  });

  it("is bounded by p_limit via LIMIT p_limit", () => {
    expect(body).toMatch(/limit p_limit/);
  });
});

describe("expire_pending_orders (0040): status transition and history", () => {
  const source = readFile(EXPIRE_MIGRATION_PATH);
  const body = getFunctionBody(source, EXPIRE_ANCHOR);

  it("transitions pending -> expired and sets expired_at", () => {
    expect(body).toMatch(/set status = 'expired',\s*\n\s*expired_at = v_now/);
  });

  it("writes exactly one order_status_history row per successfully-expired order, system-attributed (changed_by = null)", () => {
    expect(body).toMatch(/insert into public\.order_status_history \(order_id, from_status, to_status, changed_by, note\)\s*\n\s*values \(r\.id, 'pending', 'expired', null, null\);/);
    const historyInsertMatches = body.match(/insert into public\.order_status_history/g) ?? [];
    expect(historyInsertMatches).toHaveLength(1);
  });
});

describe("expire_pending_orders (0040): inventory neutrality", () => {
  const source = readFile(EXPIRE_MIGRATION_PATH);
  const body = getFunctionBody(source, EXPIRE_ANCHOR);

  it("never mutates order_items", () => {
    expect(body).not.toMatch(/update public\.order_items/);
    expect(body).not.toMatch(/insert into public\.order_items/);
    expect(body).not.toMatch(/delete from public\.order_items/);
  });

  it("never references public.listings at all", () => {
    expect(body).not.toMatch(/public\.listings/);
  });

  it("only ever reads inventory_reservations (an EXISTS check) -- never inserts, updates, or deletes it", () => {
    expect(body).toMatch(/select exists \(\s*\n\s*select 1\s*\n\s*from public\.inventory_reservations ir/);
    expect(body).not.toMatch(/update public\.inventory_reservations/);
    expect(body).not.toMatch(/insert into public\.inventory_reservations/);
    expect(body).not.toMatch(/delete from public\.inventory_reservations/);
  });
});

describe("expire_pending_orders (0040): active-reservation anomaly skips mutation entirely", () => {
  const source = readFile(EXPIRE_MIGRATION_PATH);
  const body = getFunctionBody(source, EXPIRE_ANCHOR);

  it("an order with an active reservation is returned as anomaly=true and the loop continues before any UPDATE/INSERT is reached", () => {
    const anomalyBranchStart = body.indexOf("if v_has_active_reservation then");
    const anomalyBranchEnd = body.indexOf("continue;", anomalyBranchStart) + "continue;".length;
    expect(anomalyBranchStart).toBeGreaterThan(-1);
    const anomalyBranch = body.slice(anomalyBranchStart, anomalyBranchEnd);
    expect(anomalyBranch).toMatch(/anomaly := true;/);
    expect(anomalyBranch).toMatch(/expired_at := null;/);
    expect(anomalyBranch).not.toMatch(/update public\.orders/);
    expect(anomalyBranch).not.toMatch(/insert into public\.order_status_history/);
    // The real mutation (status='expired') textually follows the anomaly
    // branch's own "continue;" in the function body -- confirming the
    // anomaly path structurally cannot reach it.
    const mutationIndex = body.indexOf("set status = 'expired'");
    expect(mutationIndex).toBeGreaterThan(anomalyBranchEnd);
  });
});

describe("expire_pending_orders (0040): order_expired notification", () => {
  const source = readFile(EXPIRE_MIGRATION_PATH);
  const body = getFunctionBody(source, EXPIRE_ANCHOR);

  it("inserts exactly one order_expired notification per real expiry, targeted at the buyer, with actor_id NULL", () => {
    expect(body).toMatch(
      /insert into public\.notifications \(recipient_id, type, actor_id, order_id, dedupe_key\)\s*\n\s*select r\.buyer_id, 'order_expired', null, r\.id, r\.id::text \|\| ':expired'/,
    );
  });

  it("uses a deterministic per-order dedupe key", () => {
    expect(body).toMatch(/r\.id::text \|\| ':expired'/);
  });

  it("guards against notifying a deleted/anonymized buyer", () => {
    expect(body).toMatch(/where not exists \(\s*\n\s*select 1 from public\.profiles p where p\.id = r\.buyer_id and p\.deleted_at is not null\s*\n\s*\)/);
  });

  it("relies on the notifications dedupe constraint (on conflict do nothing), not a hand-rolled existence check", () => {
    expect(body).toMatch(/on conflict on constraint notifications_recipient_type_dedupe_key do nothing;/);
  });
});

describe("expire_pending_orders (0040): idempotency and security", () => {
  const source = readFile(EXPIRE_MIGRATION_PATH);
  const body = getFunctionBody(source, EXPIRE_ANCHOR);

  it("has no was_already_expired flag or special-cased re-entry branch -- idempotency is structural via status='pending' selection alone", () => {
    expect(body).not.toMatch(/was_already_expired/);
    const statusPendingMatches = body.match(/status = 'pending'/g) ?? [];
    expect(statusPendingMatches.length).toBeGreaterThanOrEqual(1);
  });

  it("is SECURITY DEFINER with an empty search_path", () => {
    const fnStart = source.indexOf(EXPIRE_ANCHOR);
    const fnRegion = source.slice(fnStart, source.indexOf("$$;", fnStart) + 3);
    expect(fnRegion).toMatch(/security definer/);
    expect(fnRegion).toMatch(/set search_path = ''/);
  });

  it("is granted only to service_role -- anon and authenticated are explicitly revoked (declared once in 0024; 0040's REPLACE FUNCTION never resets grants, so it does not restate them)", () => {
    const grantsSource = readFile(GRANTS_MIGRATION_PATH);
    expect(grantsSource).toMatch(/revoke all on function public\.expire_pending_orders\(integer\) from public;/);
    expect(grantsSource).toMatch(/revoke all on function public\.expire_pending_orders\(integer\) from anon;/);
    expect(grantsSource).toMatch(/revoke all on function public\.expire_pending_orders\(integer\) from authenticated;/);
    expect(grantsSource).toMatch(/grant execute on function public\.expire_pending_orders\(integer\) to service_role;/);
    expect(grantsSource).not.toMatch(/grant execute on function public\.expire_pending_orders\([^;]*to (anon|authenticated)/);
    // 0040 itself must not silently widen access by adding a new grant line.
    expect(source).not.toMatch(/grant execute on function public\.expire_pending_orders/);
  });

  it("has no auth.uid() call at all -- it is system/service-role-only, with no per-row ownership check", () => {
    expect(body).not.toMatch(/auth\.uid\(\)/);
  });
});

describe("reminder (0083) vs. expiry (0040): the two eligibility windows never overlap", () => {
  const reminderSource = readFile(REMINDER_MIGRATION_PATH);
  const reminderBody = getFunctionBody(reminderSource, REMINDER_ANCHOR);
  const expireSource = readFile(EXPIRE_MIGRATION_PATH);
  const expireBody = getFunctionBody(expireSource, EXPIRE_ANCHOR);

  it("reminder eligibility is exactly 48h <= age < 72h (created_at <= now()-48h AND created_at > now()-72h)", () => {
    expect(reminderBody).toMatch(/o\.created_at <= v_now - interval '48 hours'/);
    expect(reminderBody).toMatch(/o\.created_at > v_now - interval '72 hours'/);
  });

  it("expiry eligibility is exactly age >= 72h (created_at <= now()-72h)", () => {
    expect(expireBody).toMatch(/o\.created_at <= v_now - interval '72 hours'/);
  });

  it("the shared 72-hour boundary is complementary, not overlapping: reminder requires strictly newer than 72h (>), expiry requires 72h-or-older (<=) -- the exact instant belongs to expiry alone", () => {
    // reminder's own upper bound uses a strict `>` against the identical
    // '72 hours' interval that expiry's own cutoff uses with `<=` --
    // together they partition every pending order's age into exactly one
    // of the two windows at that instant, never both.
    expect(reminderBody).toMatch(/created_at > v_now - interval '72 hours'/);
    expect(expireBody).toMatch(/created_at <= v_now - interval '72 hours'/);
  });

  it("both functions independently re-scan status='pending' on every invocation -- an order that leaves pending (via either expiry or any other transition) structurally falls out of both windows on the very next run, with no shared state or guard needed between them", () => {
    expect(reminderBody).toMatch(/where o\.status = 'pending'/);
    expect(expireBody).toMatch(/where o\.status = 'pending'/);
  });

  it("enabling expire_pending_orders' new cron cannot itself cause a duplicate/late reminder -- the reminder function is untouched by 0099 and its own dedupe is unconditional on enqueue_email's unique constraint, independent of whether expiry ever runs", () => {
    const schedulerSource = stripSqlComments(readFile(SCHEDULER_MIGRATION_PATH));
    expect(schedulerSource).not.toMatch(/enqueue_pending_order_expiry_reminders/);
  });
});
