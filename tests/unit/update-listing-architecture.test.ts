// HISTORICAL / SUPERSEDED -- this file documents the structure of 0059, the
// original update_listing foundation, which used plain named parameters
// defaulting to NULL for every optional field. That design could not
// distinguish "field omitted" (preserve existing value) from "field
// explicitly cleared" (set NULL) -- both evaluated identically. PRD 10.6's
// "a Draft may be incomplete" was found to require the seller be able to
// un-set a field they set by mistake, not just fill one in, so 0059 was
// superseded: 0061_update_listing_patch_contract.sql DROPs 0059's exact
// original 19-parameter signature and CREATEs a single new update_listing
// (p_listing_id uuid, p_patch jsonb) as the sole live overload -- see
// tests/unit/update-listing-patch-contract-architecture.test.ts for its
// coverage. 0059's file itself is left byte-for-byte unmodified (this
// project's "never edit an already-applied migration" rule), and is kept
// here only as historical regression coverage confirming the OLD file's own
// structure hasn't drifted -- not that its no-clear-semantics design is
// still current, correct, or even still live (it is not: 0061 dropped this
// exact function signature).
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

function readFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf-8");
}

const MIGRATION_PATH = "supabase/migrations/0059_update_listing_rpc.sql";

/** The function body only -- excludes header prose, which legitimately
 * discusses field names/codes that would otherwise false-positive a
 * substring match against the header's own explanatory text. */
function getFunctionBody(source: string): string {
  const start = source.lastIndexOf("begin\n");
  const end = source.lastIndexOf("end;\n$$;");
  return source.slice(start, end);
}

/** The function's own parameter-list block only. */
function getParameterListBlock(source: string): string {
  const start = source.lastIndexOf("create or replace function public.update_listing(");
  const end = source.indexOf("returns table", start);
  return source.slice(start, end);
}

describe("0059 is scoped to update_listing only", () => {
  const source = readFile(MIGRATION_PATH);

  it("creates exactly one function, update_listing -- no schema/enum/policy change", () => {
    expect(source).toMatch(/create or replace function public\.update_listing\s*\(/);
    expect(source).not.toMatch(/create table|alter table|drop table/i);
    expect(source).not.toMatch(/create type|alter type/i);
    expect(source).not.toMatch(/create policy|alter policy|drop policy|create index|drop index/i);
    expect(source).not.toMatch(/create or replace function public\.replace_listing_images/i);
    expect(source).not.toMatch(/create or replace function public\.(pause|resume|archive|publish)_listing\b/i);
  });

  it("never accepts owner_id/shop_id/public_code/status/cover_image_id as parameters", () => {
    const params = getParameterListBlock(source);
    expect(params).not.toMatch(/p_owner_id|p_shop_id|p_public_code|p_status|p_cover_image_id/);
  });

  it("never writes cover_image_id or touches listing_images -- image management is a separate RPC", () => {
    const body = getFunctionBody(source);
    expect(body).not.toMatch(/cover_image_id/);
    expect(body).not.toMatch(/public\.listing_images/);
  });

  it("never references orders/order_items/inventory_reservations/snapshots", () => {
    expect(source).not.toMatch(/\bpublic\.orders\b/);
    expect(source).not.toMatch(/\bpublic\.order_items\b/);
    expect(source).not.toMatch(/\bpublic\.inventory_reservations\b/);
  });

  it("is SECURITY DEFINER with an empty search_path, granted to authenticated only", () => {
    expect(source).toMatch(/security definer/i);
    expect(source).toMatch(/set search_path = ''/);
    expect(source).toMatch(/revoke all on function public\.update_listing\(/i);
    expect(source).toMatch(/from public;/);
    expect(source).toMatch(/from anon;/);
    expect(source).toMatch(/grant execute on function public\.update_listing\(/i);
    expect(source).toMatch(/to authenticated;/);
    expect(source).not.toMatch(/to anon;/);
  });

  it("locks the listing row FOR UPDATE as the universal serialization point", () => {
    const body = getFunctionBody(source);
    expect(body).toMatch(/from public\.listings l\s*\n\s*where l\.id = p_listing_id\s*\n\s*for update;/);
  });
});

describe("0059 auth / ownership / draft-only gating", () => {
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
    expect(source).toMatch(/if v_listing_shop_id <> v_shop_id then\s*\n\s*raise exception 'You do not have permission to edit this listing\.' using detail = 'NOT_LISTING_OWNER';/);
  });

  it("blocks seller_suspended/account_suspended (not buyer_restricted)", () => {
    const restrictionBlock = source.slice(source.indexOf("seller admin restrictions"), source.indexOf("lock the listing row"));
    expect(restrictionBlock).toMatch(/restriction_type in \('seller_suspended', 'account_suspended'\)/);
    expect(restrictionBlock).not.toMatch(/buyer_restricted/);
    expect(restrictionBlock).toMatch(/INTERACTION_BLOCKED/);
  });

  it("rejects editing anything that is not currently draft (Draft-only for this task)", () => {
    expect(source).toMatch(/if v_listing_status <> 'draft' then\s*\n\s*raise exception 'Only draft listings can be edited with this operation\.' using detail = 'LISTING_NOT_DRAFT';/);
  });

  it("reports the PRD 29.1 post-publish editing finding rather than silently ignoring or silently implementing it", () => {
    expect(source).toMatch(/29\.1/);
    expect(source).toMatch(/snapshot/i);
  });
});

describe("0059 partial update: unsupplied fields are left unchanged", () => {
  const source = readFile(MIGRATION_PATH);

  it("every field parameter (other than p_listing_id) defaults to null", () => {
    const params = getParameterListBlock(source);
    const fieldParams = params.match(/p_\w+ [\w.\[\]]+( default null)?/g) ?? [];
    const nonDefaultedFieldParams = fieldParams.filter(
      (p) => !p.startsWith("p_listing_id") && !p.includes("default null"),
    );
    expect(nonDefaultedFieldParams).toEqual([]);
  });

  it("category/type/condition/price/original_price/stock/location/brand/meetup_note all merge via coalesce or an explicit not-null branch against the existing row value", () => {
    const body = getFunctionBody(source);
    expect(body).toMatch(/v_final_category_id := coalesce\(p_category_id, v_category_id\);/);
    expect(body).toMatch(/v_final_listing_type := coalesce\(p_listing_type, v_listing_type\);/);
    expect(body).toMatch(/v_final_condition := coalesce\(p_condition, v_condition\);/);
    expect(body).toMatch(/v_final_price_cents := coalesce\(p_price_cents, v_price_cents\);/);
    expect(body).toMatch(/v_final_original_price_cents := coalesce\(p_original_price_cents, v_original_price_cents\);/);
    expect(body).toMatch(/v_final_stock_quantity := coalesce\(p_stock_quantity, v_stock_quantity\);/);
    expect(body).toMatch(/v_final_province_id := coalesce\(p_province_id, v_province_id\);/);
    expect(body).toMatch(/v_final_city_id := coalesce\(p_city_id, v_city_id\);/);
    expect(body).toMatch(/v_final_barangay_id := coalesce\(p_barangay_id, v_barangay_id\);/);
    expect(body).toMatch(/v_final_is_negotiable := coalesce\(p_is_negotiable, v_is_negotiable\);/);
  });

  it("a call supplying only p_listing_id and one field must not require every other field", () => {
    const params = getParameterListBlock(source);
    // p_listing_id is the only parameter without "default null"
    expect(params).toMatch(/p_listing_id uuid,/);
    expect(params).not.toMatch(/p_listing_id uuid default/);
  });
});

describe("0059 title: may never become blank", () => {
  const source = readFile(MIGRATION_PATH);

  it("when supplied, blank/whitespace-only title is rejected with TITLE_REQUIRED", () => {
    expect(source).toMatch(/if p_title is not null then\s*\n\s*v_final_title := nullif\(btrim\(p_title\), ''\);\s*\n\s*if v_final_title is null then\s*\n\s*raise exception 'Listing title is required\.' using detail = 'TITLE_REQUIRED';/);
  });

  it("when not supplied, the existing title is kept unchanged", () => {
    expect(source).toMatch(/else\s*\n\s*v_final_title := v_title;\s*\n\s*end if;/);
  });
});

describe("0059 description: nullable while draft, clearable via explicit empty string", () => {
  const source = readFile(MIGRATION_PATH);

  it("normalizes a supplied description via nullif(btrim(...), '') exactly like create_listing", () => {
    expect(source).toMatch(/if p_description is not null then\s*\n\s*v_final_description := nullif\(btrim\(p_description\), ''\);/);
  });

  it("never raises a DESCRIPTION_REQUIRED error -- description stays optional while draft", () => {
    const body = getFunctionBody(source);
    expect(body).not.toMatch(/DESCRIPTION_REQUIRED/);
  });
});

describe("0059 category/type/condition cross-validation on final merged state", () => {
  const source = readFile(MIGRATION_PATH);

  it("cross-validates listing type / condition only once both are known, using the FINAL merged values, not the raw parameters", () => {
    expect(source).toMatch(/if v_final_listing_type is not null and v_final_condition is not null then/);
    expect(source).toMatch(/if v_final_listing_type = 'brand_new' and v_final_condition <> 'brand_new' then/);
    expect(source).toMatch(/if v_final_listing_type = 'preloved' and v_final_condition = 'brand_new' then/);
    expect(source).toMatch(/LISTING_TYPE_CONDITION_MISMATCH/);
  });

  it("cross-validation fires correctly even when only ONE of type/condition is supplied this call (the other comes from the existing row)", () => {
    const body = getFunctionBody(source);
    // both branches read v_final_listing_type/v_final_condition, which are
    // themselves coalesce(supplied, existing) -- so a call that only
    // supplies p_condition still cross-validates against the existing
    // p_listing_type, and vice versa.
    expect(body).toMatch(/v_final_listing_type := coalesce\(p_listing_type, v_listing_type\);/);
    expect(body).toMatch(/v_final_condition := coalesce\(p_condition, v_condition\);/);
  });

  it("resolves category existence and vehicle/rental eligibility from the FINAL category id, not just a supplied one", () => {
    expect(source).toMatch(/v_final_category_id := coalesce\(p_category_id, v_category_id\);/);
    expect(source).toMatch(/if v_final_category_id is not null then/);
    expect(source).toMatch(/'Selected category does not exist\.' using detail = 'CATEGORY_NOT_FOUND'/);
  });
});

describe("0059 Fair condition + known_flaws: correct final state regardless of which field changed", () => {
  const source = readFile(MIGRATION_PATH);

  it("evaluates the Fair requirement against the FINAL merged condition and known_flaws", () => {
    expect(source).toMatch(/if v_final_condition = 'fair' and v_final_known_flaws is null then\s*\n\s*raise exception 'Known flaws are required for Fair condition\.' using detail = 'KNOWN_FLAWS_REQUIRED';/);
  });

  it("known_flaws merges via the same not-null-branch pattern as description (explicit '' clears it)", () => {
    expect(source).toMatch(/if p_known_flaws is not null then\s*\n\s*v_final_known_flaws := nullif\(btrim\(p_known_flaws\), ''\);/);
  });
});

describe("0059 price / original price validated on final merged state", () => {
  const source = readFile(MIGRATION_PATH);

  it("rejects a negative final price", () => {
    expect(source).toMatch(/if v_final_price_cents is not null and v_final_price_cents < 0 then/);
    expect(source).toMatch(/PRICE_INVALID/);
  });

  it("rejects a final original price lower than the final price, catching a stale original_price left over from before a price change", () => {
    expect(source).toMatch(/if v_final_original_price_cents is not null and v_final_price_cents is not null\s*\n\s*and v_final_original_price_cents < v_final_price_cents then/);
    expect(source).toMatch(/ORIGINAL_PRICE_INVALID/);
  });
});

describe("0059 stock quantity validated on final merged state", () => {
  const source = readFile(MIGRATION_PATH);

  it("requires the final stock quantity to be at least 1 (0 is reserved for the order-completion pathway, not seller-editable input)", () => {
    expect(source).toMatch(/if v_final_stock_quantity is null or v_final_stock_quantity < 1 then/);
    expect(source).toMatch(/STOCK_QUANTITY_INVALID/);
  });
});

describe("0059 location hierarchy validated on final merged trio", () => {
  const source = readFile(MIGRATION_PATH);

  it("still rejects city-without-province and barangay-without-city, using the final merged trio", () => {
    expect(source).toMatch(/if v_final_city_id is not null and v_final_province_id is null then/);
    expect(source).toMatch(/'City requires province to also be specified\.' using detail = 'CITY_REQUIRES_PROVINCE'/);
    expect(source).toMatch(/if v_final_barangay_id is not null and v_final_city_id is null then/);
    expect(source).toMatch(/'Barangay requires city to also be specified\.' using detail = 'BARANGAY_REQUIRES_CITY'/);
  });

  it("catches a city left stale relative to a newly changed province (INVALID_CITY_FOR_PROVINCE), and equivalently for barangay/city", () => {
    expect(source).toMatch(/'Selected city does not belong to the selected province\.' using detail = 'INVALID_CITY_FOR_PROVINCE'/);
    expect(source).toMatch(/'Selected barangay does not belong to the selected city\.' using detail = 'INVALID_BARANGAY_FOR_CITY'/);
  });
});

describe("0059 fulfillment methods: whole-set replace, only when supplied", () => {
  const source = readFile(MIGRATION_PATH);

  it("leaves existing fulfillment methods completely untouched when p_fulfillment_methods is not supplied", () => {
    expect(source).toMatch(/if p_fulfillment_methods is not null then/);
  });

  it("rejects a duplicate method within the supplied replacement set", () => {
    expect(source).toMatch(/v_fulfillment_count <> \(select count\(distinct m\) from unnest\(p_fulfillment_methods\) m\)/);
    expect(source).toMatch(/FULFILLMENT_INVALID/);
  });

  it("deletes the existing set before inserting the new one, and tolerates an explicit empty array (clears all methods)", () => {
    expect(source).toMatch(/delete from public\.listing_fulfillment_methods where listing_id = p_listing_id;/);
    expect(source).toMatch(/if v_fulfillment_count > 0 then\s*\n\s*insert into public\.listing_fulfillment_methods/);
  });
});

describe("0059 vehicle/rental: final-category-driven cleanup and validation", () => {
  const source = readFile(MIGRATION_PATH);

  it("removes the vehicle_details row when the final category is no longer Cars/Motorcycles", () => {
    expect(source).toMatch(/if not v_final_is_vehicle_category then\s*\n\s*delete from public\.listing_vehicle_details where listing_id = p_listing_id;/);
  });

  it("removes the rental_details row when the final category is no longer For Rent", () => {
    expect(source).toMatch(/if not v_final_is_rental_category then\s*\n\s*delete from public\.listing_rental_details where listing_id = p_listing_id;/);
  });

  it("rejects vehicle details supplied against a final category that is not vehicle-eligible", () => {
    expect(source).toMatch(/if not v_final_is_vehicle_category then\s*\n\s*raise exception 'Vehicle details are only allowed for Cars\/Motorcycles listings\.' using detail = 'VEHICLE_DETAILS_NOT_ALLOWED';/);
  });

  it("rejects rental details supplied against a final category that is not rental-eligible", () => {
    expect(source).toMatch(/if not v_final_is_rental_category then\s*\n\s*raise exception 'Rental details are only allowed for For Rent listings\.' using detail = 'RENTAL_DETAILS_NOT_ALLOWED';/);
  });

  it("upserts vehicle/rental detail rows via ON CONFLICT (listing_id), not a blind insert -- so calling twice does not fail with a duplicate-key error", () => {
    expect(source).toMatch(/insert into public\.listing_vehicle_details \(([\s\S]*?)\)\s*\n\s*values \(([\s\S]*?)\)\s*\n\s*on conflict \(listing_id\) do update set/);
    expect(source).toMatch(/insert into public\.listing_rental_details \(([\s\S]*?)\)\s*\n\s*values \(([\s\S]*?)\)\s*\n\s*on conflict \(listing_id\) do update set/);
  });

  it("cleanup runs before validation/upsert, so a category change away from vehicle plus a same-call rental_details supply is handled correctly", () => {
    const cleanupIndex = source.indexOf("if not v_final_is_vehicle_category then");
    const vehicleValidationIndex = source.indexOf("Vehicle details are only allowed");
    expect(cleanupIndex).toBeGreaterThan(0);
    expect(vehicleValidationIndex).toBeGreaterThan(cleanupIndex);
  });
});

describe("0059 public_code preserved, slug regenerated only on an actual title change", () => {
  const source = readFile(MIGRATION_PATH);

  it("never writes public_code -- the UPDATE statement's SET list has no public_code assignment", () => {
    const updateBlock = source.slice(source.indexOf("update public.listings as l"), source.indexOf("where l.id = p_listing_id\n    returning"));
    expect(updateBlock).not.toMatch(/public_code\s*=/);
  });

  it("regenerates the slug only when the final title differs from the existing title", () => {
    expect(source).toMatch(/if v_final_title <> v_title then/);
    expect(source).toMatch(/v_final_slug := lower\(regexp_replace\(btrim\(v_final_title\), '\[\^a-zA-Z0-9\]\+', '-', 'g'\)\);/);
  });

  it("keeps the existing slug unchanged when the title is not actually changing", () => {
    expect(source).toMatch(/else\s*\n\s*v_final_slug := v_slug;\s*\n\s*end if;/);
  });

  it("falls back to 'listing' for a slug that normalizes to empty, exactly like create_listing", () => {
    expect(source).toMatch(/if v_final_slug = '' or v_final_slug is null then\s*\n\s*v_final_slug := 'listing';/);
  });
});

describe("0059 remains atomic, no order/order_item writes", () => {
  const source = readFile(MIGRATION_PATH);

  it("every write stays inside one function body, no explicit COMMIT", () => {
    const body = getFunctionBody(source);
    expect(body).toMatch(/update public\.listings as l/);
    expect(body).not.toMatch(/\bcommit\b/i);
  });

  it("returns the listing's public_code, current (still draft) status, and the real updated_at from the RETURNING clause", () => {
    expect(source).toMatch(/returning l\.updated_at into v_updated_at;/);
    expect(source).toMatch(/select p_listing_id, v_public_code, v_final_slug, v_listing_status, v_updated_at;/);
  });
});
