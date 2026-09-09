import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

function readFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf-8");
}

const MIGRATION_PATH = "supabase/migrations/0062_original_price_non_negative_validation.sql";

function getCreateListingBody(source: string): string {
  const fnStart = source.indexOf("create or replace function public.create_listing(");
  const bodyStart = source.indexOf("begin\n", fnStart);
  const bodyEnd = source.indexOf("end;\n$$;", bodyStart);
  return source.slice(bodyStart, bodyEnd);
}

function getUpdateListingBody(source: string): string {
  const fnStart = source.indexOf("create or replace function public.update_listing(");
  const bodyStart = source.indexOf("begin\n", fnStart);
  const bodyEnd = source.indexOf("end;\n$$;", bodyStart);
  return source.slice(bodyStart, bodyEnd);
}

/** Actual executable statements only -- excludes the header comment, which
 * legitimately discusses "DROP FUNCTION" in prose while explaining why this
 * migration does NOT need one (unlike 0061). Anchored on the first real
 * statement, `alter table public.listings`. */
function getCodeOnly(source: string): string {
  return source.slice(source.indexOf("alter table public.listings"));
}

describe("0062 is scoped to the original-price non-negative gap only", () => {
  const source = readFile(MIGRATION_PATH);

  it("adds exactly one new CHECK constraint, alongside (not replacing) the existing listings_original_price_check", () => {
    expect(source).toMatch(/add constraint listings_original_price_non_negative_check\s*\n\s*check \(original_price_cents is null or original_price_cents >= 0\);/);
    expect(source).not.toMatch(/drop constraint listings_original_price_check/);
    expect(source).not.toMatch(/create table|drop table/i);
    expect(source).not.toMatch(/create type|alter type/i);
    expect(source).not.toMatch(/create policy|alter policy|drop policy|create index|drop index/i);
  });

  it("CREATE OR REPLACEs create_listing and update_listing under their identical current signatures -- no DROP FUNCTION, no other function touched", () => {
    expect(getCodeOnly(source)).not.toMatch(/drop function/i);
    expect(source).toMatch(/create or replace function public\.create_listing\s*\(/);
    expect(source).toMatch(/create or replace function public\.update_listing\s*\(\s*\n\s*p_listing_id uuid,\s*\n\s*p_patch jsonb default '\{\}'::jsonb/);
    expect(source).not.toMatch(/create or replace function public\.replace_listing_images/);
    expect(source).not.toMatch(/create or replace function public\.publish_listing\b/);
    expect(source).not.toMatch(/create or replace function public\.accept_seller_policies/);
  });

  it("never references orders/order_items/inventory_reservations", () => {
    expect(source).not.toMatch(/\bpublic\.orders\b/);
    expect(source).not.toMatch(/\bpublic\.order_items\b/);
    expect(source).not.toMatch(/\bpublic\.inventory_reservations\b/);
  });

  it("both functions remain SECURITY DEFINER with an empty search_path, granted to authenticated only", () => {
    expect(source).toMatch(/security definer/i);
    expect(source).toMatch(/set search_path = ''/);
    expect(source).toMatch(/grant execute on function public\.create_listing\(/i);
    expect(source).toMatch(/grant execute on function public\.update_listing\(uuid, jsonb\) to authenticated/i);
  });
});

describe("0062 create_listing: original price independently non-negative", () => {
  const source = readFile(MIGRATION_PATH);
  const body = getCreateListingBody(source);

  it("rejects a negative original price when price is null", () => {
    expect(body).toMatch(/if p_original_price_cents is not null and p_original_price_cents < 0 then\s*\n\s*raise exception 'Original price is invalid\.' using detail = 'ORIGINAL_PRICE_INVALID';/);
  });

  it("the non-negative check does not require p_price_cents to be non-null -- it is a standalone check on p_original_price_cents alone", () => {
    const checkBlock = body.slice(
      body.indexOf("if p_original_price_cents is not null and p_original_price_cents < 0 then"),
      body.indexOf("if p_original_price_cents is not null and p_price_cents is not null and p_original_price_cents < p_price_cents then"),
    );
    expect(checkBlock).not.toMatch(/p_price_cents is not null/);
  });

  it("still rejects original < price when both are supplied (existing relational rule preserved verbatim)", () => {
    expect(body).toMatch(/if p_original_price_cents is not null and p_price_cents is not null and p_original_price_cents < p_price_cents then\s*\n\s*raise exception 'Original price must not be lower than the current price\.' using detail = 'ORIGINAL_PRICE_INVALID';/);
  });

  it("the non-negative check runs before the relational check", () => {
    const nonNegativeIndex = body.indexOf("if p_original_price_cents is not null and p_original_price_cents < 0 then");
    const relationalIndex = body.indexOf("p_original_price_cents < p_price_cents then");
    expect(nonNegativeIndex).toBeGreaterThan(0);
    expect(relationalIndex).toBeGreaterThan(nonNegativeIndex);
  });

  it("a null original price is never rejected by either check", () => {
    expect(body).toMatch(/if p_original_price_cents is not null and p_original_price_cents < 0/);
    expect(body).toMatch(/if p_original_price_cents is not null and p_price_cents is not null/);
  });

  it("preserves the unrelated price >= 0 check untouched", () => {
    expect(body).toMatch(/if p_price_cents is not null and p_price_cents < 0 then\s*\n\s*raise exception 'Price is invalid\.' using detail = 'PRICE_INVALID';/);
  });
});

describe("0062 update_listing: original price validated on the FINAL merged state", () => {
  const source = readFile(MIGRATION_PATH);
  const body = getUpdateListingBody(source);

  it("omitted original_price_cents preserves the existing stored value", () => {
    expect(body).toMatch(/else\s*\n\s*v_final_original_price_cents := v_original_price_cents;\s*\n\s*end if;/);
  });

  it("explicit JSON null still clears original_price_cents to NULL -- the new non-negative check only fires when the final value is non-null", () => {
    expect(body).toMatch(/if jsonb_typeof\(v_patch -> 'original_price_cents'\) = 'null' then\s*\n\s*v_final_original_price_cents := null;/);
    expect(body).toMatch(/if v_final_original_price_cents is not null and v_final_original_price_cents < 0 then/);
  });

  it("rejects a negative FINAL original price when the final price is null (e.g. price omitted or itself cleared)", () => {
    expect(body).toMatch(/if v_final_original_price_cents is not null and v_final_original_price_cents < 0 then\s*\n\s*raise exception 'Original price is invalid\.' using detail = 'ORIGINAL_PRICE_INVALID';/);
  });

  it("the non-negative check is standalone -- it does not also require v_final_price_cents to be non-null", () => {
    const checkBlock = body.slice(
      body.indexOf("if v_final_original_price_cents is not null and v_final_original_price_cents < 0 then"),
      body.indexOf("if v_final_original_price_cents is not null and v_final_price_cents is not null"),
    );
    expect(checkBlock).not.toMatch(/v_final_price_cents is not null/);
  });

  it("still rejects final original < final price when both are non-null (existing relational rule preserved verbatim)", () => {
    expect(body).toMatch(/if v_final_original_price_cents is not null and v_final_price_cents is not null\s*\n\s*and v_final_original_price_cents < v_final_price_cents then\s*\n\s*raise exception 'Original price must not be lower than the current price\.' using detail = 'ORIGINAL_PRICE_INVALID';/);
  });

  it("accepts a final original price >= final price -- the relational check only raises on strictly-less-than", () => {
    // structural confirmation: the only raise in this block is the < comparison, not <=
    const relationalBlock = body.slice(
      body.indexOf("if v_final_original_price_cents is not null and v_final_price_cents is not null"),
      body.indexOf("is_negotiable: NOT NULL column"),
    );
    expect(relationalBlock).toMatch(/v_final_original_price_cents < v_final_price_cents/);
    expect(relationalBlock).not.toMatch(/<=/);
  });

  it("the non-negative check runs before the relational check, both after v_final_original_price_cents is fully resolved", () => {
    const resolvedIndex = body.indexOf("v_final_original_price_cents := v_original_price_cents;");
    const nonNegativeIndex = body.indexOf("if v_final_original_price_cents is not null and v_final_original_price_cents < 0 then");
    const relationalIndex = body.indexOf("v_final_original_price_cents < v_final_price_cents");
    expect(nonNegativeIndex).toBeGreaterThan(resolvedIndex);
    expect(relationalIndex).toBeGreaterThan(nonNegativeIndex);
  });

  it("preserves omitted/set/clear semantics for every other field -- price_cents, title, and the location cascade are untouched", () => {
    expect(body).toMatch(/v_final_price_cents := v_price_cents;/);
    expect(body).toMatch(/v_final_title := v_title;/);
    expect(body).toMatch(/-- cascade: province was cleared and the caller did not itself touch city_id/);
  });

  it("preserves Draft-only gating unchanged", () => {
    expect(body).toMatch(/if v_listing_status <> 'draft' then\s*\n\s*raise exception 'Only draft listings can be edited with this operation\.' using detail = 'LISTING_NOT_DRAFT';/);
  });
});

describe("0062 DB CHECK added as defense-in-depth", () => {
  const source = readFile(MIGRATION_PATH);

  it("adds listings_original_price_non_negative_check, independent of price_cents (closes the three-valued-logic gap when price_cents is null)", () => {
    expect(source).toMatch(/alter table public\.listings\s*\n\s*add constraint listings_original_price_non_negative_check\s*\n\s*check \(original_price_cents is null or original_price_cents >= 0\);/);
  });

  it("does not alter or drop the existing listings_original_price_check (original >= price) constraint", () => {
    expect(source).not.toMatch(/drop constraint listings_original_price_check\b/);
    expect(source).not.toMatch(/alter constraint listings_original_price_check/);
  });

  it("documents that live data was checked before adding the CHECK (0 rows / 0 negative rows)", () => {
    expect(source).toMatch(/0 total rows \/ 0 negative rows/);
  });
});

describe("0062 does not touch out-of-scope RPCs or behavior", () => {
  const source = readFile(MIGRATION_PATH);

  it("does not modify replace_listing_images", () => {
    expect(source).not.toMatch(/create or replace function public\.replace_listing_images/);
    expect(source).not.toMatch(/drop function.*replace_listing_images/);
  });

  it("does not modify publish_listing or accept_seller_policies", () => {
    expect(source).not.toMatch(/create or replace function public\.publish_listing\b/);
    expect(source).not.toMatch(/create or replace function public\.accept_seller_policies/);
  });

  it("documents that publish_listing needed no change (it never re-validates original_price_cents)", () => {
    expect(source).toMatch(/publish_listing does not re-validate original_price_cents/);
  });
});
