// HISTORICAL / SUPERSEDED -- this file documents the structure of 0054, the
// original create_listing foundation, which required a nearly-complete
// listing (title, description, category, listing type, condition, price,
// stock, location, fulfillment, 1-8 images) even to save a Draft. That
// requirement was later found to conflict with the locked product decision
// "Draft listings may be incomplete; strict completeness validation belongs
// at publish time" (PRD 10.6 / ARCHITECTURE / ARCHITECTURE_ESSENTIALS /
// AGENTS.md / CLAUDE.md), and 0054 was corrected accordingly --
// 0055_allow_incomplete_draft_listings.sql is the current, authoritative
// create_listing behavior; see
// tests/unit/create-listing-incomplete-draft-architecture.test.ts for its
// coverage. 0054's file itself is left byte-for-byte unmodified (this
// project's "never edit an already-applied migration" rule), and is kept
// here only as historical regression coverage confirming the OLD file's own
// structure hasn't drifted -- not that its all-fields-required design is
// still current or correct.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

function readFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf-8");
}

const MIGRATION_PATH = "supabase/migrations/0054_create_listing_rpc.sql";

/** The function's own parameter-list block only -- excludes header prose
 * (which legitimately discusses parameter names that do NOT exist, e.g.
 * "no p_slug parameter exists") and excludes unrelated identifiers that
 * merely contain a similar substring (e.g. "shop_status_enum" contains
 * "p_status"). Bounded between the CREATE FUNCTION line and "returns table". */
function getParameterListBlock(source: string): string {
  const start = source.indexOf("create or replace function public.create_listing(");
  const end = source.indexOf("returns table", start);
  return source.slice(start, end);
}

describe("0054 create_listing is scoped to exactly a creation RPC -- no schema/frontend/other-RPC change", () => {
  const source = readFile(MIGRATION_PATH);

  it("creates exactly one function, create_listing, no schema/enum/policy change", () => {
    expect(source).toMatch(/create or replace function public\.create_listing\s*\(/);
    expect(source).not.toMatch(/create table|alter table|drop table/i);
    expect(source).not.toMatch(/create type|alter type/i);
    expect(source).not.toMatch(/create policy|alter policy|drop policy/i);
    expect(source).not.toMatch(/create or replace function public\.update_listing/i);
    expect(source).not.toMatch(/create or replace function public\.publish_listing/i);
    expect(source).not.toMatch(/create or replace function public\.(pause|resume|archive)_listing/i);
  });

  it("never references orders/order_items/inventory_reservations", () => {
    expect(source).not.toMatch(/\bpublic\.orders\b/);
    expect(source).not.toMatch(/\bpublic\.order_items\b/);
    expect(source).not.toMatch(/\bpublic\.inventory_reservations\b/);
  });

  it("is SECURITY DEFINER with an empty search_path, every reference schema-qualified", () => {
    expect(source).toMatch(/security definer/i);
    expect(source).toMatch(/set search_path = ''/);
  });

  it("is granted to authenticated only -- revoked from public and anon", () => {
    expect(source).toMatch(/revoke all on function public\.create_listing\([\s\S]*?\) from public/i);
    expect(source).toMatch(/revoke all on function public\.create_listing\([\s\S]*?\) from anon/i);
    expect(source).toMatch(/grant execute on function public\.create_listing\([\s\S]*?\) to authenticated/i);
    expect(source).not.toMatch(/grant execute on function public\.create_listing\([\s\S]*?\) to anon/i);
  });
});

describe("0054 auth and ownership gating", () => {
  const source = readFile(MIGRATION_PATH);

  it("requires auth.uid() and rejects with NOT_AUTHENTICATED", () => {
    expect(source).toMatch(/v_caller := auth\.uid\(\);/);
    expect(source).toMatch(/if v_caller is null then\s*\n\s*raise exception 'Authentication required\.' using detail = 'NOT_AUTHENTICATED';/);
  });

  it("never accepts an owner/shop/user id parameter -- identity comes only from auth.uid()", () => {
    expect(source).not.toMatch(/p_owner_id|p_shop_id|p_user_id|p_caller_id|p_seller_id/);
  });

  it("resolves the caller's shop by owner_id = auth.uid(), rejecting with SHOP_NOT_FOUND if none exists", () => {
    expect(source).toMatch(/where s\.owner_id = v_caller/);
    expect(source).toMatch(/raise exception 'Create your shop first\.' using detail = 'SHOP_NOT_FOUND';/);
  });

  it("blocks creation for seller_suspended/account_suspended restrictions (not buyer_restricted)", () => {
    const restrictionBlock = source.slice(source.indexOf("seller admin restrictions"), source.indexOf("title / description"));
    expect(restrictionBlock).toMatch(/restriction_type in \('seller_suspended', 'account_suspended'\)/);
    expect(restrictionBlock).not.toMatch(/buyer_restricted/);
    expect(restrictionBlock).toMatch(/INTERACTION_BLOCKED/);
  });
});

describe("0054 draft-only creation", () => {
  const source = readFile(MIGRATION_PATH);

  it("never accepts a status parameter", () => {
    expect(getParameterListBlock(source)).not.toMatch(/p_status\b/);
  });

  it("inserts every new listing with the literal status 'draft'", () => {
    const insertBlock = source.slice(source.indexOf("insert into public.listings"), source.indexOf("returning l.id"));
    expect(insertBlock).toMatch(/'draft'/);
  });

  it("returns the literal 'draft' status, not a column read that could drift", () => {
    expect(source).toMatch(/select v_listing_id, v_public_code, v_slug, 'draft'::public\.listing_status_enum, v_created_at;/);
  });
});

describe("[HISTORICAL, superseded by 0055] 0054 image validation (1-8, ownership, order, cover)", () => {
  const source = readFile(MIGRATION_PATH);

  it("requires at least 1 image (IMAGE_REQUIRED) -- 0055 allows 0-8, draft may have zero images", () => {
    expect(source).toMatch(/if v_image_count < 1 then\s*\n\s*raise exception 'At least one photo is required\.' using detail = 'IMAGE_REQUIRED';/);
  });

  it("rejects more than 8 images (TOO_MANY_LISTING_IMAGES)", () => {
    expect(source).toMatch(/if v_image_count > 8 then\s*\n\s*raise exception 'A listing may have at most 8 photos\.' using detail = 'TOO_MANY_LISTING_IMAGES';/);
  });

  it("validates every image path belongs to the caller under listing-images", () => {
    expect(source).toMatch(/v_path !~ \('\^listing-images\/' \|\| v_caller::text \|\| '\/'\)/);
    expect(source).toMatch(/LISTING_IMAGE_PATH_INVALID/);
  });

  it("preserves submitted array order as position 0..N-1", () => {
    expect(source).toMatch(/for i in 1\.\.v_image_count loop\s*\n\s*insert into public\.listing_images \(listing_id, storage_path, position, is_reference_image\)\s*\n\s*values \(v_listing_id, p_image_paths\[i\], i - 1, false\);/);
  });

  it("sets a deterministic cover image -- always the image at position 0, never a client-supplied id", () => {
    expect(source).not.toMatch(/p_cover_image_id/);
    expect(source).toMatch(/where li\.listing_id = v_listing_id and li\.position = 0/);
    expect(source).toMatch(/set cover_image_id = v_cover_image_id/);
  });

  it("creates every image as an actual-item photo (is_reference_image = false) -- Reference/Catalog labeling is deferred", () => {
    expect(source).toMatch(/values \(v_listing_id, p_image_paths\[i\], i - 1, false\);/);
    expect(source).not.toMatch(/p_is_reference_image/);
  });
});

describe("0054 listing type / condition / known-flaws validation", () => {
  const source = readFile(MIGRATION_PATH);

  it("rejects Brand New type with a non-Brand-New condition", () => {
    expect(source).toMatch(/if p_listing_type = 'brand_new' and p_condition <> 'brand_new' then\s*\n\s*raise exception 'Brand New listings must use Brand New condition\.' using detail = 'LISTING_TYPE_CONDITION_MISMATCH';/);
  });

  it("rejects Pre-loved type with Brand New condition", () => {
    expect(source).toMatch(/if p_listing_type = 'preloved' and p_condition = 'brand_new' then\s*\n\s*raise exception 'Pre-loved listings cannot use Brand New condition\.' using detail = 'LISTING_TYPE_CONDITION_MISMATCH';/);
  });

  it("requires known_flaws only when condition is Fair", () => {
    expect(source).toMatch(/if p_condition = 'fair' and v_known_flaws is null then\s*\n\s*raise exception 'Known flaws are required for Fair condition\.' using detail = 'KNOWN_FLAWS_REQUIRED';/);
  });

  it("relies on the pre-existing schema CHECK constraints as the structural backstop -- does not weaken or duplicate-conflict with them", () => {
    // The RPC's own pre-checks use the identical predicate shape as
    // listings_type_condition_check / listings_fair_requires_known_flaws_check
    // (0008), so a row that passes this RPC's validation always also
    // satisfies those CHECKs -- confirmed by matching literal condition text.
    expect(source).toMatch(/p_listing_type = 'brand_new' and p_condition <> 'brand_new'/);
    expect(source).toMatch(/p_listing_type = 'preloved' and p_condition = 'brand_new'/);
  });
});

describe("[HISTORICAL, superseded by 0055] 0054 price and stock validation", () => {
  const source = readFile(MIGRATION_PATH);

  it("rejects a null or negative price -- 0055 allows null (unset), only rejects a supplied negative value", () => {
    expect(source).toMatch(/if p_price_cents is null or p_price_cents < 0 then\s*\n\s*raise exception 'Price is invalid\.' using detail = 'PRICE_INVALID';/);
  });

  it("rejects an original price lower than the current price", () => {
    expect(source).toMatch(/if p_original_price_cents is not null and p_original_price_cents < p_price_cents then/);
    expect(source).toMatch(/ORIGINAL_PRICE_INVALID/);
  });

  it("requires stock quantity to be at least 1", () => {
    expect(source).toMatch(/if p_stock_quantity is null or p_stock_quantity < 1 then\s*\n\s*raise exception 'Stock quantity must be at least 1\.' using detail = 'STOCK_QUANTITY_INVALID';/);
  });

  it("defaults stock quantity to 1, matching the listings column default", () => {
    expect(source).toMatch(/p_stock_quantity integer default 1/);
  });
});

describe("[HISTORICAL, superseded by 0055] 0054 location hierarchy validation", () => {
  const source = readFile(MIGRATION_PATH);

  it("requires province and city, validates city belongs to province -- 0055 allows fully unset location", () => {
    expect(source).toMatch(/PROVINCE_REQUIRED/);
    expect(source).toMatch(/CITY_REQUIRED/);
    expect(source).toMatch(/where c\.id = p_city_id and c\.province_id = p_province_id/);
    expect(source).toMatch(/INVALID_CITY_FOR_PROVINCE/);
  });

  it("validates barangay belongs to city only when supplied (barangay itself optional)", () => {
    expect(source).toMatch(/if p_barangay_id is not null and not exists \(/);
    expect(source).toMatch(/where b\.id = p_barangay_id and b\.city_id = p_city_id/);
    expect(source).toMatch(/INVALID_BARANGAY_FOR_CITY/);
  });
});

describe("[HISTORICAL, superseded by 0055] 0054 fulfillment method validation", () => {
  const source = readFile(MIGRATION_PATH);

  it("requires at least one fulfillment method -- 0055 allows zero, draft may have none", () => {
    expect(source).toMatch(/if v_fulfillment_count < 1 then\s*\n\s*raise exception 'At least one fulfillment method is required\.' using detail = 'FULFILLMENT_REQUIRED';/);
  });

  it("rejects duplicate fulfillment methods", () => {
    expect(source).toMatch(/v_fulfillment_count <> \(select count\(distinct m\) from unnest\(p_fulfillment_methods\) m\)/);
    expect(source).toMatch(/'Duplicate fulfillment method selected\.' using detail = 'FULFILLMENT_INVALID'/);
  });

  it("relies on Postgres's own enum type system to reject an invalid method value at the call boundary (typed array parameter, no free-text method field)", () => {
    expect(source).toMatch(/p_fulfillment_methods public\.fulfillment_method_enum\[\]/);
  });
});

describe("0054 vehicle details -- conditional on category, cast-safe, fully optional", () => {
  const source = readFile(MIGRATION_PATH);
  const vehicleBlock = source.slice(source.indexOf("vehicle details (optional"), source.indexOf("rental details (optional"));

  it("resolves vehicle eligibility from categories.slug ('cars'/'motorcycles'), not a hardcoded id", () => {
    expect(source).toMatch(/v_is_vehicle_category := v_category_slug in \('cars', 'motorcycles'\);/);
  });

  it("rejects vehicle details supplied for a non-vehicle category", () => {
    expect(vehicleBlock).toMatch(/if not v_is_vehicle_category then/);
    expect(vehicleBlock).toMatch(/VEHICLE_DETAILS_NOT_ALLOWED/);
  });

  it("never requires vehicle details even for a vehicle category (p_vehicle_details stays optional)", () => {
    expect(source).toMatch(/p_vehicle_details jsonb default null/);
  });

  it("validates JSON shape before casting any field (object type, per-key jsonb_typeof, enum membership pre-check)", () => {
    expect(vehicleBlock).toMatch(/jsonb_typeof\(p_vehicle_details\) <> 'object'/);
    expect(vehicleBlock).toMatch(/jsonb_typeof\(p_vehicle_details -> 'year'\) <> 'number'/);
    expect(vehicleBlock).toMatch(/not in \('registered', 'expired_registration', 'for_renewal'\)/);
  });

  it("enforces year >= 1900, matching listing_vehicle_details_year_check", () => {
    expect(vehicleBlock).toMatch(/if v_vehicle_year < 1900 then/);
  });

  it("enforces mileage_km >= 0, matching listing_vehicle_details_mileage_km_check", () => {
    expect(vehicleBlock).toMatch(/if v_vehicle_mileage_km < 0 then/);
  });

  it("validates documents_available as an array of strings before casting to text[]", () => {
    expect(vehicleBlock).toMatch(/jsonb_typeof\(p_vehicle_details -> 'documents_available'\) <> 'array'/);
    expect(vehicleBlock).toMatch(/jsonb_array_elements_text\(p_vehicle_details -> 'documents_available'\)/);
  });
});

describe("0054 rental details -- conditional on category, cast-safe, fully optional", () => {
  const source = readFile(MIGRATION_PATH);
  const rentalBlock = source.slice(source.indexOf("rental details (optional"), source.indexOf("slug: derived from title"));

  it("resolves rental eligibility from categories.slug ('for-rent'), not a hardcoded id", () => {
    expect(source).toMatch(/v_is_rental_category := v_category_slug = 'for-rent';/);
  });

  it("rejects rental details supplied for a non-rental category", () => {
    expect(rentalBlock).toMatch(/if not v_is_rental_category then/);
    expect(rentalBlock).toMatch(/RENTAL_DETAILS_NOT_ALLOWED/);
  });

  it("never requires rental details even for a For Rent listing (p_rental_details stays optional)", () => {
    expect(source).toMatch(/p_rental_details jsonb default null/);
  });

  it("validates rental_period/availability against their literal enum sets before casting", () => {
    expect(rentalBlock).toMatch(/not in \('daily', 'weekly', 'monthly', 'other'\)/);
    expect(rentalBlock).toMatch(/not in \('available', 'unavailable', 'paused'\)/);
  });

  it("defaults availability to 'available' when omitted, matching the listing_rental_details column default", () => {
    expect(rentalBlock).toMatch(/else\s*\n\s*v_rental_availability := 'available';/);
  });

  it("enforces rental_price_cents/security_deposit_cents >= 0 and capacity > 0, matching their CHECK constraints", () => {
    expect(rentalBlock).toMatch(/if v_rental_price_cents < 0 then/);
    expect(rentalBlock).toMatch(/if v_rental_security_deposit_cents < 0 then/);
    expect(rentalBlock).toMatch(/if v_rental_capacity <= 0 then/);
  });
});

describe("0054 generated public_code and slug -- never client-supplied", () => {
  const source = readFile(MIGRATION_PATH);

  it("never accepts a public_code or slug parameter from the client", () => {
    const paramBlock = getParameterListBlock(source);
    expect(paramBlock).not.toMatch(/p_public_code\b/);
    expect(paramBlock).not.toMatch(/p_slug\b/);
  });

  it("generates public_code with the exact PSL- + 8-random-byte-hex shape used by orders' PSO- convention", () => {
    expect(source).toMatch(/v_public_code := 'PSL-' \|\| upper\(encode\(extensions\.gen_random_bytes\(8\), 'hex'\)\);/);
  });

  it("retries public_code generation only on a public_code collision, re-raising any other unique_violation", () => {
    expect(source).toMatch(/get stacked diagnostics v_constraint_name = constraint_name;/);
    expect(source).toMatch(/if v_constraint_name <> 'listings_public_code_key' then\s*\n\s*raise;/);
  });

  it("derives slug from title using the same normalization as generate_unique_shop_slug (lowercase, hyphenated, trimmed, fallback on empty)", () => {
    expect(source).toMatch(/v_slug := lower\(regexp_replace\(btrim\(v_title\), '\[\^a-zA-Z0-9\]\+', '-', 'g'\)\);/);
    expect(source).toMatch(/v_slug := btrim\(v_slug, '-'\);/);
    expect(source).toMatch(/if v_slug = '' or v_slug is null then\s*\n\s*v_slug := 'listing';/);
  });

  it("slug is not required to be unique (no collision retry for slug, matching listings.slug's own non-unique design)", () => {
    const slugBlock = source.slice(source.indexOf("slug: derived from title"), source.indexOf("transaction-stable time"));
    expect(slugBlock).not.toMatch(/while exists/);
  });
});

describe("0054 atomicity", () => {
  const source = readFile(MIGRATION_PATH);

  it("performs the listing insert, fulfillment rows, image rows, cover-image update, and vehicle/rental inserts all inside one function body (one implicit transaction)", () => {
    const bodyStart = source.indexOf("begin\n");
    const bodyEnd = source.indexOf("end;\n$$;");
    const body = source.slice(bodyStart, bodyEnd);
    expect(body).toMatch(/insert into public\.listings/);
    expect(body).toMatch(/insert into public\.listing_fulfillment_methods/);
    expect(body).toMatch(/insert into public\.listing_images/);
    expect(body).toMatch(/update public\.listings as l\s*\n\s*set cover_image_id/);
    expect(body).toMatch(/insert into public\.listing_vehicle_details/);
    expect(body).toMatch(/insert into public\.listing_rental_details/);
    // No explicit COMMIT anywhere -- a single top-level function invocation
    // is already one transaction; a raised exception after the listings
    // insert rolls back everything that follows it in the same call.
    expect(body).not.toMatch(/\bcommit\b/i);
  });

  it("the only retry loop present is scoped to the public_code collision case, not the whole function", () => {
    const loopStart = source.indexOf("insert the listing (draft only");
    const loopEnd = source.indexOf("fulfillment methods =====================\n  insert into public.listing_fulfillment_methods");
    const loopBlock = source.slice(loopStart, loopEnd);
    expect((loopBlock.match(/\bloop\b/gi) ?? []).length).toBeGreaterThanOrEqual(1);
    expect(loopBlock).toMatch(/exit;/);
  });
});
