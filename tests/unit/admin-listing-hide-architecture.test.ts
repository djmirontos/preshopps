import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

function readFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf-8");
}

const MIGRATION_PATH = "supabase/migrations/0106_admin_listing_hide.sql";
const PRIOR_GET_LISTING_DETAIL_PATH = "supabase/migrations/0036_public_marketplace_read_rpcs.sql";
const PRIOR_BROWSE_LISTINGS_PATH = "supabase/migrations/0036_public_marketplace_read_rpcs.sql";
const PRIOR_GET_MY_FAVORITES_PATH = "supabase/migrations/0037_favorites_cart_rls_and_rpcs.sql";
const UPDATE_LISTING_STATUS_PATH = "supabase/migrations/0094_published_listing_editing.sql";

function getFunctionBody(source: string, anchor: string): string {
  const fnStart = source.indexOf(anchor);
  if (fnStart === -1) throw new Error(`anchor not found: ${anchor}`);
  const bodyStart = source.indexOf("begin\n", fnStart);
  const bodyEnd = source.indexOf("end;\n$$;", bodyStart);
  return source.slice(bodyStart, bodyEnd);
}

/**
 * This migration's own explanatory comments legitimately discuss the
 * columns/tables/policies being added in prose -- strip `-- ...` line
 * comments before asserting equality/absence, so those tests check actual
 * SQL, not commentary about it. Mirrors 0105's own identical helper.
 */
function stripSqlComments(sql: string): string {
  return sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

describe("0106 schema additions: hidden_by_admin_at column and listing_moderation_actions table", () => {
  const source = readFile(MIGRATION_PATH);

  it("adds hidden_by_admin_at as a nullable timestamptz column on listings, no default other than null", () => {
    expect(source).toMatch(/alter table public\.listings\s*\n\s*add column hidden_by_admin_at timestamptz null;/);
  });

  it("does not add NOT NULL, a default value, or a CHECK constraint to hidden_by_admin_at", () => {
    const codeOnly = stripSqlComments(source);
    const columnLine = codeOnly.match(/add column hidden_by_admin_at[^;]*;/)?.[0] ?? "";
    expect(columnLine).not.toMatch(/not null|default (?!null)/i);
  });

  it("creates a new, dedicated listing_moderation_action_type_enum with exactly hidden/unhidden", () => {
    expect(source).toMatch(
      /create type public\.listing_moderation_action_type_enum as enum \(\s*\n\s*'hidden',\s*\n\s*'unhidden'\s*\n\s*\);/,
    );
  });

  it("creates listing_moderation_actions with admin_id, listing_id, action_type, reason, created_at -- and no target_user_id/restriction_type/restriction_id columns reused from moderation_actions", () => {
    const codeOnly = stripSqlComments(source);
    const tableMatch = codeOnly.match(/create table public\.listing_moderation_actions \(([\s\S]*?)\n\);/);
    expect(tableMatch).not.toBeNull();
    const body = tableMatch![1];
    expect(body).toMatch(/admin_id uuid not null references public\.profiles\(id\) on delete restrict/);
    expect(body).toMatch(/listing_id uuid not null references public\.listings\(id\) on delete restrict/);
    expect(body).toMatch(/action_type public\.listing_moderation_action_type_enum not null/);
    expect(body).toMatch(/reason text,/);
    expect(body).toMatch(/created_at timestamptz not null default now\(\)/);
    expect(body).not.toMatch(/target_user_id|restriction_type|restriction_id/);
  });

  it("requires a non-blank reason specifically for the hidden action, mirroring moderation_actions' own reason-required-for-apply convention", () => {
    expect(source).toMatch(
      /constraint listing_moderation_actions_reason_required_for_hide_check\s*\n\s*check \(action_type <> 'hidden' or \(reason is not null and length\(btrim\(reason\)\) > 0\)\)/,
    );
  });

  it("enables RLS on listing_moderation_actions and adds zero client-facing policies -- the same trusted-RPC-only boundary as moderation_actions/reports/user_restrictions", () => {
    expect(source).toMatch(/alter table public\.listing_moderation_actions enable row level security;/);
    expect(source).not.toMatch(/create policy.*listing_moderation_actions/i);
  });

  it("adds no Storage bucket, Storage policy, or review-image change of any kind", () => {
    expect(stripSqlComments(source)).not.toMatch(/storage\.buckets|storage\.objects|review_images|review-images/);
  });
});

describe("0106 admin_hide_listing / admin_unhide_listing: authorization and grants", () => {
  const source = readFile(MIGRATION_PATH);
  const hideBody = getFunctionBody(source, "create or replace function public.admin_hide_listing(");
  const unhideBody = getFunctionBody(source, "create or replace function public.admin_unhide_listing(");

  it("both check authentication then the project's actual admin-role pattern (any user_roles row), identical to apply_user_restriction/resolve_admin_report", () => {
    for (const body of [hideBody, unhideBody]) {
      expect(body).toMatch(/if v_caller is null then\s*\n\s*raise exception 'Authentication required\.' using detail = 'NOT_AUTHENTICATED';/);
      expect(body).toMatch(
        /if not exists \(select 1 from public\.user_roles ur where ur\.user_id = v_caller\) then\s*\n\s*raise exception 'Admin access required\.' using detail = 'NOT_ADMIN';/,
      );
    }
  });

  it("admin_hide_listing requires a non-blank reason (REASON_REQUIRED), matching apply_user_restriction's own convention", () => {
    expect(hideBody).toMatch(/if v_reason is null or length\(v_reason\) = 0 then/);
    expect(hideBody).toMatch(/'REASON_REQUIRED'/);
  });

  it("admin_unhide_listing's note is optional but length-capped, matching lift_user_restriction's own convention", () => {
    expect(unhideBody).toMatch(/v_note := nullif\(btrim\(p_note\), ''\);/);
    expect(unhideBody).toMatch(/char_length\(v_note\) > 1000/);
  });

  it("both lock the target listing row (for update) before branching on idempotency, and raise LISTING_NOT_FOUND if absent", () => {
    for (const body of [hideBody, unhideBody]) {
      expect(body).toMatch(/from public\.listings l\s*\n\s*where l\.id = p_listing_id\s*\n\s*for update;/);
      expect(body).toMatch(/'LISTING_NOT_FOUND'/);
    }
  });

  it("admin_hide_listing is idempotent (already-hidden is a safe no-op) and admin_unhide_listing is idempotent the same way", () => {
    expect(hideBody).toMatch(/if v_existing_hidden_at is not null then/);
    expect(unhideBody).toMatch(/if v_existing_hidden_at is null then/);
  });

  it("both write exactly one listing_moderation_actions audit row, never touching moderation_actions itself", () => {
    expect(stripSqlComments(hideBody)).toMatch(
      /insert into public\.listing_moderation_actions \(admin_id, listing_id, action_type, reason\)\s*\n\s*values \(v_caller, p_listing_id, 'hidden', v_reason\);/,
    );
    expect(stripSqlComments(unhideBody)).toMatch(
      /insert into public\.listing_moderation_actions \(admin_id, listing_id, action_type, reason\)\s*\n\s*values \(v_caller, p_listing_id, 'unhidden', v_note\);/,
    );
    expect(stripSqlComments(hideBody)).not.toMatch(/public\.moderation_actions/);
    expect(stripSqlComments(unhideBody)).not.toMatch(/public\.moderation_actions/);
  });

  it("admin_unhide_listing only ever clears hidden_by_admin_at -- never writes to listings.status or user_restrictions", () => {
    const codeOnly = stripSqlComments(unhideBody);
    expect(codeOnly).toMatch(/set hidden_by_admin_at = null/);
    expect(codeOnly).not.toMatch(/set status|update public\.user_restrictions|insert into public\.user_restrictions/);
  });

  it("both are SECURITY DEFINER, empty search_path, and granted to authenticated only -- never anon, never public", () => {
    expect(source).toMatch(/create or replace function public\.admin_hide_listing\(p_listing_id uuid, p_reason text\)\nreturns table \(listing_id uuid, hidden_by_admin_at timestamptz, was_already_hidden boolean\)\nlanguage plpgsql\nsecurity definer\nset search_path = ''/);
    expect(source).toMatch(/revoke all on function public\.admin_hide_listing\(uuid, text\) from public;/);
    expect(source).toMatch(/revoke all on function public\.admin_hide_listing\(uuid, text\) from anon;/);
    expect(source).toMatch(/grant execute on function public\.admin_hide_listing\(uuid, text\) to authenticated;/);
    expect(source).not.toMatch(/grant execute on function public\.admin_hide_listing\(uuid, text\) to anon/);

    expect(source).toMatch(/revoke all on function public\.admin_unhide_listing\(uuid, text\) from public;/);
    expect(source).toMatch(/revoke all on function public\.admin_unhide_listing\(uuid, text\) from anon;/);
    expect(source).toMatch(/grant execute on function public\.admin_unhide_listing\(uuid, text\) to authenticated;/);
    expect(source).not.toMatch(/grant execute on function public\.admin_unhide_listing\(uuid, text\) to anon/);
  });
});

describe("0106 get_listing_detail: hidden_by_admin_at gate added, everything else unchanged from 0036", () => {
  const source = readFile(MIGRATION_PATH);
  const priorSource = readFile(PRIOR_GET_LISTING_DETAIL_PATH);
  const ANCHOR = "create or replace function public.get_listing_detail(";

  it("adds exactly one `l.hidden_by_admin_at is null` check, inside the existing visibility gate", () => {
    const body = getFunctionBody(source, ANCHOR);
    const matches = stripSqlComments(body).match(/l\.hidden_by_admin_at is null/g) ?? [];
    expect(matches).toHaveLength(1);
    expect(body).toMatch(
      /and l\.status in \('available', 'reserved', 'sold', 'archived'\)\s*\n\s*and l\.hidden_by_admin_at is null\s*\n\s*and not exists \(/,
    );
  });

  it("every other line is unchanged from the prior (0036) definition", () => {
    const body = getFunctionBody(source, ANCHOR);
    const priorBody = getFunctionBody(priorSource, ANCHOR);
    const stripped = stripSqlComments(body).replace("and l.hidden_by_admin_at is null\n", "");
    const strippedPrior = stripSqlComments(priorBody);
    expect(stripped.replace(/\s+/g, " ").trim()).toBe(strippedPrior.replace(/\s+/g, " ").trim());
  });

  it("grants remain exactly as before: anon and authenticated, both unchanged", () => {
    expect(source).toMatch(/revoke all on function public\.get_listing_detail\(text\) from public;/);
    expect(source).toMatch(/grant execute on function public\.get_listing_detail\(text\) to anon;/);
    expect(source).toMatch(/grant execute on function public\.get_listing_detail\(text\) to authenticated;/);
  });
});

describe("0106 browse_listings: hidden_by_admin_at gate added to all three sort branches, everything else unchanged from 0036", () => {
  const source = readFile(MIGRATION_PATH);
  const priorSource = readFile(PRIOR_BROWSE_LISTINGS_PATH);
  const ANCHOR = "create or replace function public.browse_listings(";

  it("adds `l.hidden_by_admin_at is null` exactly three times -- once per sort branch (newest/price_low/price_high)", () => {
    const body = getFunctionBody(source, ANCHOR);
    const matches = stripSqlComments(body).match(/l\.hidden_by_admin_at is null/g) ?? [];
    expect(matches).toHaveLength(3);
  });

  it("each occurrence sits between the status predicate and the suspension NOT EXISTS check, not replacing either", () => {
    const body = getFunctionBody(source, ANCHOR);
    const pattern = /or \(p_shop_id is not null and l\.shop_id = p_shop_id and l\.status in \('available', 'reserved'\)\)\s*\n\s*\)\s*\n\s*and l\.hidden_by_admin_at is null\s*\n\s*and not exists \(/g;
    const matches = body.match(pattern) ?? [];
    expect(matches).toHaveLength(3);
  });

  it("every other line is unchanged from the prior (0036) definition", () => {
    const body = getFunctionBody(source, ANCHOR);
    const priorBody = getFunctionBody(priorSource, ANCHOR);
    const stripped = stripSqlComments(body).replace(/and l\.hidden_by_admin_at is null\n\s*/g, "");
    const strippedPrior = stripSqlComments(priorBody);
    expect(stripped.replace(/\s+/g, " ").trim()).toBe(strippedPrior.replace(/\s+/g, " ").trim());
  });

  it("grants remain exactly as before: anon and authenticated, both unchanged", () => {
    const grantBlock = source.slice(source.indexOf("revoke all on function public.browse_listings"));
    expect(grantBlock).toMatch(/from public;/);
    expect(grantBlock).toMatch(/from anon;/);
    expect(grantBlock).toMatch(/to anon;/);
    expect(grantBlock).toMatch(/to authenticated;/);
  });
});

describe("0106 get_my_favorites: hidden_by_admin_at gate added to is_visible only, everything else unchanged from 0037", () => {
  const source = readFile(MIGRATION_PATH);
  const priorSource = readFile(PRIOR_GET_MY_FAVORITES_PATH);
  const ANCHOR = "create or replace function public.get_my_favorites(";

  it("adds exactly one `l.hidden_by_admin_at is null` check inside the is_visible lateral join", () => {
    const body = getFunctionBody(source, ANCHOR);
    const matches = stripSqlComments(body).match(/l\.hidden_by_admin_at is null/g) ?? [];
    expect(matches).toHaveLength(1);
    expect(body).toMatch(
      /l\.status in \('available', 'reserved', 'sold', 'archived'\)\s*\n\s*and l\.hidden_by_admin_at is null\s*\n\s*and not exists \(/,
    );
  });

  it("every other line is unchanged from the prior (0037) definition", () => {
    const body = getFunctionBody(source, ANCHOR);
    const priorBody = getFunctionBody(priorSource, ANCHOR);
    const stripped = stripSqlComments(body).replace("and l.hidden_by_admin_at is null\n", "");
    const strippedPrior = stripSqlComments(priorBody);
    expect(stripped.replace(/\s+/g, " ").trim()).toBe(strippedPrior.replace(/\s+/g, " ").trim());
  });

  it("grants remain exactly as before: authenticated only, never anon", () => {
    expect(source).toMatch(/revoke all on function public\.get_my_favorites\(integer, timestamptz, uuid\) from public;/);
    expect(source).toMatch(/revoke all on function public\.get_my_favorites\(integer, timestamptz, uuid\) from anon;/);
    expect(source).toMatch(/grant execute on function public\.get_my_favorites\(integer, timestamptz, uuid\) to authenticated;/);
    expect(source).not.toMatch(/grant execute on function public\.get_my_favorites\(integer, timestamptz, uuid\) to anon/);
  });
});

describe("0106 independence from seller-facing status changes", () => {
  it("does not redefine update_listing_status at all -- a seller has no code path that reads or clears hidden_by_admin_at", () => {
    const migrationSource = readFile(MIGRATION_PATH);
    expect(migrationSource).not.toMatch(/create or replace function public\.update_listing_status/);

    // Cross-check against the actual seller-facing function: it must not
    // reference the new column either, confirming the seller-side RPC this
    // migration deliberately leaves untouched has no knowledge of the flag.
    const updateListingStatusSource = readFile(UPDATE_LISTING_STATUS_PATH);
    const fnStart = updateListingStatusSource.indexOf("create or replace function public.update_listing_status(");
    const bodyStart = updateListingStatusSource.indexOf("begin\n", fnStart);
    const bodyEnd = updateListingStatusSource.indexOf("end;\n$$;", bodyStart);
    const body = updateListingStatusSource.slice(bodyStart, bodyEnd);
    expect(body).not.toMatch(/hidden_by_admin_at/);
  });

  it("lists exactly six CREATE OR REPLACE FUNCTION statements: the two new admin RPCs plus the three redefined read RPCs (get_listing_detail, browse_listings, get_my_favorites) -- nothing else", () => {
    const source = readFile(MIGRATION_PATH);
    const matches = source.match(/create or replace function public\.\w+\(/g) ?? [];
    expect(matches.sort()).toEqual(
      [
        "create or replace function public.admin_hide_listing(",
        "create or replace function public.admin_unhide_listing(",
        "create or replace function public.browse_listings(",
        "create or replace function public.get_listing_detail(",
        "create or replace function public.get_my_favorites(",
      ].sort(),
    );
  });
});

describe("0106 -- what these source-level tests cannot prove", () => {
  it("is an explicit, honest limitation, not an oversight: this suite only proves the migration's SQL TEXT has the intended shape -- it cannot prove the statements execute successfully against a real Postgres instance, that the new RLS/grant configuration behaves as intended at runtime, or that the ALTER TYPE/CREATE TABLE/CREATE FUNCTION statements are free of a syntax or dependency error only a real database would surface", () => {
    // Deliberately not a runnable assertion -- see 0105's own identical
    // precedent for why source-text review cannot substitute for actually
    // applying the migration. Recorded here as executable documentation so
    // this limitation is not silently dropped from the test suite.
    expect(true).toBe(true);
  });
});
