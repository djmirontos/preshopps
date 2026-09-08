// PARTIALLY HISTORICAL -- this file documents 0055's create_listing
// correction. Everything here still accurately describes 0055's own
// unmodified file. One test below ("still requires description... the
// deliberate floor") documents a rule 0055 itself flagged as an open
// ambiguity ("title/description... a reported ambiguity, not a silent
// decision") -- that ambiguity was resolved by 0056
// (title required, description optional-while-draft), which is the
// current, authoritative create_listing behavior. See
// tests/unit/create-listing-title-required-description-optional-architecture.test.ts
// for 0056's coverage.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

function readFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf-8");
}

const MIGRATION_PATH = "supabase/migrations/0055_allow_incomplete_draft_listings.sql";

/** The function's own parameter-list block only. */
function getParameterListBlock(source: string): string {
  const start = source.indexOf("create or replace function public.create_listing(");
  const end = source.indexOf("returns table", start);
  return source.slice(start, end);
}

describe("0055 is scoped to the create_listing correction only", () => {
  const source = readFile(MIGRATION_PATH);

  it("alters exactly six listings columns to drop not null -- no other table/column/enum/policy change", () => {
    const alterBlock = source.slice(source.indexOf("alter table listings"), source.indexOf("create or replace function"));
    for (const column of ["category_id", "listing_type", "condition", "price_cents", "province_id", "city_id"]) {
      expect(alterBlock).toMatch(new RegExp(`alter column ${column} drop not null`));
    }
    // title, description, and stock_quantity are deliberately not touched.
    expect(alterBlock).not.toMatch(/alter column title/);
    expect(alterBlock).not.toMatch(/alter column description/);
    expect(alterBlock).not.toMatch(/alter column stock_quantity/);
    expect(source).not.toMatch(/create table|drop table/i);
    expect(source).not.toMatch(/create type|alter type/i);
    expect(source).not.toMatch(/create policy|alter policy|drop policy|create index|drop index/i);
    expect(source).not.toMatch(/add constraint|drop constraint/i);
  });

  it("CREATE OR REPLACEs create_listing under the identical parameter signature as 0054 (no DROP FUNCTION needed)", () => {
    expect(source).not.toMatch(/drop function/i);
    expect(source).toMatch(/create or replace function public\.create_listing\s*\(/);
  });

  it("never references orders/order_items/inventory_reservations", () => {
    expect(source).not.toMatch(/\bpublic\.orders\b/);
    expect(source).not.toMatch(/\bpublic\.order_items\b/);
    expect(source).not.toMatch(/\bpublic\.inventory_reservations\b/);
  });

  it("is still SECURITY DEFINER with an empty search_path", () => {
    expect(source).toMatch(/security definer/i);
    expect(source).toMatch(/set search_path = ''/);
  });

  it("is still granted to authenticated only", () => {
    expect(source).toMatch(/revoke all on function public\.create_listing\([\s\S]*?\) from public/i);
    expect(source).toMatch(/revoke all on function public\.create_listing\([\s\S]*?\) from anon/i);
    expect(source).toMatch(/grant execute on function public\.create_listing\([\s\S]*?\) to authenticated/i);
    expect(source).not.toMatch(/grant execute on function public\.create_listing\([\s\S]*?\) to anon/i);
  });
});

describe("0055 auth / shop ownership / restrictions unchanged", () => {
  const source = readFile(MIGRATION_PATH);

  it("still requires auth.uid() (NOT_AUTHENTICATED)", () => {
    expect(source).toMatch(/v_caller := auth\.uid\(\);/);
    expect(source).toMatch(/'Authentication required\.' using detail = 'NOT_AUTHENTICATED'/);
  });

  it("never accepts an owner/shop/user id parameter", () => {
    expect(source).not.toMatch(/p_owner_id|p_shop_id|p_user_id|p_caller_id|p_seller_id/);
  });

  it("still resolves the caller's own shop via owner_id = auth.uid() (SHOP_NOT_FOUND otherwise)", () => {
    expect(source).toMatch(/where s\.owner_id = v_caller/);
    expect(source).toMatch(/'Create your shop first\.' using detail = 'SHOP_NOT_FOUND'/);
  });

  it("still blocks seller_suspended/account_suspended (not buyer_restricted)", () => {
    const restrictionBlock = source.slice(source.indexOf("seller admin restrictions"), source.indexOf("title / description"));
    expect(restrictionBlock).toMatch(/restriction_type in \('seller_suspended', 'account_suspended'\)/);
    expect(restrictionBlock).not.toMatch(/buyer_restricted/);
  });
});

describe("0055 draft creation: title/description required, everything else optional", () => {
  const source = readFile(MIGRATION_PATH);

  it("still requires title (TITLE_REQUIRED) -- the deliberate floor", () => {
    expect(source).toMatch(/'Listing title is required\.' using detail = 'TITLE_REQUIRED'/);
  });

  it("[HISTORICAL, superseded by 0056] still requires description (DESCRIPTION_REQUIRED) as of 0055 -- 0056 makes description optional-while-draft", () => {
    expect(source).toMatch(/'Listing description is required\.' using detail = 'DESCRIPTION_REQUIRED'/);
  });

  it("never requires category -- CATEGORY_REQUIRED no longer exists", () => {
    expect(source).not.toMatch(/CATEGORY_REQUIRED/);
  });

  it("never requires listing type or condition individually", () => {
    expect(source).not.toMatch(/LISTING_TYPE_REQUIRED/);
    expect(source).not.toMatch(/CONDITION_REQUIRED/);
  });

  it("never requires price -- validated only when supplied and negative", () => {
    expect(source).toMatch(/if p_price_cents is not null and p_price_cents < 0 then/);
    expect(source).not.toMatch(/if p_price_cents is null or p_price_cents < 0 then/);
  });

  it("never requires at least one fulfillment method -- FULFILLMENT_REQUIRED no longer exists in the function body", () => {
    const bodyStart = source.indexOf("begin\n");
    const bodyEnd = source.indexOf("end;\n$$;");
    expect(source.slice(bodyStart, bodyEnd)).not.toMatch(/FULFILLMENT_REQUIRED/);
  });

  it("never requires at least one image -- IMAGE_REQUIRED no longer exists in the function body", () => {
    const bodyStart = source.indexOf("begin\n");
    const bodyEnd = source.indexOf("end;\n$$;");
    expect(source.slice(bodyStart, bodyEnd)).not.toMatch(/IMAGE_REQUIRED/);
  });

  it("never unconditionally requires province/city -- PROVINCE_REQUIRED/CITY_REQUIRED no longer exist", () => {
    expect(source).not.toMatch(/'PROVINCE_REQUIRED'/);
    expect(source).not.toMatch(/'CITY_REQUIRED'/);
  });

  it("always creates status = draft, never accepts a status parameter", () => {
    expect(getParameterListBlock(source)).not.toMatch(/p_status\b/);
    const insertBlock = source.slice(source.indexOf("insert into public.listings"), source.indexOf("returning l.id"));
    expect(insertBlock).toMatch(/'draft'/);
    expect(source).toMatch(/select v_listing_id, v_public_code, v_slug, 'draft'::public\.listing_status_enum, v_created_at;/);
  });
});

describe("0055 validates only supplied values", () => {
  const source = readFile(MIGRATION_PATH);

  it("category: resolved and validated only when p_category_id is not null; unknown id is CATEGORY_NOT_FOUND", () => {
    expect(source).toMatch(/if p_category_id is not null then/);
    expect(source).toMatch(/'Selected category does not exist\.' using detail = 'CATEGORY_NOT_FOUND'/);
    expect(source).toMatch(/v_is_vehicle_category := false;\s*\n\s*v_is_rental_category := false;/);
  });

  it("listing type / condition: cross-validated only when both are supplied", () => {
    expect(source).toMatch(/if p_listing_type is not null and p_condition is not null then/);
    expect(source).toMatch(/LISTING_TYPE_CONDITION_MISMATCH/);
  });

  it("known flaws: required only when condition is actually 'fair'", () => {
    expect(source).toMatch(/if p_condition = 'fair' and v_known_flaws is null then/);
  });

  it("price: rejects a supplied negative value; original price checked only when both price and original price are supplied", () => {
    expect(source).toMatch(/if p_price_cents is not null and p_price_cents < 0 then/);
    expect(source).toMatch(/if p_original_price_cents is not null and p_price_cents is not null and p_original_price_cents < p_price_cents then/);
  });

  it("stock quantity: defaults to 1, validated only when explicitly supplied and invalid", () => {
    expect(source).toMatch(/p_stock_quantity integer default 1/);
    expect(source).toMatch(/if p_stock_quantity is not null and p_stock_quantity < 1 then/);
    expect(source).toMatch(/coalesce\(p_stock_quantity, 1\)/);
  });

  it("location: city without province is rejected (CITY_REQUIRES_PROVINCE); barangay without city is rejected (BARANGAY_REQUIRES_CITY)", () => {
    expect(source).toMatch(/if p_city_id is not null and p_province_id is null then\s*\n\s*raise exception 'City requires province to also be specified\.' using detail = 'CITY_REQUIRES_PROVINCE';/);
    expect(source).toMatch(/if p_barangay_id is not null and p_city_id is null then\s*\n\s*raise exception 'Barangay requires city to also be specified\.' using detail = 'BARANGAY_REQUIRES_CITY';/);
  });

  it("location: city-belongs-to-province and barangay-belongs-to-city are validated only when both relevant ids are present", () => {
    expect(source).toMatch(/if p_province_id is not null and p_city_id is not null and not exists \(/);
    expect(source).toMatch(/where c\.id = p_city_id and c\.province_id = p_province_id/);
    expect(source).toMatch(/INVALID_CITY_FOR_PROVINCE/);
    expect(source).toMatch(/if p_barangay_id is not null and p_city_id is not null and not exists \(/);
    expect(source).toMatch(/where b\.id = p_barangay_id and b\.city_id = p_city_id/);
    expect(source).toMatch(/INVALID_BARANGAY_FOR_CITY/);
  });

  it("location: province alone (no city/barangay) is a valid partial state -- no unconditional CITY_REQUIRED gate blocks it", () => {
    // Confirmed by the absence of any unconditional "if p_city_id is null then raise" gate.
    expect(source).not.toMatch(/if p_city_id is null then\s*\n\s*raise/);
  });

  it("fulfillment methods: deduplicated only when at least one is supplied", () => {
    expect(source).toMatch(/if v_fulfillment_count > 0\s*\n\s*and v_fulfillment_count <> \(select count\(distinct m\) from unnest\(p_fulfillment_methods\) m\) then/);
  });

  it("vehicle details: rejected for a non-vehicle OR unknown category; still fully optional even for Cars/Motorcycles", () => {
    const vehicleBlock = source.slice(source.indexOf("vehicle details (optional"), source.indexOf("rental details (optional"));
    expect(vehicleBlock).toMatch(/if not v_is_vehicle_category then/);
    expect(vehicleBlock).toMatch(/VEHICLE_DETAILS_NOT_ALLOWED/);
    expect(source).toMatch(/p_vehicle_details jsonb default null/);
  });

  it("rental details: rejected for a non-rental OR unknown category; still fully optional even for For Rent", () => {
    const rentalBlock = source.slice(source.indexOf("rental details (optional"), source.indexOf("slug: derived from title"));
    expect(rentalBlock).toMatch(/if not v_is_rental_category then/);
    expect(rentalBlock).toMatch(/RENTAL_DETAILS_NOT_ALLOWED/);
    expect(source).toMatch(/p_rental_details jsonb default null/);
  });
});

describe("0055 image behavior: 0-8 images, ownership, order, cover", () => {
  const source = readFile(MIGRATION_PATH);

  it("allows zero images -- no minimum-count check remains", () => {
    expect(source).not.toMatch(/if v_image_count < 1 then/);
  });

  it("still rejects more than 8 images", () => {
    expect(source).toMatch(/if v_image_count > 8 then\s*\n\s*raise exception 'A listing may have at most 8 photos\.' using detail = 'TOO_MANY_LISTING_IMAGES';/);
  });

  it("still validates every supplied image path belongs to the caller under listing-images, only when at least one is supplied", () => {
    expect(source).toMatch(/if v_image_count > 0 then\s*\n\s*foreach v_path in array p_image_paths loop/);
    expect(source).toMatch(/v_path !~ \('\^listing-images\/' \|\| v_caller::text \|\| '\/'\)/);
    expect(source).toMatch(/LISTING_IMAGE_PATH_INVALID/);
  });

  it("still preserves submitted order as position 0..N-1 when images are supplied", () => {
    expect(source).toMatch(/for i in 1\.\.v_image_count loop\s*\n\s*insert into public\.listing_images \(listing_id, storage_path, position, is_reference_image\)\s*\n\s*values \(v_listing_id, p_image_paths\[i\], i - 1, false\);/);
  });

  it("cover image assignment is now conditional on v_image_count > 0 -- zero images means cover_image_id is never touched, stays NULL", () => {
    const imageBlock = source.slice(
      source.indexOf("images, preserving submitted order"),
      source.indexOf("vehicle details ====================="),
    );
    expect(imageBlock).toMatch(/if v_image_count > 0 then/);
    expect(imageBlock).toMatch(/set cover_image_id = v_cover_image_id/);
    expect(source).not.toMatch(/p_cover_image_id/);
  });

  it("with images, cover is still deterministically the image at position 0", () => {
    expect(source).toMatch(/where li\.listing_id = v_listing_id and li\.position = 0/);
  });
});

describe("0055 generated public_code / slug -- unchanged from 0054", () => {
  const source = readFile(MIGRATION_PATH);

  it("never accepts a public_code or slug parameter", () => {
    const paramBlock = getParameterListBlock(source);
    expect(paramBlock).not.toMatch(/p_public_code\b/);
    expect(paramBlock).not.toMatch(/p_slug\b/);
  });

  it("still generates public_code as PSL- + 8-random-byte hex, retried only on a public_code collision", () => {
    expect(source).toMatch(/v_public_code := 'PSL-' \|\| upper\(encode\(extensions\.gen_random_bytes\(8\), 'hex'\)\);/);
    expect(source).toMatch(/get stacked diagnostics v_constraint_name = constraint_name;/);
    expect(source).toMatch(/if v_constraint_name <> 'listings_public_code_key' then\s*\n\s*raise;/);
  });

  it("still derives slug from title with the same normalization, independent of whether other fields are supplied", () => {
    expect(source).toMatch(/v_slug := lower\(regexp_replace\(btrim\(v_title\), '\[\^a-zA-Z0-9\]\+', '-', 'g'\)\);/);
    expect(source).toMatch(/if v_slug = '' or v_slug is null then\s*\n\s*v_slug := 'listing';/);
  });
});

describe("0055 atomicity preserved", () => {
  const source = readFile(MIGRATION_PATH);

  it("the listing insert, and every conditional child insert/update, remain inside one function body (one implicit transaction)", () => {
    const bodyStart = source.indexOf("begin\n");
    const bodyEnd = source.indexOf("end;\n$$;");
    const body = source.slice(bodyStart, bodyEnd);
    expect(body).toMatch(/insert into public\.listings/);
    expect(body).toMatch(/if v_fulfillment_count > 0 then\s*\n\s*insert into public\.listing_fulfillment_methods/);
    expect(body).toMatch(/if v_image_count > 0 then/);
    expect(body).toMatch(/insert into public\.listing_vehicle_details/);
    expect(body).toMatch(/insert into public\.listing_rental_details/);
    expect(body).not.toMatch(/\bcommit\b/i);
  });
});
