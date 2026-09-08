import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

function readFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf-8");
}

const MIGRATION_PATH = "supabase/migrations/0057_publish_listing_rpc.sql";

/** The function body only. */
function getFunctionBody(source: string): string {
  const start = source.indexOf("begin\n");
  const end = source.indexOf("end;\n$$;");
  return source.slice(start, end);
}

describe("0057 is scoped to publish_listing only", () => {
  const source = readFile(MIGRATION_PATH);

  it("creates exactly one function, publish_listing -- no schema/enum/policy change", () => {
    expect(source).toMatch(/create or replace function public\.publish_listing\s*\(/);
    expect(source).not.toMatch(/create table|alter table|drop table/i);
    expect(source).not.toMatch(/create type|alter type/i);
    expect(source).not.toMatch(/create policy|alter policy|drop policy|create index|drop index/i);
    expect(source).not.toMatch(/create or replace function public\.update_listing/i);
    expect(source).not.toMatch(/create or replace function public\.(pause|resume|archive)_listing/i);
  });

  it("takes exactly one parameter, p_listing_id -- no client-supplied status/shop/owner identity or any listing field", () => {
    const signature = source.slice(source.indexOf("create or replace function public.publish_listing("), source.indexOf("returns table"));
    expect(signature).toMatch(/p_listing_id uuid/);
    expect(signature).not.toMatch(/p_status|p_shop_id|p_owner_id|p_title|p_price/);
  });

  it("never references orders/order_items/inventory_reservations", () => {
    expect(source).not.toMatch(/\bpublic\.orders\b/);
    expect(source).not.toMatch(/\bpublic\.order_items\b/);
    expect(source).not.toMatch(/\bpublic\.inventory_reservations\b/);
  });

  it("never writes reserved_quantity -- inventory is not touched by publishing", () => {
    expect(getFunctionBody(source)).not.toMatch(/reserved_quantity/);
  });

  it("is SECURITY DEFINER with an empty search_path, granted to authenticated only", () => {
    expect(source).toMatch(/security definer/i);
    expect(source).toMatch(/set search_path = ''/);
    expect(source).toMatch(/revoke all on function public\.publish_listing\(uuid\) from public/i);
    expect(source).toMatch(/revoke all on function public\.publish_listing\(uuid\) from anon/i);
    expect(source).toMatch(/grant execute on function public\.publish_listing\(uuid\) to authenticated/i);
    expect(source).not.toMatch(/grant execute on function public\.publish_listing\(uuid\) to anon/i);
  });

  it("locks the listing row FOR UPDATE as the universal serialization point (prevents double-publish race)", () => {
    expect(source).toMatch(/from public\.listings l\s*\n\s*where l\.id = p_listing_id\s*\n\s*for update;/);
  });
});

describe("0057 auth / ownership / draft-only gating", () => {
  const source = readFile(MIGRATION_PATH);

  it("requires auth.uid() (NOT_AUTHENTICATED)", () => {
    expect(source).toMatch(/v_caller := auth\.uid\(\);/);
    expect(source).toMatch(/'Authentication required\.' using detail = 'NOT_AUTHENTICATED'/);
  });

  it("resolves the caller's own shop via owner_id = auth.uid()", () => {
    expect(source).toMatch(/where s\.owner_id = v_caller/);
    expect(source).toMatch(/'Create your shop first\.' using detail = 'SHOP_NOT_FOUND'/);
  });

  it("distinguishes listing-not-found from not-your-listing, mirroring update_review's own two-code ownership pattern", () => {
    expect(source).toMatch(/'Listing not found\.' using detail = 'LISTING_NOT_FOUND'/);
    expect(source).toMatch(/if v_listing_shop_id <> v_shop_id then\s*\n\s*raise exception 'You do not have permission to publish this listing\.' using detail = 'NOT_LISTING_OWNER';/);
  });

  it("rejects publishing anything that is not currently draft", () => {
    expect(source).toMatch(/if v_listing_status <> 'draft' then\s*\n\s*raise exception 'Only draft listings can be published\.' using detail = 'LISTING_NOT_DRAFT';/);
  });

  it("blocks seller_suspended/account_suspended (not buyer_restricted), same pattern as create_listing", () => {
    const restrictionBlock = source.slice(source.indexOf("seller admin restrictions"), source.indexOf("lock the listing row"));
    expect(restrictionBlock).toMatch(/restriction_type in \('seller_suspended', 'account_suspended'\)/);
    expect(restrictionBlock).not.toMatch(/buyer_restricted/);
    expect(restrictionBlock).toMatch(/INTERACTION_BLOCKED/);
  });

  it("never reads or gates on shops.status (Away is not treated as suspension)", () => {
    const body = getFunctionBody(source);
    expect(body).not.toMatch(/shop_status_enum|s\.status|\.status = 'away'|'active'/);
  });
});

describe("0057 publish completeness validation", () => {
  const source = readFile(MIGRATION_PATH);

  it("rejects a blank/missing title (defensive -- structurally unreachable today, still checked)", () => {
    expect(source).toMatch(/if v_title is null or v_title !~ '\[\^\[:space:\]\]' then\s*\n\s*raise exception 'Listing title is required\.' using detail = 'TITLE_REQUIRED';/);
  });

  it("rejects a missing description", () => {
    expect(source).toMatch(/if v_description is null then\s*\n\s*raise exception 'Listing description is required to publish\.' using detail = 'DESCRIPTION_REQUIRED';/);
  });

  it("rejects a missing category", () => {
    expect(source).toMatch(/if v_category_id is null then\s*\n\s*raise exception 'Category is required to publish\.' using detail = 'CATEGORY_REQUIRED';/);
  });

  it("rejects a missing listing type or condition", () => {
    expect(source).toMatch(/'Listing type is required to publish\.' using detail = 'LISTING_TYPE_REQUIRED'/);
    expect(source).toMatch(/'Condition is required to publish\.' using detail = 'CONDITION_REQUIRED'/);
  });

  it("cross-validates listing type / condition unconditionally (both are already guaranteed non-null by this point)", () => {
    expect(source).toMatch(/if v_listing_type = 'brand_new' and v_condition <> 'brand_new' then/);
    expect(source).toMatch(/if v_listing_type = 'preloved' and v_condition = 'brand_new' then/);
    expect(source).toMatch(/LISTING_TYPE_CONDITION_MISMATCH/);
  });

  it("requires known_flaws when condition is Fair", () => {
    expect(source).toMatch(/if v_condition = 'fair' and \(v_known_flaws is null or v_known_flaws !~ '\[\^\[:space:\]\]'\) then/);
    expect(source).toMatch(/KNOWN_FLAWS_REQUIRED/);
  });

  it("rejects a missing price -- but does not re-reject a valid zero price (PRICE_REQUIRED checks null only, not < 0)", () => {
    expect(source).toMatch(/if v_price_cents is null then\s*\n\s*raise exception 'Price is required to publish\.' using detail = 'PRICE_REQUIRED';/);
    expect(source).not.toMatch(/v_price_cents < 0/);
  });

  it("requires stock quantity >= 1 (defensive -- structurally already guaranteed by the column default + CHECK)", () => {
    expect(source).toMatch(/if v_stock_quantity is null or v_stock_quantity < 1 then/);
    expect(source).toMatch(/STOCK_QUANTITY_INVALID/);
  });

  it("requires province and city", () => {
    expect(source).toMatch(/'Province is required to publish\.' using detail = 'PROVINCE_REQUIRED'/);
    expect(source).toMatch(/'City\/municipality is required to publish\.' using detail = 'CITY_REQUIRED'/);
  });

  it("does not re-validate barangay-belongs-to-city or city-belongs-to-province -- already guaranteed by create_listing's own insert-time validation with no update path to drift it", () => {
    expect(source).not.toMatch(/INVALID_CITY_FOR_PROVINCE/);
    expect(source).not.toMatch(/INVALID_BARANGAY_FOR_CITY/);
  });
});

describe("0057 fulfillment method requirement, gated on inquiry-only category", () => {
  const source = readFile(MIGRATION_PATH);

  it("resolves inquiry-only eligibility from categories.is_inquiry_only, not a hardcoded category list", () => {
    expect(source).toMatch(/select c\.is_inquiry_only into v_category_is_inquiry_only/);
  });

  it("requires at least one fulfillment method only when the category is not inquiry-only", () => {
    expect(source).toMatch(/if not coalesce\(v_category_is_inquiry_only, false\) and v_fulfillment_count = 0 then/);
    expect(source).toMatch(/'At least one fulfillment method is required to publish\.' using detail = 'FULFILLMENT_REQUIRED'/);
  });
});

describe("0057 image rules at publish", () => {
  const source = readFile(MIGRATION_PATH);
  const imageBlock = source.slice(source.indexOf("images: 1-8 total"), source.indexOf("transition: draft"));

  it("requires at least 1 image total", () => {
    expect(imageBlock).toMatch(/if v_total_image_count = 0 then\s*\n\s*raise exception 'At least one photo is required to publish\.' using detail = 'IMAGE_REQUIRED';/);
  });

  it("rejects more than 8 images (integrity check -- not reachable via create_listing alone today, but not schema-enforced either)", () => {
    expect(imageBlock).toMatch(/if v_total_image_count > 8 then\s*\n\s*raise exception 'A listing may have at most 8 photos\.' using detail = 'TOO_MANY_LISTING_IMAGES';/);
  });

  it("counts actual vs reference images via the real is_reference_image column, not a hardcoded assumption", () => {
    expect(imageBlock).toMatch(/count\(\*\) filter \(where not li\.is_reference_image\)/);
    expect(imageBlock).toMatch(/count\(\*\) filter \(where li\.is_reference_image\)/);
  });

  it("rejects Pre-loved listings that have any reference image", () => {
    expect(imageBlock).toMatch(/if v_listing_type = 'preloved' and v_reference_image_count > 0 then/);
    expect(imageBlock).toMatch(/REFERENCE_IMAGES_NOT_ALLOWED_FOR_PRELOVED/);
  });

  it("requires Brand New listings to have at least one actual-item photo (reference/catalog images may additionally exist)", () => {
    expect(imageBlock).toMatch(/if v_listing_type = 'brand_new' and v_actual_image_count = 0 then/);
    expect(imageBlock).toMatch(/BRAND_NEW_REQUIRES_ACTUAL_IMAGE/);
  });

  it("never introduces a new image-schema field -- only reads the existing is_reference_image column", () => {
    expect(source).not.toMatch(/add column|create table.*image/i);
  });
});

describe("0057 vehicle/rental: no additional validation, matching their fully-optional canon", () => {
  const source = readFile(MIGRATION_PATH);

  it("never references listing_vehicle_details or listing_rental_details -- their own CHECK constraints already guarantee validity of whatever is stored, and their existence is never required", () => {
    const body = getFunctionBody(source);
    expect(body).not.toMatch(/listing_vehicle_details/);
    expect(body).not.toMatch(/listing_rental_details/);
  });
});

describe("0057 state transition: draft -> available only after every check passes", () => {
  const source = readFile(MIGRATION_PATH);

  it("the UPDATE to status = 'available' is the last write in the function, after every validation branch", () => {
    const updateIndex = source.indexOf("set status = 'available'");
    const lastRaiseIndex = source.lastIndexOf("raise exception");
    expect(updateIndex).toBeGreaterThan(lastRaiseIndex);
  });

  it("sets published_at to the transaction-stable now(), computed once", () => {
    expect(source).toMatch(/v_now := now\(\);/);
    expect(source).toMatch(/published_at = v_now/);
  });

  it("returns useful listing identifiers/state: listing_id, public_code, slug, status, published_at", () => {
    expect(source).toMatch(/select p_listing_id, v_public_code, v_slug, 'available'::public\.listing_status_enum, v_now;/);
  });

  it("any validation failure raises before the UPDATE statement is reached -- the whole call is one transaction, so a rejected publish leaves the listing untouched", () => {
    const body = getFunctionBody(source);
    expect(body).not.toMatch(/\bcommit\b/i);
  });
});
