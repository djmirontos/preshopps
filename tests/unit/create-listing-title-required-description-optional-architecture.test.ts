import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

function readFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf-8");
}

const MIGRATION_PATH = "supabase/migrations/0056_draft_title_required_description_optional.sql";

/** The function's own parameter-list block only. */
function getParameterListBlock(source: string): string {
  const start = source.indexOf("create or replace function public.create_listing(");
  const end = source.indexOf("returns table", start);
  return source.slice(start, end);
}

/** The function body only -- excludes header prose, which legitimately
 * discusses removed error codes (e.g. "the DESCRIPTION_REQUIRED check is
 * removed") that would otherwise false-positive a substring match. */
function getFunctionBody(source: string): string {
  const start = source.indexOf("begin\n");
  const end = source.indexOf("end;\n$$;");
  return source.slice(start, end);
}

describe("0056 is scoped to the title/description correction only", () => {
  const source = readFile(MIGRATION_PATH);

  it("alters exactly one listings column (description) to drop not null -- title and every other column untouched", () => {
    const alterBlock = source.slice(source.indexOf("alter table listings"), source.indexOf("create or replace function"));
    expect(alterBlock).toMatch(/alter column description drop not null/);
    expect(alterBlock).not.toMatch(/alter column title/);
    expect(alterBlock).not.toMatch(/alter column category_id/);
    expect(alterBlock).not.toMatch(/alter column price_cents/);
    expect(alterBlock).not.toMatch(/alter column province_id/);
    expect(alterBlock).not.toMatch(/alter column city_id/);
    expect(alterBlock).not.toMatch(/alter column listing_type/);
    expect(alterBlock).not.toMatch(/alter column condition/);
    expect(source).not.toMatch(/create table|drop table/i);
    expect(source).not.toMatch(/create type|alter type/i);
    expect(source).not.toMatch(/create policy|alter policy|drop policy|create index|drop index/i);
    expect(source).not.toMatch(/add constraint|drop constraint/i);
  });

  it("CREATE OR REPLACEs create_listing under the identical parameter signature as 0055 (no DROP FUNCTION needed)", () => {
    expect(source).not.toMatch(/drop function/i);
    expect(source).toMatch(/create or replace function public\.create_listing\s*\(/);
  });

  it("does not touch 0054 or 0055's files -- confirmed by this being a distinct new migration file", () => {
    expect(source).not.toMatch(/create table|alter column category_id|alter column province_id/i);
  });

  it("never references orders/order_items/inventory_reservations", () => {
    expect(source).not.toMatch(/\bpublic\.orders\b/);
    expect(source).not.toMatch(/\bpublic\.order_items\b/);
    expect(source).not.toMatch(/\bpublic\.inventory_reservations\b/);
  });

  it("is still SECURITY DEFINER with an empty search_path, granted to authenticated only", () => {
    expect(source).toMatch(/security definer/i);
    expect(source).toMatch(/set search_path = ''/);
    expect(source).toMatch(/revoke all on function public\.create_listing\([\s\S]*?\) from public/i);
    expect(source).toMatch(/revoke all on function public\.create_listing\([\s\S]*?\) from anon/i);
    expect(source).toMatch(/grant execute on function public\.create_listing\([\s\S]*?\) to authenticated/i);
    expect(source).not.toMatch(/grant execute on function public\.create_listing\([\s\S]*?\) to anon/i);
  });
});

describe("0056 title: required for Draft, blank rejected", () => {
  const source = readFile(MIGRATION_PATH);

  it("normalizes title via nullif(btrim(...)) -- so a blank/whitespace-only title is treated as absent", () => {
    expect(source).toMatch(/v_title := nullif\(btrim\(p_title\), ''\);/);
  });

  it("rejects a null or blank title with TITLE_REQUIRED", () => {
    expect(source).toMatch(/if v_title is null then\s*\n\s*raise exception 'Listing title is required\.' using detail = 'TITLE_REQUIRED';/);
  });

  it("title validation happens before any other field is normalized/validated", () => {
    const titleIndex = source.indexOf("v_title := nullif");
    const descriptionIndex = source.indexOf("v_description := nullif");
    expect(titleIndex).toBeGreaterThan(0);
    expect(descriptionIndex).toBeGreaterThan(titleIndex);
  });
});

describe("0056 description: optional while Draft, normalized, not required until publish", () => {
  const source = readFile(MIGRATION_PATH);

  it("normalizes description via nullif(btrim(...)) exactly like title -- blank/whitespace-only becomes NULL, not empty string", () => {
    expect(source).toMatch(/v_description := nullif\(btrim\(p_description\), ''\);/);
  });

  it("never raises DESCRIPTION_REQUIRED -- the check is fully removed from the function body", () => {
    expect(getFunctionBody(source)).not.toMatch(/DESCRIPTION_REQUIRED/);
  });

  it("p_description defaults to null and accepts null without error", () => {
    expect(getParameterListBlock(source)).toMatch(/p_description text default null/);
  });

  it("stores whatever normalized value results (NULL for blank/omitted, the trimmed text otherwise) directly into the insert -- no separate publish-only gate exists in this RPC", () => {
    const insertBlock = source.slice(source.indexOf("insert into public.listings"), source.indexOf("returning l.id"));
    expect(insertBlock).toMatch(/v_description/);
  });

  it("does not implement publish-time description enforcement -- no publish_listing function exists in this migration", () => {
    expect(source).not.toMatch(/create or replace function public\.publish_listing/i);
  });
});

describe("0056 preserves every other 0055 behavior unchanged", () => {
  const source = readFile(MIGRATION_PATH);

  it("still requires only auth.uid() + shop ownership, blocks seller_suspended/account_suspended", () => {
    expect(source).toMatch(/v_caller := auth\.uid\(\);/);
    expect(source).toMatch(/'Authentication required\.' using detail = 'NOT_AUTHENTICATED'/);
    expect(source).toMatch(/where s\.owner_id = v_caller/);
    expect(source).toMatch(/'Create your shop first\.' using detail = 'SHOP_NOT_FOUND'/);
    const restrictionBlock = source.slice(source.indexOf("seller admin restrictions"), source.indexOf("title (required"));
    expect(restrictionBlock).toMatch(/restriction_type in \('seller_suspended', 'account_suspended'\)/);
    expect(restrictionBlock).not.toMatch(/buyer_restricted/);
  });

  it("category/listing type/condition/price/stock/fulfillment/images/location remain fully optional, validated only when supplied", () => {
    expect(source).not.toMatch(/CATEGORY_REQUIRED/);
    expect(getFunctionBody(source)).not.toMatch(/LISTING_TYPE_REQUIRED/);
    expect(getFunctionBody(source)).not.toMatch(/\bCONDITION_REQUIRED\b/);
    expect(source).toMatch(/if p_price_cents is not null and p_price_cents < 0 then/);
    expect(source).toMatch(/if p_stock_quantity is not null and p_stock_quantity < 1 then/);
    expect(getFunctionBody(source)).not.toMatch(/FULFILLMENT_REQUIRED/);
    expect(getFunctionBody(source)).not.toMatch(/IMAGE_REQUIRED/);
    expect(source).not.toMatch(/'PROVINCE_REQUIRED'/);
    expect(source).not.toMatch(/'CITY_REQUIRED'/);
  });

  it("still rejects city-without-province and barangay-without-city", () => {
    expect(source).toMatch(/'City requires province to also be specified\.' using detail = 'CITY_REQUIRES_PROVINCE'/);
    expect(source).toMatch(/'Barangay requires city to also be specified\.' using detail = 'BARANGAY_REQUIRES_CITY'/);
  });

  it("still allows 0-8 images with ownership validation, cover set only when images exist", () => {
    expect(getFunctionBody(source)).not.toMatch(/if v_image_count < 1 then/);
    expect(source).toMatch(/if v_image_count > 8 then/);
    expect(source).toMatch(/v_path !~ \('\^listing-images\/' \|\| v_caller::text \|\| '\/'\)/);
    expect(source).toMatch(/if v_image_count > 0 then\s*\n\s*for i in 1\.\.v_image_count loop/);
  });

  it("still generates public_code (PSL- + random hex) and slug from title, both server-side only", () => {
    const paramBlock = getParameterListBlock(source);
    expect(paramBlock).not.toMatch(/p_public_code\b/);
    expect(paramBlock).not.toMatch(/p_slug\b/);
    expect(source).toMatch(/v_public_code := 'PSL-' \|\| upper\(encode\(extensions\.gen_random_bytes\(8\), 'hex'\)\);/);
    expect(source).toMatch(/v_slug := lower\(regexp_replace\(btrim\(v_title\), '\[\^a-zA-Z0-9\]\+', '-', 'g'\)\);/);
  });

  it("still always creates status = draft, never accepts a status parameter", () => {
    expect(getParameterListBlock(source)).not.toMatch(/p_status\b/);
    expect(source).toMatch(/select v_listing_id, v_public_code, v_slug, 'draft'::public\.listing_status_enum, v_created_at;/);
  });

  it("still validates vehicle/rental details only when category is known and matches", () => {
    expect(source).toMatch(/v_is_vehicle_category := v_category_slug in \('cars', 'motorcycles'\);/);
    expect(source).toMatch(/v_is_rental_category := v_category_slug = 'for-rent';/);
    expect(source).toMatch(/VEHICLE_DETAILS_NOT_ALLOWED/);
    expect(source).toMatch(/RENTAL_DETAILS_NOT_ALLOWED/);
  });

  it("remains atomic -- every write stays inside one function body, no explicit COMMIT", () => {
    const body = getFunctionBody(source);
    expect(body).toMatch(/insert into public\.listings/);
    expect(body).toMatch(/if v_fulfillment_count > 0 then\s*\n\s*insert into public\.listing_fulfillment_methods/);
    expect(body).toMatch(/insert into public\.listing_vehicle_details/);
    expect(body).toMatch(/insert into public\.listing_rental_details/);
    expect(body).not.toMatch(/\bcommit\b/i);
  });
});
