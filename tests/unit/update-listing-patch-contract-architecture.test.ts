import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

function readFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf-8");
}

const MIGRATION_PATH = "supabase/migrations/0061_update_listing_patch_contract.sql";

/** The function body only. */
function getFunctionBody(source: string): string {
  const start = source.indexOf("begin\n");
  const end = source.indexOf("end;\n$$;");
  return source.slice(start, end);
}

/** The new function's own parameter-list block only (after the DROP FUNCTION statement). */
function getParameterListBlock(source: string): string {
  const start = source.indexOf("create or replace function public.update_listing(");
  const end = source.indexOf("returns table", start);
  return source.slice(start, end);
}

describe("0061 supersedes update_listing with a clean, single JSONB patch contract", () => {
  const source = readFile(MIGRATION_PATH);

  it("drops 0059's exact original 19-parameter signature before creating the new one", () => {
    expect(source).toMatch(
      /drop function if exists public\.update_listing\(\s*\n\s*uuid, text, text, integer, public\.listing_type_enum, public\.listing_condition_enum, bigint, bigint, boolean,\s*\n\s*text, text, integer, integer, integer, integer, text, public\.fulfillment_method_enum\[\], jsonb, jsonb\s*\n\s*\);/,
    );
  });

  it("creates exactly one update_listing overload, taking only (p_listing_id uuid, p_patch jsonb)", () => {
    const params = getParameterListBlock(source);
    expect(params).toMatch(/p_listing_id uuid,\s*\n\s*p_patch jsonb default '\{\}'::jsonb/);
  });

  it("does not modify replace_listing_images or 0060 in any way -- the header discusses it (inspection was done), but no code in this file creates, replaces, or drops it", () => {
    expect(source).not.toMatch(/create or replace function public\.replace_listing_images/);
    expect(source).not.toMatch(/drop function.*replace_listing_images/);
    expect(source).not.toMatch(/create or replace function public\.publish_listing\b/);
  });

  it("never accepts owner_id/shop_id/public_code/status/cover_image_id -- there is no key surface for them at all", () => {
    const body = getFunctionBody(source);
    expect(body).not.toMatch(/p_owner_id|p_shop_id|p_public_code|p_status|p_cover_image_id/);
    expect(body).not.toMatch(/cover_image_id/);
  });

  it("never references orders/order_items/inventory_reservations/snapshots", () => {
    expect(source).not.toMatch(/\bpublic\.orders\b/);
    expect(source).not.toMatch(/\bpublic\.order_items\b/);
    expect(source).not.toMatch(/\bpublic\.inventory_reservations\b/);
    expect(source).not.toMatch(/\bsnapshot\b/i);
  });

  it("is SECURITY DEFINER with an empty search_path, granted to authenticated only", () => {
    expect(source).toMatch(/security definer/i);
    expect(source).toMatch(/set search_path = ''/);
    expect(source).toMatch(/revoke all on function public\.update_listing\(uuid, jsonb\) from public/i);
    expect(source).toMatch(/revoke all on function public\.update_listing\(uuid, jsonb\) from anon/i);
    expect(source).toMatch(/grant execute on function public\.update_listing\(uuid, jsonb\) to authenticated/i);
    expect(source).not.toMatch(/to anon;/);
  });

  it("locks the listing row FOR UPDATE as the universal serialization point, before the patch is even validated", () => {
    const body = getFunctionBody(source);
    expect(body).toMatch(/from public\.listings l\s*\n\s*where l\.id = p_listing_id\s*\n\s*for update;/);
    const lockIndex = body.indexOf("for update;");
    const patchGuardIndex = body.indexOf("jsonb_typeof(v_patch) <> 'object'");
    expect(patchGuardIndex).toBeGreaterThan(lockIndex);
  });
});

describe("0061 preserves auth / ownership / draft-only gating unchanged", () => {
  const source = readFile(MIGRATION_PATH);

  it("requires auth.uid() (NOT_AUTHENTICATED)", () => {
    expect(source).toMatch(/v_caller := auth\.uid\(\);/);
    expect(source).toMatch(/'Authentication required\.' using detail = 'NOT_AUTHENTICATED'/);
  });

  it("resolves the caller's own shop via owner_id = auth.uid()", () => {
    expect(source).toMatch(/where s\.owner_id = v_caller/);
    expect(source).toMatch(/'Create your shop first\.' using detail = 'SHOP_NOT_FOUND'/);
  });

  it("distinguishes listing-not-found from not-your-listing", () => {
    expect(source).toMatch(/'Listing not found\.' using detail = 'LISTING_NOT_FOUND'/);
    expect(source).toMatch(/'You do not have permission to edit this listing\.' using detail = 'NOT_LISTING_OWNER'/);
  });

  it("blocks seller_suspended/account_suspended (not buyer_restricted)", () => {
    const restrictionBlock = source.slice(source.indexOf("seller admin restrictions"), source.indexOf("lock the listing row"));
    expect(restrictionBlock).toMatch(/restriction_type in \('seller_suspended', 'account_suspended'\)/);
    expect(restrictionBlock).not.toMatch(/buyer_restricted/);
    expect(restrictionBlock).toMatch(/INTERACTION_BLOCKED/);
  });

  it("rejects editing anything that is not currently draft", () => {
    expect(source).toMatch(/if v_listing_status <> 'draft' then\s*\n\s*raise exception 'Only draft listings can be edited with this operation\.' using detail = 'LISTING_NOT_DRAFT';/);
  });
});

describe("0061 three-way patch semantics: omitted / explicit null / supplied", () => {
  const source = readFile(MIGRATION_PATH);

  it("guards that the patch itself must be a JSON object", () => {
    expect(source).toMatch(/v_patch := coalesce\(p_patch, '\{\}'::jsonb\);/);
    expect(source).toMatch(/if jsonb_typeof\(v_patch\) <> 'object' then\s*\n\s*raise exception 'Patch must be a JSON object\.' using detail = 'PATCH_INVALID';/);
  });

  it("uses jsonb_typeof(...) = 'null' to detect an explicit JSON null, never a bare IS NULL check on the extracted value", () => {
    // a jsonb value produced by `-> 'field'` for a JSON null is never SQL
    // NULL, so `IS NULL` would never fire; every clearable field must use
    // jsonb_typeof(...) = 'null' instead.
    const clearableFields = [
      "description", "category_id", "listing_type", "condition", "known_flaws",
      "price_cents", "original_price_cents", "province_id", "city_id", "barangay_id",
      "brand", "meetup_note",
    ];
    for (const field of clearableFields) {
      expect(source).toMatch(new RegExp(`jsonb_typeof\\(v_patch -> '${field}'\\) = 'null'`));
    }
  });

  it("every omitted-field branch falls back to the existing stored value read from the locked row", () => {
    const body = getFunctionBody(source);
    expect(body).toMatch(/v_final_description := v_description;/);
    expect(body).toMatch(/v_final_category_id := v_category_id;/);
    expect(body).toMatch(/v_final_listing_type := v_listing_type;/);
    expect(body).toMatch(/v_final_condition := v_condition;/);
    expect(body).toMatch(/v_final_known_flaws := v_known_flaws;/);
    expect(body).toMatch(/v_final_price_cents := v_price_cents;/);
    expect(body).toMatch(/v_final_original_price_cents := v_original_price_cents;/);
    expect(body).toMatch(/v_final_brand := v_brand;/);
    expect(body).toMatch(/v_final_meetup_note := v_meetup_note;/);
  });
});

describe("0061 title: never clearable, must remain non-blank", () => {
  const source = readFile(MIGRATION_PATH);

  it("a 'title' key with JSON null is rejected with TITLE_REQUIRED, not treated as a clear", () => {
    const titleBlock = source.slice(source.indexOf("title: never clearable"), source.indexOf("description: nullable while draft"));
    expect(titleBlock).not.toMatch(/jsonb_typeof\(v_patch -> 'title'\) = 'null'/);
    expect(titleBlock).toMatch(/if jsonb_typeof\(v_patch -> 'title'\) <> 'string' then\s*\n\s*raise exception 'Listing title is required\.' using detail = 'TITLE_REQUIRED';/);
  });

  it("a blank/whitespace-only supplied title is still rejected with TITLE_REQUIRED", () => {
    expect(source).toMatch(/v_final_title := nullif\(btrim\(v_patch ->> 'title'\), ''\);\s*\n\s*if v_final_title is null then\s*\n\s*raise exception 'Listing title is required\.' using detail = 'TITLE_REQUIRED';/);
  });

  it("omitted title preserves the existing value", () => {
    expect(source).toMatch(/else\s*\n\s*v_final_title := v_title;\s*\n\s*end if;/);
  });
});

describe("0061 stock_quantity: never clearable, must remain >= 1", () => {
  const source = readFile(MIGRATION_PATH);

  it("a 'stock_quantity' key with JSON null is rejected, not treated as a clear", () => {
    const stockBlock = source.slice(source.indexOf("stock quantity: cannot be cleared"), source.indexOf("location: each level nullable"));
    expect(stockBlock).not.toMatch(/= 'null'/);
    expect(stockBlock).toMatch(/if jsonb_typeof\(v_patch -> 'stock_quantity'\) <> 'number' then\s*\n\s*raise exception 'Stock quantity must be at least 1\.' using detail = 'STOCK_QUANTITY_INVALID';/);
  });

  it("the final stock quantity must still be >= 1 regardless of source", () => {
    expect(source).toMatch(/if v_final_stock_quantity is null or v_final_stock_quantity < 1 then\s*\n\s*raise exception 'Stock quantity must be at least 1\.' using detail = 'STOCK_QUANTITY_INVALID';/);
  });
});

describe("0061 is_negotiable: NOT NULL column, cannot be cleared", () => {
  const source = readFile(MIGRATION_PATH);

  it("a JSON null for is_negotiable is rejected rather than silently accepted", () => {
    const block = source.slice(source.indexOf("is_negotiable: NOT NULL column"), source.indexOf("stock quantity: cannot be cleared"));
    expect(block).not.toMatch(/= 'null'/);
    expect(block).toMatch(/if jsonb_typeof\(v_patch -> 'is_negotiable'\) <> 'boolean' then\s*\n\s*raise exception 'Negotiable flag is invalid\.' using detail = 'IS_NEGOTIABLE_INVALID';/);
  });
});

describe("0061 category/type/condition/price/original_price can return to null", () => {
  const source = readFile(MIGRATION_PATH);

  it("category_id clears to null on explicit JSON null, and vehicle/rental eligibility both become false", () => {
    expect(source).toMatch(/if jsonb_typeof\(v_patch -> 'category_id'\) = 'null' then\s*\n\s*v_final_category_id := null;/);
    expect(source).toMatch(/v_final_is_vehicle_category := false;\s*\n\s*v_final_is_rental_category := false;/);
  });

  it("listing_type and condition each clear to null on explicit JSON null", () => {
    expect(source).toMatch(/if jsonb_typeof\(v_patch -> 'listing_type'\) = 'null' then\s*\n\s*v_final_listing_type := null;/);
    expect(source).toMatch(/if jsonb_typeof\(v_patch -> 'condition'\) = 'null' then\s*\n\s*v_final_condition := null;/);
  });

  it("cross-validation only fires when both final type and condition are non-null -- a cleared field cannot trigger a mismatch error", () => {
    expect(source).toMatch(/if v_final_listing_type is not null and v_final_condition is not null then/);
  });

  it("price_cents and original_price_cents each clear to null on explicit JSON null", () => {
    expect(source).toMatch(/if jsonb_typeof\(v_patch -> 'price_cents'\) = 'null' then\s*\n\s*v_final_price_cents := null;/);
    expect(source).toMatch(/if jsonb_typeof\(v_patch -> 'original_price_cents'\) = 'null' then\s*\n\s*v_final_original_price_cents := null;/);
  });

  it("original-price-vs-price validation only fires when both are non-null -- clearing either side cannot trigger a false mismatch", () => {
    expect(source).toMatch(/if v_final_original_price_cents is not null and v_final_price_cents is not null\s*\n\s*and v_final_original_price_cents < v_final_price_cents then/);
  });

  it("Fair-requires-known_flaws is evaluated on the final merged condition/known_flaws, so clearing condition away from Fair lifts the requirement", () => {
    expect(source).toMatch(/if v_final_condition = 'fair' and v_final_known_flaws is null then\s*\n\s*raise exception 'Known flaws are required for Fair condition\.' using detail = 'KNOWN_FLAWS_REQUIRED';/);
  });
});

describe("0061 location clearing: barangay-alone, city-cascades-barangay, province-cascades-both", () => {
  const source = readFile(MIGRATION_PATH);

  it("province_id resolves independently first (no cascade applied to it)", () => {
    expect(source).toMatch(/if v_patch \? 'province_id' then\s*\n\s*if jsonb_typeof\(v_patch -> 'province_id'\) = 'null' then\s*\n\s*v_final_province_id := null;/);
  });

  it("city_id cascades to null when province ends up null AND the patch did not itself touch city_id", () => {
    const cityBlock = source.slice(source.indexOf("if v_patch ? 'city_id' then"), source.indexOf("if v_patch ? 'barangay_id' then"));
    expect(cityBlock).toMatch(/else\s*\n\s*v_final_city_id := v_city_id;\s*\n\s*-- cascade: province was cleared and the caller did not itself touch city_id\s*\n\s*if v_final_province_id is null then\s*\n\s*v_final_city_id := null;/);
  });

  it("barangay_id cascades to null when the (possibly cascaded) final city ends up null AND the patch did not itself touch barangay_id", () => {
    const barangayBlock = source.slice(source.indexOf("if v_patch ? 'barangay_id' then"), source.indexOf("if v_final_city_id is not null and v_final_province_id is null then"));
    expect(barangayBlock).toMatch(/else\s*\n\s*v_final_barangay_id := v_barangay_id;\s*\n\s*-- cascade: city ended up null[\s\S]*?if v_final_city_id is null then\s*\n\s*v_final_barangay_id := null;/);
  });

  it("clearing barangay alone (province/city untouched) never raises BARANGAY_REQUIRES_CITY -- the check only fires when barangay is non-null", () => {
    expect(source).toMatch(/if v_final_barangay_id is not null and v_final_city_id is null then\s*\n\s*raise exception 'Barangay requires city to also be specified\.' using detail = 'BARANGAY_REQUIRES_CITY';/);
  });

  it("an explicit city_id supplied in the same call as clearing province is still rejected -- the cascade never overrides a field the patch itself touched", () => {
    // the city_id branch only applies the province-cascade inside its own
    // "else" (patch did not include city_id) -- when the patch DOES include
    // city_id, that branch is skipped entirely, so the existing
    // CITY_REQUIRES_PROVINCE check still fires for a genuine contradiction.
    expect(source).toMatch(/if v_final_city_id is not null and v_final_province_id is null then\s*\n\s*raise exception 'City requires province to also be specified\.' using detail = 'CITY_REQUIRES_PROVINCE';/);
  });

  it("still validates city-belongs-to-province and barangay-belongs-to-city against real FK data on the final resolved trio", () => {
    expect(source).toMatch(/'Selected city does not belong to the selected province\.' using detail = 'INVALID_CITY_FOR_PROVINCE'/);
    expect(source).toMatch(/'Selected barangay does not belong to the selected city\.' using detail = 'INVALID_BARANGAY_FOR_CITY'/);
  });
});

describe("0061 fulfillment methods: omitted preserves, supplied (incl. empty) replaces", () => {
  const source = readFile(MIGRATION_PATH);

  it("omitted fulfillment_methods key leaves the existing set completely untouched", () => {
    expect(source).toMatch(/if v_patch \? 'fulfillment_methods' then/);
    expect(source).toMatch(/v_fulfillment_touched := true;\s*\n\s*else\s*\n\s*v_fulfillment_touched := false;/);
  });

  it("an explicit empty array clears all methods -- the delete always runs when the key was touched, the insert only when the resulting count is > 0", () => {
    expect(source).toMatch(/if v_fulfillment_touched then/);
    expect(source).toMatch(/delete from public\.listing_fulfillment_methods where listing_id = p_listing_id;/);
    expect(source).toMatch(/if v_fulfillment_count > 0 then\s*\n\s*insert into public\.listing_fulfillment_methods/);
  });

  it("validates the array's element values via membership check before casting to the enum, and rejects duplicates", () => {
    expect(source).toMatch(/where m not in \('meetup', 'pickup', 'local_delivery', 'shipping'\)/);
    expect(source).toMatch(/FULFILLMENT_INVALID/);
    expect(source).toMatch(/v_fulfillment_count <> \(select count\(distinct m\) from unnest\(v_final_fulfillment_methods\) m\)/);
  });

  it("rejects a non-array value for fulfillment_methods, including a bare JSON null", () => {
    expect(source).toMatch(/if jsonb_typeof\(v_patch -> 'fulfillment_methods'\) <> 'array' then\s*\n\s*raise exception 'Fulfillment methods must be a list\.' using detail = 'FULFILLMENT_INVALID';/);
  });
});

describe("0061 vehicle/rental: omitted preserves, explicit null deletes, object validates+upserts", () => {
  const source = readFile(MIGRATION_PATH);

  it("vehicle_details omitted leaves any existing row completely untouched (no delete, no upsert) beyond the category-driven cleanup", () => {
    expect(source).toMatch(/if v_patch \? 'vehicle_details' then/);
  });

  it("vehicle_details explicit JSON null deletes the extension row outright, unconditional on category eligibility", () => {
    expect(source).toMatch(/if jsonb_typeof\(v_vehicle_patch\) = 'null' then\s*\n\s*delete from public\.listing_vehicle_details where listing_id = p_listing_id;/);
  });

  it("rental_details explicit JSON null deletes the extension row outright", () => {
    expect(source).toMatch(/if jsonb_typeof\(v_rental_patch\) = 'null' then\s*\n\s*delete from public\.listing_rental_details where listing_id = p_listing_id;/);
  });

  it("vehicle_details supplied as an object is validated against the FINAL category and upserted via ON CONFLICT (listing_id)", () => {
    expect(source).toMatch(/if not v_final_is_vehicle_category then\s*\n\s*raise exception 'Vehicle details are only allowed for Cars\/Motorcycles listings\.' using detail = 'VEHICLE_DETAILS_NOT_ALLOWED';/);
    expect(source).toMatch(/insert into public\.listing_vehicle_details \(([\s\S]*?)\)\s*\n\s*values \(([\s\S]*?)\)\s*\n\s*on conflict \(listing_id\) do update set/);
  });

  it("rental_details supplied as an object is validated against the FINAL category and upserted via ON CONFLICT (listing_id)", () => {
    expect(source).toMatch(/if not v_final_is_rental_category then\s*\n\s*raise exception 'Rental details are only allowed for For Rent listings\.' using detail = 'RENTAL_DETAILS_NOT_ALLOWED';/);
    expect(source).toMatch(/insert into public\.listing_rental_details \(([\s\S]*?)\)\s*\n\s*values \(([\s\S]*?)\)\s*\n\s*on conflict \(listing_id\) do update set/);
  });

  it("category-incompatible cleanup runs unconditionally, regardless of whether the patch touched vehicle_details/rental_details at all", () => {
    const body = getFunctionBody(source);
    const updateIndex = body.indexOf("update public.listings as l");
    const cleanupIndex = body.indexOf("if not v_final_is_vehicle_category then");
    const vehiclePatchIndex = body.indexOf("if v_patch ? 'vehicle_details' then");
    expect(cleanupIndex).toBeGreaterThan(updateIndex);
    expect(vehiclePatchIndex).toBeGreaterThan(cleanupIndex);
  });
});

describe("0061 final-state validation and atomicity/security are unchanged", () => {
  const source = readFile(MIGRATION_PATH);

  it("never writes public_code, and slug regenerates only when the final title differs from the stored title", () => {
    const updateBlock = source.slice(source.indexOf("update public.listings as l"), source.indexOf("where l.id = p_listing_id\n    returning"));
    expect(updateBlock).not.toMatch(/public_code\s*=/);
    expect(source).toMatch(/if v_final_title <> v_title then/);
    expect(source).toMatch(/else\s*\n\s*v_final_slug := v_slug;\s*\n\s*end if;/);
  });

  it("remains atomic: no explicit COMMIT anywhere in the function body", () => {
    const body = getFunctionBody(source);
    expect(body).not.toMatch(/\bcommit\b/i);
  });

  it("returns the listing's public_code, current (still draft) status, and the real updated_at from the RETURNING clause", () => {
    expect(source).toMatch(/returning l\.updated_at into v_updated_at;/);
    expect(source).toMatch(/select p_listing_id, v_public_code, v_final_slug, v_listing_status, v_updated_at;/);
  });
});
