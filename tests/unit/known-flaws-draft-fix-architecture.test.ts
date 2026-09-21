// Architecture (SQL-text) coverage for 0100_allow_incomplete_fair_condition_
// draft.sql -- LAUNCH UX S1.1 STEP 2. Supplementary only: real runtime
// behavior (including the three-valued CHECK-constraint logic these regexes
// cannot exercise) is proven by tests/database/known-flaws-draft-fix.mjs
// against a disposable local PostgreSQL server, per this project's own
// documented convention (tests/database/README.md).
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

function readFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf-8");
}

const MIGRATION_PATH = "supabase/migrations/0100_allow_incomplete_fair_condition_draft.sql";
const VALIDATE_PUBLISHED_LISTING_PATH = "supabase/migrations/0094_published_listing_editing.sql";

describe("0100 touches exactly the intended constraint and two functions", () => {
  const source = readFile(MIGRATION_PATH);

  it("replaces exactly one constraint, by its exact existing name, no IF EXISTS", () => {
    const dropMatches = source.match(/drop constraint\s+listings_fair_requires_known_flaws_check/gi) ?? [];
    const addMatches = source.match(/add constraint\s+listings_fair_requires_known_flaws_check/gi) ?? [];
    expect(dropMatches).toHaveLength(1);
    expect(addMatches).toHaveLength(1);
    expect(source).not.toMatch(/drop constraint if exists/i);
    expect(source).not.toMatch(/constraint\s+(?!listings_fair_requires_known_flaws_check)\w+_check/i);
  });

  it("adds the new constraint NOT VALID, then validates it in the same file", () => {
    expect(source).toMatch(/add constraint\s+listings_fair_requires_known_flaws_check[\s\S]*?not valid;/i);
    expect(source).toMatch(/validate constraint\s+listings_fair_requires_known_flaws_check/i);
  });

  it("the new predicate exempts only status = 'draft', preserving the original predicate otherwise", () => {
    const constraintBlock = source.slice(
      source.indexOf("add constraint listings_fair_requires_known_flaws_check"),
      source.indexOf("not valid;"),
    );
    expect(constraintBlock).toMatch(/status\s*=\s*'draft'/);
    expect(constraintBlock).toMatch(/condition\s*<>\s*'fair'/);
    expect(constraintBlock).toMatch(/known_flaws is not null and btrim\(known_flaws\) <> ''/);
  });

  it("redefines exactly two functions: create_listing and update_listing", () => {
    const definitions = source.match(/create or replace function public\.\w+/gi) ?? [];
    const names = definitions.map((d) => d.replace(/create or replace function public\./i, ""));
    expect(names.sort()).toEqual(["create_listing", "update_listing"]);
  });

  it("touches no other schema object -- no new table, enum, index, or policy", () => {
    expect(source).not.toMatch(/create table|drop table/i);
    expect(source).not.toMatch(/create type|alter type/i);
    expect(source).not.toMatch(/create index|drop index/i);
    expect(source).not.toMatch(/create policy|alter policy|drop policy/i);
    expect(source).not.toMatch(/enable row level security|disable row level security/i);
    expect(source).not.toMatch(/storage\.objects/i);
  });

  it("never redefines publish_listing, update_listing_status, update_published_listing, validate_published_listing, or replace_listing_images", () => {
    expect(source).not.toMatch(/create or replace function public\.publish_listing/i);
    expect(source).not.toMatch(/create or replace function public\.update_listing_status/i);
    expect(source).not.toMatch(/create or replace function public\.update_published_listing/i);
    expect(source).not.toMatch(/create or replace function public\.validate_published_listing/i);
    expect(source).not.toMatch(/create or replace function public\.replace_listing_images/i);
    expect(source).not.toMatch(/create or replace function public\.get_published_listing_edit_state/i);
    // Not even CALLED from executable SQL -- 0100's header prose legitimately
    // names validate_published_listing to explain why it's untouched, so this
    // checks the executable body only (everything after the header comment
    // block, i.e. from the first real statement onward).
    const executableBody = source.slice(source.indexOf("alter table public.listings"));
    expect(executableBody).not.toMatch(/validate_published_listing/i);
  });
});

describe("0100 create_listing: unconditional Known-Flaws Draft guard removed, everything else intact", () => {
  const source = readFile(MIGRATION_PATH);
  const start = source.indexOf("create or replace function public.create_listing(");
  const end = source.indexOf("create or replace function public.update_listing(");
  const fn = source.slice(start, end);

  it("no longer raises KNOWN_FLAWS_REQUIRED unconditionally on p_condition/v_known_flaws", () => {
    expect(fn).not.toMatch(/if p_condition = 'fair' and v_known_flaws is null then/);
  });

  it("still normalizes p_known_flaws into v_known_flaws for storage", () => {
    expect(fn).toMatch(/v_known_flaws := nullif\(btrim\(p_known_flaws\), ''\);/);
    expect(fn).toMatch(/v_known_flaws, v_description, v_brand, p_price_cents/);
  });

  it("retains its exact parameter list (same signature as 0082)", () => {
    const paramBlock = fn.slice(0, fn.indexOf("returns table"));
    for (const param of [
      "p_title text default null",
      "p_description text default null",
      "p_category_id integer default null",
      "p_listing_type public.listing_type_enum default null",
      "p_condition public.listing_condition_enum default null",
      "p_price_cents bigint default null",
      "p_original_price_cents bigint default null",
      "p_is_negotiable boolean default false",
      "p_brand text default null",
      "p_known_flaws text default null",
      "p_stock_quantity integer default 1",
      "p_province_id integer default null",
      "p_city_id integer default null",
      "p_barangay_id integer default null",
      "p_meetup_note text default null",
      "p_fulfillment_methods public.fulfillment_method_enum[] default null",
      "p_image_paths text[] default null",
      "p_vehicle_details jsonb default null",
      "p_rental_details jsonb default null",
    ]) {
      expect(paramBlock).toContain(param);
    }
  });

  it("retains SECURITY DEFINER with an empty search_path", () => {
    expect(fn).toMatch(/security definer/i);
    expect(fn).toMatch(/set search_path = ''/);
  });

  it("retains authentication, deleted-account, shop-ownership, and restriction guards unchanged", () => {
    expect(fn).toMatch(/if v_caller is null then\s*\n\s*raise exception 'Authentication required\.' using detail = 'NOT_AUTHENTICATED';/);
    expect(fn).toMatch(/if not found or v_caller_deleted_at is not null then\s*\n\s*raise exception 'Account is not available\.' using detail = 'INTERACTION_BLOCKED';/);
    expect(fn).toMatch(/raise exception 'Create your shop first\.' using detail = 'SHOP_NOT_FOUND';/);
    expect(fn).toMatch(/restriction_type in \('seller_suspended', 'account_suspended'\)/);
    expect(fn).not.toMatch(/buyer_restricted/);
  });

  it("still requires title (the one deliberate Draft floor) and still always inserts status = 'draft'", () => {
    expect(fn).toMatch(/raise exception 'Listing title is required\.' using detail = 'TITLE_REQUIRED';/);
    expect(fn).toMatch(/'draft'::public\.listing_status_enum/);
  });

  it("still validates every other field unrelated to Known Flaws (price, stock, location, fulfillment, images, vehicle/rental)", () => {
    for (const code of [
      "PRICE_INVALID",
      "ORIGINAL_PRICE_INVALID",
      "STOCK_QUANTITY_INVALID",
      "CITY_REQUIRES_PROVINCE",
      "BARANGAY_REQUIRES_CITY",
      "FULFILLMENT_INVALID",
      "TOO_MANY_LISTING_IMAGES",
      "LISTING_IMAGE_PATH_INVALID",
      "VEHICLE_DETAILS_NOT_ALLOWED",
      "RENTAL_DETAILS_NOT_ALLOWED",
      "LISTING_TYPE_CONDITION_MISMATCH",
    ]) {
      expect(fn).toContain(code);
    }
  });

  it("reissues the identical REVOKE/GRANT shape (authenticated only)", () => {
    expect(fn).toMatch(/revoke all on function public\.create_listing\([\s\S]*?\) from public/i);
    expect(fn).toMatch(/revoke all on function public\.create_listing\([\s\S]*?\) from anon/i);
    expect(fn).toMatch(/grant execute on function public\.create_listing\([\s\S]*?\) to authenticated/i);
    expect(fn).not.toMatch(/grant execute on function public\.create_listing\([\s\S]*?\) to anon/i);
  });
});

describe("0100 update_listing: unconditional Known-Flaws Draft guard removed, everything else intact", () => {
  const source = readFile(MIGRATION_PATH);
  const start = source.indexOf("create or replace function public.update_listing(");
  const fn = source.slice(start);

  it("no longer raises KNOWN_FLAWS_REQUIRED unconditionally on v_final_condition/v_final_known_flaws", () => {
    expect(fn).not.toMatch(/if v_final_condition = 'fair' and v_final_known_flaws is null then/);
  });

  it("still computes v_final_known_flaws and still writes it to the UPDATE", () => {
    expect(fn).toMatch(/v_final_known_flaws := nullif\(btrim\(v_patch ->> 'known_flaws'\), ''\);/);
    expect(fn).toMatch(/known_flaws = v_final_known_flaws,/);
  });

  it("retains its exact signature (uuid, jsonb) and RETURNS TABLE shape", () => {
    expect(fn).toMatch(/create or replace function public\.update_listing\(p_listing_id uuid, p_patch jsonb default '\{\}'::jsonb\)/);
    expect(fn).toMatch(/returns table \(\s*\n\s*listing_id uuid,\s*\n\s*public_code text,\s*\n\s*slug text,\s*\n\s*status public\.listing_status_enum,\s*\n\s*updated_at timestamptz\s*\n\s*\)/);
  });

  it("retains SECURITY DEFINER with an empty search_path", () => {
    expect(fn).toMatch(/security definer/i);
    expect(fn).toMatch(/set search_path = ''/);
  });

  it("still rejects any non-draft row before reaching field validation (LISTING_NOT_DRAFT)", () => {
    expect(fn).toMatch(/if v_listing_status <> 'draft' then\s*\n\s*raise exception 'Only draft listings can be edited with this operation\.' using detail = 'LISTING_NOT_DRAFT';/);
  });

  it("retains authentication, deleted-account, ownership, and restriction guards unchanged", () => {
    expect(fn).toMatch(/if v_caller is null then\s*\n\s*raise exception 'Authentication required\.' using detail = 'NOT_AUTHENTICATED';/);
    expect(fn).toMatch(/if not found or v_caller_deleted_at is not null then\s*\n\s*raise exception 'Account is not available\.' using detail = 'INTERACTION_BLOCKED';/);
    expect(fn).toMatch(/raise exception 'You do not have permission to edit this listing\.' using detail = 'NOT_LISTING_OWNER';/);
    expect(fn).toMatch(/restriction_type in \('seller_suspended', 'account_suspended'\)/);
    expect(fn).not.toMatch(/buyer_restricted/);
  });

  it("still validates every other field unrelated to Known Flaws", () => {
    for (const code of [
      "TITLE_REQUIRED",
      "PRICE_INVALID",
      "ORIGINAL_PRICE_INVALID",
      "STOCK_QUANTITY_INVALID",
      "CITY_REQUIRES_PROVINCE",
      "BARANGAY_REQUIRES_CITY",
      "FULFILLMENT_INVALID",
      "LISTING_TYPE_CONDITION_MISMATCH",
      "VEHICLE_DETAILS_NOT_ALLOWED",
      "RENTAL_DETAILS_NOT_ALLOWED",
    ]) {
      expect(fn).toContain(code);
    }
  });

  it("reissues the identical REVOKE/GRANT shape (authenticated only)", () => {
    expect(fn).toMatch(/revoke all on function public\.update_listing\(uuid, jsonb\) from public/i);
    expect(fn).toMatch(/revoke all on function public\.update_listing\(uuid, jsonb\) from anon/i);
    expect(fn).toMatch(/grant execute on function public\.update_listing\(uuid, jsonb\) to authenticated/i);
    expect(fn).not.toMatch(/grant execute on function public\.update_listing\(uuid, jsonb\) to anon/i);
  });
});

describe("publish-time enforcement remains solely in the unchanged, historical validate_published_listing (0094)", () => {
  const historicalSource = readFile(VALIDATE_PUBLISHED_LISTING_PATH);

  it("0094's own Known-Flaws-for-Fair guard is untouched by this task -- still the sole publish-time enforcement point", () => {
    expect(historicalSource).toMatch(
      /if v_condition = 'fair' and \(v_known_flaws is null or v_known_flaws !~ '\[\^\[:space:\]\]'\) then\s*\n\s*raise exception 'Known flaws are required for Fair condition\.' using detail = 'KNOWN_FLAWS_REQUIRED';/,
    );
  });

  it("0094 is never referenced for modification by 0100 (0100 has no ALTER/CREATE OR REPLACE naming a 0094-defined function)", () => {
    const migration0100 = readFile(MIGRATION_PATH);
    for (const fn of [
      "validate_published_listing",
      "publish_listing",
      "update_listing_status",
      "update_published_listing",
      "get_published_listing_edit_state",
      "guard_listing_revision",
    ]) {
      expect(migration0100).not.toMatch(new RegExp(`function public\\.${fn}\\b`));
    }
  });
});
