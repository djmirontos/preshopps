import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

function readFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf-8");
}

const MIGRATION_PATH = "supabase/migrations/0107_list_public_shops.sql";
const GET_SHOP_DETAIL_PATH = "supabase/migrations/0036_public_marketplace_read_rpcs.sql";
const BROWSE_LISTINGS_PATH = "supabase/migrations/0106_admin_listing_hide.sql";

function getFunctionBody(source: string, anchor: string): string {
  const fnStart = source.indexOf(anchor);
  if (fnStart === -1) throw new Error(`anchor not found: ${anchor}`);
  const bodyStart = source.indexOf("begin\n", fnStart);
  const bodyEnd = source.indexOf("end;\n$$;", bodyStart);
  return source.slice(bodyStart, bodyEnd);
}

/**
 * This migration's own explanatory comments legitimately discuss the
 * columns/tables/behavior being added in prose -- strip `-- ...` line
 * comments before asserting equality/absence, so tests check actual SQL,
 * not commentary about it. Mirrors 0105/0106's own identical helper.
 */
function stripSqlComments(sql: string): string {
  return sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

const source = readFile(MIGRATION_PATH);
const body = getFunctionBody(source, "create or replace function public.list_public_shops(");
const codeOnly = stripSqlComments(body);

describe("0107 list_public_shops: signature, SECURITY DEFINER, search_path, grants", () => {
  it("returns exactly shop_id, slug, created_at, updated_at -- no owner_id, name, description, logo, messenger_link, or status", () => {
    expect(source).toMatch(
      /create or replace function public\.list_public_shops\(\s*\n\s*p_limit integer default 50,\s*\n\s*p_before_created_at timestamptz default null,\s*\n\s*p_before_id uuid default null\s*\n\)\s*\nreturns table \(\s*\n\s*shop_id uuid,\s*\n\s*slug text,\s*\n\s*created_at timestamptz,\s*\n\s*updated_at timestamptz\s*\n\)\s*\nlanguage plpgsql\nsecurity definer\nset search_path = ''/,
    );
  });

  it("is a public marketplace read RPC -- no auth.uid()/authentication check, matching browse_listings/get_shop_detail's own convention (not an admin RPC)", () => {
    expect(codeOnly).not.toMatch(/auth\.uid\(\)/);
    expect(codeOnly).not.toMatch(/NOT_AUTHENTICATED|NOT_ADMIN/);
  });

  it("is granted to anon and authenticated -- a public read path, not admin-only", () => {
    expect(source).toMatch(/revoke all on function public\.list_public_shops\(integer, timestamptz, uuid\) from public;/);
    expect(source).toMatch(/grant execute on function public\.list_public_shops\(integer, timestamptz, uuid\) to anon;/);
    expect(source).toMatch(/grant execute on function public\.list_public_shops\(integer, timestamptz, uuid\) to authenticated;/);
  });

  it("does not create, alter, or drop any table, column, enum, index, or RLS policy -- function-only migration", () => {
    const wholeFile = stripSqlComments(source);
    expect(wholeFile).not.toMatch(/create table|alter table|create type|create index|create policy|enable row level security/i);
  });

  it("does not redefine any existing function -- exactly one CREATE OR REPLACE FUNCTION statement in this file", () => {
    const matches = source.match(/create or replace function public\.\w+\(/g) ?? [];
    expect(matches).toEqual(["create or replace function public.list_public_shops("]);
  });
});

describe("0107 list_public_shops: input validation", () => {
  it("validates p_limit between 1 and 50, identical wording/detail code to browse_listings' own convention", () => {
    expect(codeOnly).toMatch(
      /if p_limit is null or p_limit < 1 or p_limit > 50 then\s*\n\s*raise exception 'Limit must be between 1 and 50\.' using detail = 'LIMIT_INVALID';/,
    );
  });

  it("requires both cursor values together, identical wording/detail code to browse_listings'/get_my_favorites' own convention", () => {
    expect(codeOnly).toMatch(
      /if \(p_before_created_at is null\) <> \(p_before_id is null\) then\s*\n\s*raise exception 'Cursor values must be supplied together\.' using detail = 'CURSOR_INVALID';/,
    );
  });
});

describe("0107 list_public_shops: visibility rule matches get_shop_detail exactly", () => {
  const getShopDetailSource = readFile(GET_SHOP_DETAIL_PATH);
  const getShopDetailBody = getFunctionBody(getShopDetailSource, "create or replace function public.get_shop_detail(");

  it("uses the exact same NOT EXISTS suspension subquery shape and restriction_type list as get_shop_detail", () => {
    const pattern =
      /not exists \(\s*\n\s*select 1 from public\.user_restrictions ur\s*\n\s*where ur\.user_id = s\.owner_id\s*\n\s*and ur\.lifted_at is null\s*\n\s*and ur\.restriction_type in \('seller_suspended', 'account_suspended'\)\s*\n\s*\)/;
    expect(codeOnly).toMatch(pattern);
    expect(stripSqlComments(getShopDetailBody)).toMatch(pattern);
  });

  it("never filters on shop_status_enum ('active'/'away') -- matching get_shop_detail, where an 'away' shop is still visible", () => {
    expect(codeOnly).not.toMatch(/s\.status|shop_status/);
    expect(stripSqlComments(getShopDetailBody)).not.toMatch(/where[\s\S]*s\.status(?!\s+as)/);
  });

  it("never joins or references public.listings -- a shop with zero listings is still enumerated, unlike any browse_listings-derived approach", () => {
    expect(codeOnly).not.toMatch(/public\.listings/);
  });

  it("never references shop_slugs -- emits only the current-slug cache column (shops.slug), never slug history", () => {
    expect(codeOnly).not.toMatch(/shop_slugs/);
  });

  it("selects from shops using only s.id, s.slug, s.created_at, s.updated_at, and s.owner_id (for the suspension check) -- no other column", () => {
    const selectMatch = codeOnly.match(/return query\s*\n\s*select\s*\n([\s\S]*?)\n\s*from public\.shops s/);
    expect(selectMatch).not.toBeNull();
    const selectList = selectMatch![1];
    expect(selectList).toMatch(/s\.id as shop_id/);
    expect(selectList).toMatch(/s\.slug/);
    expect(selectList).toMatch(/s\.created_at/);
    expect(selectList).toMatch(/s\.updated_at/);
    expect(selectList).not.toMatch(/owner_id|name|description|logo_storage_path|messenger_link|status|is_trusted_seller|trusted_seller_calculated_at|province_id|city_id|barangay_id|featured_listing_id/);
  });
});

describe("0107 list_public_shops: keyset cursor cannot skip or repeat shops with equal timestamps", () => {
  it("orders by (created_at, id) DESC -- the same composite tie-break browse_listings' own newest branch and get_my_favorites already use", () => {
    expect(codeOnly).toMatch(/order by s\.created_at desc, s\.id desc/);
  });

  it("the keyset predicate is a strict '<' on the exact same (created_at, id) tuple used in ORDER BY -- matching direction, so no row can be skipped or repeated across a page boundary", () => {
    expect(codeOnly).toMatch(
      /p_before_created_at is null\s*\n\s*or \(s\.created_at, s\.id\) < \(p_before_created_at, p_before_id\)/,
    );
  });

  it("id is present in both the ORDER BY and the keyset predicate -- required so two shops sharing the exact same created_at instant are still given a deterministic, gap-free order", () => {
    const orderByMatch = codeOnly.match(/order by ([^\n;]+)/);
    const predicateMatch = codeOnly.match(/or \(([^)]+)\) < \(/);
    expect(orderByMatch?.[1]).toMatch(/s\.id/);
    expect(predicateMatch?.[1]).toMatch(/s\.id/);
  });

  it("updated_at is never part of the WHERE clause or ORDER BY -- only the immutable created_at (plus id) drives pagination, so editing a shop's updated_at between two page fetches can never move it out from under an in-progress walk", () => {
    const whereClause = codeOnly.slice(codeOnly.indexOf("where"), codeOnly.indexOf("order by"));
    expect(whereClause).not.toMatch(/updated_at/);
    const orderByClause = codeOnly.slice(codeOnly.indexOf("order by"));
    expect(orderByClause).not.toMatch(/updated_at/);
  });

  it("updated_at appears exactly once in the function body -- the SELECT output column -- confirming it is purely a returned lastmod value, never a filter or sort key", () => {
    const matches = codeOnly.match(/updated_at/g) ?? [];
    expect(matches).toHaveLength(1);
  });
});

describe("0107 -- consistency with the established keyset convention (browse_listings' own newest branch, post-0106)", () => {
  const browseListingsSource = readFile(BROWSE_LISTINGS_PATH);
  const browseListingsBody = getFunctionBody(browseListingsSource, "create or replace function public.browse_listings(");
  const browseListingsCodeOnly = stripSqlComments(browseListingsBody);

  it("browse_listings' own newest branch uses the identical strict '<' direction on its own (created_at, id) tuple -- list_public_shops' cursor direction is not a one-off invention", () => {
    expect(browseListingsCodeOnly).toMatch(
      /p_before_created_at is null\s*\n\s*or \(l\.created_at, l\.id\) < \(p_before_created_at, p_before_id\)/,
    );
    expect(browseListingsCodeOnly).toMatch(/order by l\.created_at desc, l\.id desc/);
  });
});

describe("0107 -- what these source-level tests cannot prove", () => {
  it("is an explicit, honest limitation, not an oversight: this suite only proves the migration's SQL TEXT has the intended shape -- it cannot prove the CREATE FUNCTION statement executes successfully against a real Postgres instance, that the stated grants take effect at runtime, that the keyset pagination actually walks every row exactly once against live data with concurrent writes, or that PL/pgSQL's own tuple-comparison semantics for (timestamptz, uuid) behave as assumed outside a real database", () => {
    // Deliberately not a runnable assertion -- see 0105/0106's own
    // identical precedent for why source-text review cannot substitute
    // for actually applying the migration. Recorded here as executable
    // documentation so this limitation is not silently dropped from the
    // test suite.
    expect(true).toBe(true);
  });
});
