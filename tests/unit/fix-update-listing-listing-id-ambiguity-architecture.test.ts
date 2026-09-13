import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

function readFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf-8");
}

const MIGRATION_PATH = "supabase/migrations/0090_fix_update_listing_listing_id_ambiguity.sql";

/** Strips -- line comments so a static assertion about actual SQL can't
 * false-positive on this migration's own extensive header prose, which
 * deliberately discusses (by name) the exact bug/pattern being fixed --
 * same technique already established in this codebase's other
 * architecture test files (e.g. buy-now-architecture.test.ts). */
function stripComments(source: string): string {
  return source.replace(/^\s*--.*$/gm, "");
}

/** The function body only (between `create or replace function
 * public.update_listing(` and its own closing `$$;`). */
function getFunctionBody(source: string): string {
  const start = source.indexOf("create or replace function public.update_listing(");
  const end = source.indexOf("$$;", start);
  return source.slice(start, end);
}

describe("0090 -- migration numbering and scope", () => {
  it("0090_fix_update_listing_listing_id_ambiguity.sql exists, and no migration newer than it exists yet", () => {
    const migrationFiles = readdirSync(path.join(process.cwd(), "supabase/migrations")).filter((f) => f.endsWith(".sql"));
    expect(migrationFiles).toContain("0090_fix_update_listing_listing_id_ambiguity.sql");
    const newerThan0090 = migrationFiles.filter((f) => f > "0090_fix_update_listing_listing_id_ambiguity.sql");
    expect(newerThan0090).toEqual([]);
  });

  it("0086 remains intentionally unused, and 0087/0088/0089 are untouched (still present, unmodified filenames)", () => {
    const migrationFiles = readdirSync(path.join(process.cwd(), "supabase/migrations")).filter((f) => f.endsWith(".sql"));
    expect(migrationFiles.some((f) => f.startsWith("0086_"))).toBe(false);
    expect(migrationFiles).toContain("0087_enable_messaging_notification_realtime.sql");
    expect(migrationFiles).toContain("0088_exact_unread_badge_counts.sql");
    expect(migrationFiles).toContain("0089_buy_now_order_submission.sql");
  });

  it("this migration replaces exactly one function -- update_listing -- and creates no table/enum/policy/index", () => {
    const source = stripComments(readFile(MIGRATION_PATH));
    const createOrReplaceCount = (source.match(/create or replace function/g) ?? []).length;
    expect(createOrReplaceCount).toBe(1);
    expect(source).toMatch(/create or replace function public\.update_listing\(/);
    expect(source).not.toMatch(/create table|alter table|drop table/i);
    expect(source).not.toMatch(/create type|alter type/i);
    expect(source).not.toMatch(/create policy|alter policy|drop policy|create index|drop index/i);
    expect(source).not.toMatch(/create or replace function public\.(create_listing|replace_listing_images|publish_listing|update_listing_status|accept_seller_policies)\b/);
  });

  it("no service-role reference in this migration's actual SQL (the header prose discusses the already-confirmed live grants by name, which is documentation, not a grant statement)", () => {
    const source = stripComments(readFile(MIGRATION_PATH));
    expect(source.toLowerCase()).not.toContain("service_role");
    expect(source.toLowerCase()).not.toContain("service-role");
  });
});

describe("0090 -- every ambiguous bare `listing_id` reference is now explicitly qualified", () => {
  const source = stripComments(readFile(MIGRATION_PATH));
  const body = getFunctionBody(source);

  it("no bare, unqualified `where listing_id = p_listing_id` predicate remains anywhere in the function", () => {
    expect(body).not.toMatch(/(?:^|[^.\w])where\s+listing_id\s*=\s*p_listing_id/);
  });

  it("all listing_fulfillment_methods listing_id references are qualified via an explicit table alias", () => {
    const matches = body.match(/delete from public\.listing_fulfillment_methods[\s\S]{0,60}/g) ?? [];
    expect(matches.length).toBeGreaterThan(0);
    for (const statement of matches) {
      expect(statement).toMatch(/delete from public\.listing_fulfillment_methods as lfm where lfm\.listing_id = p_listing_id/);
    }
  });

  it("all listing_vehicle_details DELETE listing_id references are qualified via an explicit table alias (both the unconditional cleanup branch and the explicit-null-clear branch)", () => {
    const matches = body.match(/delete from public\.listing_vehicle_details[\s\S]{0,60}/g) ?? [];
    expect(matches).toHaveLength(2);
    for (const statement of matches) {
      expect(statement).toMatch(/delete from public\.listing_vehicle_details as lvd where lvd\.listing_id = p_listing_id/);
    }
  });

  it("all listing_rental_details DELETE listing_id references are qualified via an explicit table alias (both the unconditional cleanup branch and the explicit-null-clear branch)", () => {
    const matches = body.match(/delete from public\.listing_rental_details[\s\S]{0,60}/g) ?? [];
    expect(matches).toHaveLength(2);
    for (const statement of matches) {
      expect(statement).toMatch(/delete from public\.listing_rental_details as lrd where lrd\.listing_id = p_listing_id/);
    }
  });

  it("exactly five aliased DELETE statements exist in total -- one fulfillment, two vehicle, two rental -- matching the exact ambiguity audit reported for this fix", () => {
    const aliasedDeletes = body.match(/delete from public\.listing_(fulfillment_methods as lfm|vehicle_details as lvd|rental_details as lrd) where \w+\.listing_id = p_listing_id/g) ?? [];
    expect(aliasedDeletes).toHaveLength(5);
  });

  it("INSERT column-lists and ON CONFLICT targets naming listing_id are left exactly as they were -- untouched catalog-lookup positions, never the source of the ambiguity", () => {
    expect(body).toMatch(/insert into public\.listing_fulfillment_methods \(listing_id, method\)/);
    expect(body).toMatch(/insert into public\.listing_vehicle_details \(\s*\n\s*listing_id, brand, model,/);
    expect(body).toMatch(/on conflict \(listing_id\) do update set\s*\n\s*brand = excluded\.brand/);
    expect(body).toMatch(/insert into public\.listing_rental_details \(\s*\n\s*listing_id, rental_price_cents,/);
    expect(body).toMatch(/on conflict \(listing_id\) do update set\s*\n\s*rental_price_cents = excluded\.rental_price_cents/);
  });
});

describe("0090 -- public signature and result shape are unchanged", () => {
  const source = stripComments(readFile(MIGRATION_PATH));

  it("keeps the exact existing public signature: update_listing(p_listing_id uuid, p_patch jsonb default '{}'::jsonb)", () => {
    expect(source).toMatch(
      /create or replace function public\.update_listing\(p_listing_id uuid, p_patch jsonb default '\{\}'::jsonb\)/,
    );
  });

  it("keeps the exact existing RETURNS TABLE shape (listing_id, public_code, slug, status, updated_at)", () => {
    expect(source).toMatch(
      /returns table \(\s*\n\s*listing_id uuid,\s*\n\s*public_code text,\s*\n\s*slug text,\s*\n\s*status public\.listing_status_enum,\s*\n\s*updated_at timestamptz\s*\n\s*\)/,
    );
  });

  it("keeps SECURITY DEFINER and search_path = '' unchanged", () => {
    expect(source).toMatch(/language plpgsql\s*\nsecurity definer\s*\nset search_path = ''/);
  });

  it("keeps the exact existing grants: revoked from public/anon, granted to authenticated only", () => {
    expect(source).toMatch(/revoke all on function public\.update_listing\(uuid, jsonb\) from public;/);
    expect(source).toMatch(/revoke all on function public\.update_listing\(uuid, jsonb\) from anon;/);
    expect(source).toMatch(/grant execute on function public\.update_listing\(uuid, jsonb\) to authenticated;/);
    expect(source).not.toMatch(/grant execute on function public\.update_listing\(uuid, jsonb\) to (anon|public)/);
  });
});

describe("0090 -- every business rule/check is preserved verbatim (only the five WHERE predicates changed)", () => {
  const source = stripComments(readFile(MIGRATION_PATH));
  const body = getFunctionBody(source);

  it("draft-only editing rule is unchanged", () => {
    expect(body).toMatch(/if v_listing_status <> 'draft' then/);
    expect(body).toMatch(/LISTING_NOT_DRAFT/);
  });

  it("auth/ownership/deleted-account/restriction checks are all unchanged", () => {
    expect(body).toMatch(/v_caller := auth\.uid\(\);/);
    expect(body).toMatch(/NOT_AUTHENTICATED/);
    expect(body).toMatch(/select p\.deleted_at into v_caller_deleted_at/);
    expect(body).toMatch(/INTERACTION_BLOCKED/);
    expect(body).toMatch(/if v_listing_shop_id <> v_shop_id then/);
    expect(body).toMatch(/NOT_LISTING_OWNER/);
    expect(body).toMatch(/restriction_type in \('seller_suspended', 'account_suspended'\)/);
  });

  it("every existing error code is still present, unchanged, and no new one was introduced", () => {
    const expectedCodes = [
      "NOT_AUTHENTICATED", "INTERACTION_BLOCKED", "SHOP_NOT_FOUND", "LISTING_NOT_FOUND", "NOT_LISTING_OWNER",
      "LISTING_NOT_DRAFT", "PATCH_INVALID", "TITLE_REQUIRED", "DESCRIPTION_INVALID", "CATEGORY_INVALID",
      "CATEGORY_NOT_FOUND", "LISTING_TYPE_INVALID", "CONDITION_INVALID", "LISTING_TYPE_CONDITION_MISMATCH",
      "KNOWN_FLAWS_INVALID", "KNOWN_FLAWS_REQUIRED", "PRICE_INVALID", "ORIGINAL_PRICE_INVALID",
      "IS_NEGOTIABLE_INVALID", "STOCK_QUANTITY_INVALID", "PROVINCE_INVALID", "CITY_INVALID", "BARANGAY_INVALID",
      "CITY_REQUIRES_PROVINCE", "BARANGAY_REQUIRES_CITY", "INVALID_CITY_FOR_PROVINCE", "INVALID_BARANGAY_FOR_CITY",
      "BRAND_INVALID", "MEETUP_NOTE_INVALID", "FULFILLMENT_INVALID", "VEHICLE_DETAILS_NOT_ALLOWED",
      "VEHICLE_DETAILS_INVALID", "RENTAL_DETAILS_NOT_ALLOWED", "RENTAL_DETAILS_INVALID",
    ];
    for (const code of expectedCodes) {
      expect(body).toMatch(new RegExp(code));
    }
  });

  it("fulfillment replacement/cleanup behavior is unchanged: whole-set replace only when the key is present, delete-then-insert, empty array clears it", () => {
    expect(body).toMatch(/if v_patch \? 'fulfillment_methods' then/);
    const deleteIndex = body.indexOf("delete from public.listing_fulfillment_methods as lfm");
    const insertIndex = body.indexOf("insert into public.listing_fulfillment_methods (listing_id, method)");
    expect(deleteIndex).toBeGreaterThan(-1);
    expect(insertIndex).toBeGreaterThan(deleteIndex);
    expect(body).toMatch(/if v_fulfillment_count > 0 then\s*\n\s*insert into public\.listing_fulfillment_methods/);
  });

  it("vehicle/rental cleanup behavior is unchanged: dropped unconditionally when the final category no longer supports them, and on an explicit JSON null", () => {
    expect(body).toMatch(/if not v_final_is_vehicle_category then\s*\n\s*delete from public\.listing_vehicle_details as lvd/);
    expect(body).toMatch(/if not v_final_is_rental_category then\s*\n\s*delete from public\.listing_rental_details as lrd/);
    expect(body).toMatch(/if jsonb_typeof\(v_vehicle_patch\) = 'null' then\s*\n\s*delete from public\.listing_vehicle_details as lvd/);
    expect(body).toMatch(/if jsonb_typeof\(v_rental_patch\) = 'null' then\s*\n\s*delete from public\.listing_rental_details as lrd/);
  });

  it("vehicle/rental upsert (on conflict) behavior, and the category-eligibility gates, are unchanged", () => {
    expect(body).toMatch(/VEHICLE_DETAILS_NOT_ALLOWED/);
    expect(body).toMatch(/RENTAL_DETAILS_NOT_ALLOWED/);
    expect(body).toMatch(/on conflict \(listing_id\) do update set/);
  });

  it("location cascade logic (province/city/barangay) is unchanged", () => {
    expect(body).toMatch(/CITY_REQUIRES_PROVINCE/);
    expect(body).toMatch(/BARANGAY_REQUIRES_CITY/);
    expect(body).toMatch(/INVALID_CITY_FOR_PROVINCE/);
    expect(body).toMatch(/INVALID_BARANGAY_FOR_CITY/);
  });

  it("the listings row lock (for update) and the final UPDATE statement's own column list are unchanged", () => {
    expect(body).toMatch(/from public\.listings l\s*\n\s*where l\.id = p_listing_id\s*\n\s*for update;/);
    expect(body).toMatch(/update public\.listings as l\s*\n\s*set title = v_final_title,/);
    expect(body).toMatch(/where l\.id = p_listing_id\s*\n\s*returning l\.updated_at into v_updated_at;/);
  });
});
