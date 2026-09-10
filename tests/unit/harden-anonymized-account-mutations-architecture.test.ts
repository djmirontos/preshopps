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

const MIGRATION_PATH = "supabase/migrations/0082_harden_anonymized_account_mutations.sql";

function getFunctionBody(source: string, anchor: string): string {
  const fnStart = source.indexOf(anchor);
  expect(fnStart).toBeGreaterThan(-1);
  const bodyStart = source.indexOf("begin\n", fnStart);
  const bodyEnd = source.indexOf("end;\n$$;", bodyStart);
  return source.slice(bodyStart, bodyEnd);
}

const PART1_ANCHORS: Record<string, string> = {
  create_shop: "create or replace function public.create_shop(",
  update_shop: "create or replace function public.update_shop(",
  accept_seller_policies: "create or replace function public.accept_seller_policies()",
  accept_order_items: "create or replace function public.accept_order_items(p_order_id uuid, p_accepted_item_ids uuid[], p_declined_item_ids uuid[])",
  cancel_accepted_order: "create or replace function public.cancel_accepted_order(p_order_id uuid, p_reason text)",
  mark_order_ready: "create or replace function public.mark_order_ready(p_order_id uuid)",
  mark_order_handed_over_or_shipped: "create or replace function public.mark_order_handed_over_or_shipped(p_order_id uuid)",
  resolve_order_cancellation: "create or replace function public.resolve_order_cancellation(p_request_id uuid, p_confirm boolean, p_review_note text)",
  confirm_order_received: "create or replace function public.confirm_order_received(p_order_id uuid)",
  cancel_order_changes: "create or replace function public.cancel_order_changes(p_order_id uuid)",
  cancel_pending_order: "create or replace function public.cancel_pending_order(p_order_id uuid)",
  request_order_cancellation: "create or replace function public.request_order_cancellation(p_order_id uuid, p_reason text)",
};

const PART2_ANCHORS: Record<string, string> = {
  create_listing: "create or replace function public.create_listing(",
  update_listing: "create or replace function public.update_listing(p_listing_id uuid, p_patch jsonb default '{}'::jsonb)",
  replace_listing_images: "create or replace function public.replace_listing_images(p_listing_id uuid, p_image_paths text[] default '{}'::text[], p_reference_flags boolean[] default null::boolean[])",
  publish_listing: "create or replace function public.publish_listing(p_listing_id uuid)",
  update_listing_status: "create or replace function public.update_listing_status(p_listing_id uuid, p_status listing_status_enum)",
};

const LIFT_RESTRICTION_ANCHOR = "create or replace function public.lift_user_restriction(p_restriction_id uuid, p_note text default null::text)";

const GUARD_PATTERN =
  /select p\.deleted_at into v_caller_deleted_at\s*\n\s*from public\.profiles p\s*\n\s*where p\.id = v_caller;\s*\n\s*\n\s*if not found or v_caller_deleted_at is not null then\s*\n\s*raise exception 'Account is not available\.' using detail = 'INTERACTION_BLOCKED';\s*\n\s*end if;/;

describe("0082: Part 1 -- all 12 category-D RPCs gain a caller deleted_at guard", () => {
  const source = readFile(MIGRATION_PATH);

  it.each(Object.entries(PART1_ANCHORS))("%s raises INTERACTION_BLOCKED when the caller's profile is deleted or missing", (_name, anchor) => {
    const body = getFunctionBody(source, anchor);
    expect(body).toMatch(GUARD_PATTERN);
  });

  it.each(Object.entries(PART1_ANCHORS))("%s: the guard is placed immediately after NOT_AUTHENTICATED, before any other logic", (_name, anchor) => {
    const body = getFunctionBody(source, anchor);
    const authIdx = body.indexOf("NOT_AUTHENTICATED");
    expect(authIdx).toBeGreaterThan(-1);
    const endIfIdx = body.indexOf("end if;", authIdx);
    const afterAuth = body.slice(endIfIdx + "end if;".length);
    const nextMeaningfulLine = afterAuth
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.length > 0 && !l.startsWith("--"));
    expect(nextMeaningfulLine).toBe("select p.deleted_at into v_caller_deleted_at");
  });
});

describe("0082: Part 2 -- 5 listing RPCs gain the same guard, existing account_suspended checks untouched", () => {
  const source = readFile(MIGRATION_PATH);

  it.each(Object.entries(PART2_ANCHORS))("%s raises INTERACTION_BLOCKED when the caller's profile is deleted or missing", (_name, anchor) => {
    const body = getFunctionBody(source, anchor);
    expect(body).toMatch(GUARD_PATTERN);
  });

  it.each(Object.entries(PART2_ANCHORS))("%s: the new guard runs before the pre-existing restriction/ownership checks", (_name, anchor) => {
    const body = getFunctionBody(source, anchor);
    const guardIdx = body.indexOf("v_caller_deleted_at");
    const restrictionIdx = body.indexOf("restriction_type in");
    if (restrictionIdx > -1) {
      expect(guardIdx).toBeLessThan(restrictionIdx);
    }
  });

  it("create_listing/update_listing/replace_listing_images/publish_listing/update_listing_status still each check seller_suspended and account_suspended, unmodified", () => {
    for (const anchor of Object.values(PART2_ANCHORS)) {
      const body = getFunctionBody(source, anchor);
      expect(body).toMatch(/restriction_type in \('seller_suspended', 'account_suspended'\)/);
    }
  });

  it("0076's dispute image-path logic is not touched -- no dispute table, function, or RLS policy appears in this migration's actual SQL (prose mentions in the header comment are informational only)", () => {
    const codeOnly = stripSqlComments(source);
    expect(codeOnly).not.toMatch(/public\.disputes|public\.dispute_|create_dispute/i);
  });
});

describe("0082: Part 3 -- lift_user_restriction gains a narrow, target-scoped defense-in-depth guard", () => {
  const source = readFile(MIGRATION_PATH);
  const body = getFunctionBody(source, LIFT_RESTRICTION_ANCHOR);

  it("rejects lifting account_suspended when the target profile is anonymized, with TARGET_ACCOUNT_ANONYMIZED", () => {
    expect(body).toMatch(
      /if v_restriction_type = 'account_suspended' then\s*\n\s*select p\.deleted_at into v_target_deleted_at\s*\n\s*from public\.profiles p\s*\n\s*where p\.id = v_user_id;\s*\n\s*\n\s*if v_target_deleted_at is not null then\s*\n\s*raise exception '[^']*' using detail = 'TARGET_ACCOUNT_ANONYMIZED';\s*\n\s*end if;\s*\n\s*end if;/,
    );
  });

  it("is scoped to account_suspended only -- seller_suspended/buyer_restricted are never blocked by this new check", () => {
    const newGuardBlock = body.slice(
      body.indexOf("restriction-lift defense-in-depth"),
      body.indexOf("v_note := nullif"),
    );
    expect(newGuardBlock).not.toMatch(/seller_suspended/);
    expect(newGuardBlock).not.toMatch(/buyer_restricted/);
  });

  it("is placed after the existing already-lifted idempotency return, and before note validation", () => {
    const idempotencyIdx = body.indexOf("v_existing_lifted_at is not null");
    const newGuardIdx = body.indexOf("TARGET_ACCOUNT_ANONYMIZED");
    const noteValidationIdx = body.indexOf("v_note := nullif(btrim(p_note)");
    expect(idempotencyIdx).toBeLessThan(newGuardIdx);
    expect(newGuardIdx).toBeLessThan(noteValidationIdx);
  });

  it("does not touch NOT_ADMIN authorization, restriction lookup, or the trusted-seller recalculation", () => {
    expect(body).toMatch(/'NOT_ADMIN'/);
    expect(body).toMatch(/perform public\.recalculate_trusted_seller\(v_shop_id\);/);
  });
});

describe("0082: exactly 18 functions touched, all via CREATE OR REPLACE (no signature/return-shape change)", () => {
  const source = readFile(MIGRATION_PATH);

  it("contains exactly 18 CREATE OR REPLACE FUNCTION statements and zero DROP FUNCTION statements", () => {
    const createMatches = source.match(/^create or replace function public\.\w+/gm) ?? [];
    const dropMatches = source.match(/^drop function/gm) ?? [];
    expect(createMatches).toHaveLength(18);
    expect(dropMatches).toHaveLength(0);
  });

  it("touches exactly the 18 named functions -- no other function is created or replaced", () => {
    const expectedNames = new Set([
      ...Object.keys(PART1_ANCHORS),
      ...Object.keys(PART2_ANCHORS),
      "lift_user_restriction",
    ]);
    const actualNames = new Set(
      Array.from(source.matchAll(/create or replace function public\.(\w+)/g)).map((m) => m[1]),
    );
    expect(actualNames).toEqual(expectedNames);
  });

  it("grants exactly 18 functions to authenticated, and revokes each from public and anon (no wider/narrower grant change)", () => {
    const grantMatches = source.match(/^grant execute on function/gm) ?? [];
    const revokeMatches = source.match(/^revoke all on function/gm) ?? [];
    expect(grantMatches).toHaveLength(18);
    expect(revokeMatches).toHaveLength(36);
    expect(source).not.toMatch(/grant execute on function[^;]*to (anon|public)/i);
  });

  it("adds no new table, enum, type, or RLS policy -- pure function hardening", () => {
    expect(stripSqlComments(source)).not.toMatch(/create table|create type|create policy|alter type/i);
  });

  it("never mentions escrow, refund, payment arbitration, or transactional email (explicit out-of-scope items)", () => {
    expect(source).not.toMatch(/escrow|refund|payment arbitration|resend|transactional email/i);
  });
});

describe("0082: every guard uses the exact caller-scoped variable and identical error shape (no drift between the 17 copies)", () => {
  const source = readFile(MIGRATION_PATH);

  it("v_caller_deleted_at is declared exactly once per mutation-RPC function (17 total across Part 1 + Part 2)", () => {
    const codeOnly = stripSqlComments(source);
    const declarations = codeOnly.match(/v_caller_deleted_at timestamptz;/g) ?? [];
    expect(declarations).toHaveLength(17);
  });

  it("every guard raises the identical message text 'Account is not available.' (17 real occurrences, excluding the header comment's own illustrative example)", () => {
    const codeOnly = stripSqlComments(source);
    const messages = codeOnly.match(/raise exception 'Account is not available\.' using detail = 'INTERACTION_BLOCKED';/g) ?? [];
    expect(messages).toHaveLength(17);
  });

  it("lift_user_restriction does not declare v_caller_deleted_at -- its guard targets the restriction's user_id, not the admin caller", () => {
    const body = getFunctionBody(source, LIFT_RESTRICTION_ANCHOR);
    expect(body).not.toMatch(/v_caller_deleted_at/);
    expect(body).toMatch(/v_target_deleted_at/);
  });
});
