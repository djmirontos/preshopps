// Architecture (SQL-text) coverage for
// 0101_auto_assign_brand_new_condition.sql -- the Brand New publication
// blocker fix. Supplementary only: real runtime behavior (including the
// three-valued-logic and revision/rollback claims these regexes cannot
// exercise) is proven by tests/database/brand-new-condition-fix.mjs
// against a disposable local PostgreSQL server, per this project's own
// documented convention (tests/database/README.md), mirroring
// known-flaws-draft-fix-architecture.test.ts's own pattern for 0100.
//
// This file, not the three original migrations' own frozen architecture
// tests (create-listing-architecture.test.ts targets 0054,
// update-listing-architecture.test.ts targets 0059,
// publish-listing-architecture.test.ts targets its own introducing
// migration), is where 0101's new derivation logic is asserted --
// consistent with this project's established one-architecture-test-file-
// per-migration convention (0100's own known-flaws-draft-fix-
// architecture.test.ts is the precedent).
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

function readFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf-8");
}

const MIGRATION_PATH = "supabase/migrations/0101_auto_assign_brand_new_condition.sql";

describe("0101 touches exactly the intended three functions, nothing else", () => {
  const source = readFile(MIGRATION_PATH);

  it("redefines exactly three functions: create_listing, update_listing, publish_listing", () => {
    const definitions = source.match(/create or replace function public\.\w+/gi) ?? [];
    const names = definitions.map((d) => d.replace(/create or replace function public\./i, ""));
    expect(names.sort()).toEqual(["create_listing", "publish_listing", "update_listing"]);
  });

  it("never redefines validate_published_listing, update_listing_status, update_published_listing, replace_listing_images, get_published_listing_edit_state, or guard_listing_revision", () => {
    for (const fn of [
      "validate_published_listing",
      "update_listing_status",
      "update_published_listing",
      "replace_listing_images",
      "get_published_listing_edit_state",
      "guard_listing_revision",
    ]) {
      expect(source).not.toMatch(new RegExp(`create or replace function public\\.${fn}\\b`, "i"));
    }
    // validate_published_listing is legitimately CALLED (perform ...) and
    // named in prose -- only ensure it's never the target of a definition.
    expect(source).toMatch(/perform public\.validate_published_listing\(p_listing_id, false\);/);
  });

  it("touches no schema object -- no new table, enum, index, trigger, policy, or constraint", () => {
    expect(source).not.toMatch(/create table|drop table|alter table/i);
    expect(source).not.toMatch(/create type|alter type/i);
    expect(source).not.toMatch(/create index|drop index/i);
    expect(source).not.toMatch(/create policy|alter policy|drop policy/i);
    expect(source).not.toMatch(/create trigger|drop trigger/i);
    expect(source).not.toMatch(/add constraint|drop constraint/i);
    expect(source).not.toMatch(/enable row level security|disable row level security/i);
    expect(source).not.toMatch(/storage\.objects/i);
  });

  it("performs no backfill UPDATE against existing rows -- only function/grant statements", () => {
    // The only `update public.listings` statements in this file live
    // inside function bodies (dollar-quoted), never as a bare top-level
    // statement outside a CREATE FUNCTION block. The header comment block
    // legitimately mentions "update public.listings" in backtick-quoted
    // prose describing the fix -- excluded here the same way 0100's own
    // architecture test excludes its header ("executableBody"), by
    // starting from the first real statement.
    const executableSource = source.slice(source.indexOf("create or replace function public.create_listing("));
    const withoutFunctionBodies = executableSource.replace(/\$\$[\s\S]*?\$\$/g, "");
    expect(withoutFunctionBodies).not.toMatch(/update\s+public\.listings/i);
  });
});

describe("0101 create_listing: derives Brand New's condition only when NULL, existing mismatch check untouched", () => {
  const source = readFile(MIGRATION_PATH);
  const start = source.indexOf("create or replace function public.create_listing(");
  const end = source.indexOf("create or replace function public.update_listing(");
  const fn = source.slice(start, end);

  it("retains the original, unmodified mismatch checks for an explicit incompatible condition", () => {
    expect(fn).toMatch(/if p_listing_type = 'brand_new' and p_condition <> 'brand_new' then\s*\n\s*raise exception 'Brand New listings must use Brand New condition\.' using detail = 'LISTING_TYPE_CONDITION_MISMATCH';/);
    expect(fn).toMatch(/if p_listing_type = 'preloved' and p_condition = 'brand_new' then\s*\n\s*raise exception 'Pre-loved listings cannot use Brand New condition\.' using detail = 'LISTING_TYPE_CONDITION_MISMATCH';/);
  });

  it("adds the new derivation: brand_new + NULL condition assigns p_condition := 'brand_new'", () => {
    expect(fn).toMatch(/if p_listing_type = 'brand_new' and p_condition is null then\s*\n\s*p_condition := 'brand_new';\s*\n\s*end if;/);
  });

  it("places the derivation after the mismatch checks and before the INSERT, so the mismatch check still sees the caller's original explicit value", () => {
    const mismatchIndex = fn.indexOf("LISTING_TYPE_CONDITION_MISMATCH");
    const derivationIndex = fn.indexOf("p_condition := 'brand_new';");
    const insertIndex = fn.indexOf("insert into public.listings");
    expect(mismatchIndex).toBeGreaterThan(-1);
    expect(derivationIndex).toBeGreaterThan(mismatchIndex);
    expect(insertIndex).toBeGreaterThan(derivationIndex);
  });

  it("still writes p_condition (now possibly derived) verbatim into the INSERT's condition column", () => {
    expect(fn).toMatch(/values \(\s*\n\s*v_shop_id, p_category_id, v_title, v_slug, v_public_code, p_listing_type, p_condition,/);
  });

  it("retains its exact 19-parameter signature and REVOKE/GRANT shape (authenticated only)", () => {
    const paramBlock = fn.slice(0, fn.indexOf("returns table"));
    for (const param of [
      "p_title text default null",
      "p_listing_type public.listing_type_enum default null",
      "p_condition public.listing_condition_enum default null",
      "p_vehicle_details jsonb default null",
      "p_rental_details jsonb default null",
    ]) {
      expect(paramBlock).toContain(param);
    }
    expect(source).toMatch(/revoke all on function public\.create_listing\([\s\S]*?\) from public/i);
    expect(source).toMatch(/revoke all on function public\.create_listing\([\s\S]*?\) from anon/i);
    expect(source).toMatch(/grant execute on function public\.create_listing\([\s\S]*?\) to authenticated/i);
  });

  it("retains SECURITY DEFINER with an empty search_path", () => {
    expect(fn).toMatch(/security definer/i);
    expect(fn).toMatch(/set search_path = ''/);
  });

  it("still requires title and still always inserts status = 'draft' -- Draft floor unchanged", () => {
    expect(fn).toMatch(/raise exception 'Listing title is required\.' using detail = 'TITLE_REQUIRED';/);
    expect(fn).toMatch(/'draft'::public\.listing_status_enum/);
  });
});

describe("0101 update_listing: derives Brand New's resolved condition only when NULL, existing mismatch check untouched", () => {
  const source = readFile(MIGRATION_PATH);
  const start = source.indexOf("create or replace function public.update_listing(");
  const end = source.indexOf("create or replace function public.publish_listing(");
  const fn = source.slice(start, end);

  it("retains the original, unmodified mismatch checks against the resolved final type/condition", () => {
    expect(fn).toMatch(/if v_final_listing_type = 'brand_new' and v_final_condition <> 'brand_new' then\s*\n\s*raise exception 'Brand New listings must use Brand New condition\.' using detail = 'LISTING_TYPE_CONDITION_MISMATCH';/);
    expect(fn).toMatch(/if v_final_listing_type = 'preloved' and v_final_condition = 'brand_new' then\s*\n\s*raise exception 'Pre-loved listings cannot use Brand New condition\.' using detail = 'LISTING_TYPE_CONDITION_MISMATCH';/);
  });

  it("adds the new derivation: resolved brand_new + NULL condition assigns v_final_condition := 'brand_new'", () => {
    expect(fn).toMatch(/if v_final_listing_type = 'brand_new' and v_final_condition is null then\s*\n\s*v_final_condition := 'brand_new';\s*\n\s*end if;/);
  });

  it("places the derivation after the mismatch checks and before the UPDATE statement", () => {
    const mismatchIndex = fn.indexOf("LISTING_TYPE_CONDITION_MISMATCH");
    const derivationIndex = fn.indexOf("v_final_condition := 'brand_new';");
    const updateIndex = fn.indexOf("update public.listings as l");
    expect(mismatchIndex).toBeGreaterThan(-1);
    expect(derivationIndex).toBeGreaterThan(mismatchIndex);
    expect(updateIndex).toBeGreaterThan(derivationIndex);
  });

  it("still writes v_final_condition (now possibly derived) into the UPDATE's condition column", () => {
    expect(fn).toMatch(/set title = v_final_title,[\s\S]*?condition = v_final_condition,/);
  });

  it("retains its exact signature (uuid, jsonb) and REVOKE/GRANT shape (authenticated only)", () => {
    expect(fn).toMatch(/create or replace function public\.update_listing\(p_listing_id uuid, p_patch jsonb default '\{\}'::jsonb\)/);
    expect(source).toMatch(/revoke all on function public\.update_listing\(uuid, jsonb\) from public/i);
    expect(source).toMatch(/revoke all on function public\.update_listing\(uuid, jsonb\) from anon/i);
    expect(source).toMatch(/grant execute on function public\.update_listing\(uuid, jsonb\) to authenticated/i);
  });

  it("retains SECURITY DEFINER with an empty search_path", () => {
    expect(fn).toMatch(/security definer/i);
    expect(fn).toMatch(/set search_path = ''/);
  });

  it("still rejects any non-draft row before reaching field resolution (LISTING_NOT_DRAFT), and still checks ownership first", () => {
    expect(fn).toMatch(/raise exception 'You do not have permission to edit this listing\.' using detail = 'NOT_LISTING_OWNER';/);
    expect(fn).toMatch(/if v_listing_status <> 'draft' then\s*\n\s*raise exception 'Only draft listings can be edited with this operation\.' using detail = 'LISTING_NOT_DRAFT';/);
  });
});

describe("0101 publish_listing: normalizes the locked row's condition before strict validation, only for brand_new + NULL", () => {
  const source = readFile(MIGRATION_PATH);
  const start = source.indexOf("create or replace function public.publish_listing(");
  const fn = source.slice(start);

  it("adds a real UPDATE on public.listings, guarded by listing_type = brand_new and condition is null", () => {
    expect(fn).toMatch(
      /if v_listing_type = 'brand_new' and v_condition is null then\s*\n\s*update public\.listings as l\s*\n\s*set condition = 'brand_new'\s*\n\s*where l\.id = p_listing_id;\s*\n\s*end if;/,
    );
  });

  it("places the normalization strictly after every authorization/eligibility/policy check, and strictly before validate_published_listing", () => {
    const ownerCheckIndex = fn.indexOf("NOT_LISTING_OWNER");
    const draftCheckIndex = fn.indexOf("LISTING_NOT_DRAFT");
    const policyCheckIndex = fn.indexOf("SELLER_POLICIES_NOT_ACCEPTED");
    const normalizationIndex = fn.indexOf("set condition = 'brand_new'");
    const validateIndex = fn.indexOf("perform public.validate_published_listing(p_listing_id, false);");

    expect(ownerCheckIndex).toBeGreaterThan(-1);
    expect(draftCheckIndex).toBeGreaterThan(ownerCheckIndex);
    expect(policyCheckIndex).toBeGreaterThan(draftCheckIndex);
    expect(normalizationIndex).toBeGreaterThan(policyCheckIndex);
    expect(validateIndex).toBeGreaterThan(normalizationIndex);
  });

  it("places the normalization before the status transition, while the row is still locked and still Draft -- so guard_listing_revision's Draft branch applies, no extra revision bump", () => {
    const normalizationIndex = fn.indexOf("set condition = 'brand_new'");
    const statusFlipIndex = fn.indexOf("set status = 'available'");
    expect(normalizationIndex).toBeGreaterThan(-1);
    expect(statusFlipIndex).toBeGreaterThan(normalizationIndex);
  });

  it("still locks the row with FOR UPDATE and still performs the unchanged ownership/status/policy checks", () => {
    expect(fn).toMatch(/for update;/);
    expect(fn).toMatch(/raise exception 'Listing not found\.' using detail = 'LISTING_NOT_FOUND';/);
    expect(fn).toMatch(/raise exception 'You do not have permission to publish this listing\.' using detail = 'NOT_LISTING_OWNER';/);
    expect(fn).toMatch(/raise exception 'Only draft listings can be published\.' using detail = 'LISTING_NOT_DRAFT';/);
    expect(fn).toMatch(/raise exception 'You must accept the Marketplace Rules and Prohibited Items Policy before publishing\.' using detail = 'SELLER_POLICIES_NOT_ACCEPTED';/);
  });

  it("still calls validate_published_listing with the same arguments as before (p_listing_id, false)", () => {
    expect(fn).toMatch(/perform public\.validate_published_listing\(p_listing_id, false\);/);
  });

  it("retains its exact signature (uuid) and REVOKE/GRANT shape (authenticated only)", () => {
    expect(fn).toMatch(/create or replace function public\.publish_listing\(p_listing_id uuid\)/);
    expect(source).toMatch(/revoke all on function public\.publish_listing\(uuid\) from public/i);
    expect(source).toMatch(/revoke all on function public\.publish_listing\(uuid\) from anon/i);
    expect(source).toMatch(/grant execute on function public\.publish_listing\(uuid\) to authenticated/i);
  });

  it("retains SECURITY DEFINER with an empty search_path", () => {
    expect(fn).toMatch(/security definer/i);
    expect(fn).toMatch(/set search_path = ''/);
  });

  it("neither the new nor the pre-existing UPDATE in this function sets updated_at -- consistent with the function's existing convention, no new timestamp behavior introduced", () => {
    const conditionUpdateBlock = fn.slice(fn.indexOf("set condition = 'brand_new'"), fn.indexOf("set condition = 'brand_new'") + 120);
    const statusUpdateBlock = fn.slice(fn.indexOf("set status = 'available'"), fn.indexOf("set status = 'available'") + 120);
    expect(conditionUpdateBlock).not.toMatch(/updated_at/);
    expect(statusUpdateBlock).not.toMatch(/updated_at/);
  });
});
