import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

function readFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf-8");
}

const MIGRATION_PATH = "supabase/migrations/0063_get_my_listing_rpc.sql";

/** The function body only -- excludes header prose, which legitimately
 * discusses error codes/behavior by name while explaining the design. */
function getFunctionBody(source: string): string {
  const start = source.indexOf("begin\n");
  const end = source.indexOf("end;\n$$;");
  return source.slice(start, end);
}

describe("0063 is scoped to get_my_listing only", () => {
  const source = readFile(MIGRATION_PATH);

  it("creates exactly one function, get_my_listing -- no schema/enum/policy/RLS change", () => {
    expect(source).toMatch(/create or replace function public\.get_my_listing\s*\(/);
    expect(source).not.toMatch(/create table|alter table|drop table/i);
    expect(source).not.toMatch(/create type|alter type/i);
    expect(source).not.toMatch(/create policy|alter policy|drop policy|create index|drop index/i);
    expect(source).not.toMatch(/enable row level security/i);
  });

  it("does not modify any existing write RPC (create_listing/update_listing/replace_listing_images/publish_listing/accept_seller_policies)", () => {
    expect(source).not.toMatch(/create or replace function public\.create_listing/i);
    expect(source).not.toMatch(/create or replace function public\.update_listing/i);
    expect(source).not.toMatch(/create or replace function public\.replace_listing_images/i);
    expect(source).not.toMatch(/create or replace function public\.publish_listing/i);
    expect(source).not.toMatch(/create or replace function public\.accept_seller_policies/i);
    expect(source).not.toMatch(/drop function/i);
  });

  it("takes exactly one parameter, p_listing_id -- no client-supplied owner/shop identity", () => {
    const signature = source.slice(source.indexOf("create or replace function public.get_my_listing("), source.indexOf("returns table"));
    expect(signature).toMatch(/p_listing_id uuid/);
    expect(signature).not.toMatch(/p_owner_id|p_shop_id|p_user_id/);
  });

  it("is read-only: never inserts, updates, or deletes any row", () => {
    const body = getFunctionBody(source);
    expect(body).not.toMatch(/\binsert into\b/i);
    expect(body).not.toMatch(/\bupdate public\./i);
    expect(body).not.toMatch(/\bdelete from\b/i);
  });

  it("never locks the listing row FOR UPDATE -- read-only, no write-write race to serialize against", () => {
    const body = getFunctionBody(source);
    expect(body).not.toMatch(/for update/i);
  });

  it("never references orders/order_items/inventory_reservations", () => {
    expect(source).not.toMatch(/\bpublic\.orders\b/);
    expect(source).not.toMatch(/\bpublic\.order_items\b/);
    expect(source).not.toMatch(/\bpublic\.inventory_reservations\b/);
  });

  it("is SECURITY DEFINER with an empty search_path, granted to authenticated only", () => {
    expect(source).toMatch(/security definer/i);
    expect(source).toMatch(/set search_path = ''/);
    expect(source).toMatch(/revoke all on function public\.get_my_listing\(uuid\) from public/i);
    expect(source).toMatch(/revoke all on function public\.get_my_listing\(uuid\) from anon/i);
    expect(source).toMatch(/grant execute on function public\.get_my_listing\(uuid\) to authenticated/i);
    expect(source).not.toMatch(/grant execute on function public\.get_my_listing\(uuid\) to anon/i);
  });
});

describe("0063 auth / shop / ownership gating", () => {
  const source = readFile(MIGRATION_PATH);

  it("requires auth.uid() (NOT_AUTHENTICATED)", () => {
    expect(source).toMatch(/v_caller := auth\.uid\(\);/);
    expect(source).toMatch(/'Authentication required\.' using detail = 'NOT_AUTHENTICATED'/);
  });

  it("resolves the caller's own shop via owner_id = auth.uid() (SHOP_NOT_FOUND otherwise)", () => {
    expect(source).toMatch(/where s\.owner_id = v_caller/);
    expect(source).toMatch(/'Create your shop first\.' using detail = 'SHOP_NOT_FOUND'/);
  });

  it("distinguishes listing-not-found from not-your-listing (the same two-code convention as update_listing/publish_listing)", () => {
    expect(source).toMatch(/'Listing not found\.' using detail = 'LISTING_NOT_FOUND'/);
    expect(source).toMatch(/if v_listing_shop_id <> v_shop_id then\s*\n\s*raise exception 'You do not have permission to view this listing\.' using detail = 'NOT_LISTING_OWNER';/);
  });

  it("the ownership check runs before any data is ever selected/returned", () => {
    const body = getFunctionBody(source);
    const ownershipCheckIndex = body.indexOf("NOT_LISTING_OWNER");
    const returnQueryIndex = body.indexOf("return query");
    expect(ownershipCheckIndex).toBeGreaterThan(0);
    expect(returnQueryIndex).toBeGreaterThan(ownershipCheckIndex);
  });

  it("applies no status restriction -- not scoped to draft-only, deliberately reusable for any status the caller owns", () => {
    const body = getFunctionBody(source);
    expect(body).not.toMatch(/LISTING_NOT_DRAFT/);
    expect(body).not.toMatch(/l\.status\s*(=|<>|in)\s*'draft'/i);
  });
});

describe("0063 never depends on public marketplace visibility", () => {
  const source = readFile(MIGRATION_PATH);
  const body = getFunctionBody(source);

  it("has no status filter of any kind on the returned listing (unlike get_listing_detail's available/reserved/sold/archived gate)", () => {
    expect(body).not.toMatch(/status in \(/i);
  });

  it("never inner-joins categories/provinces/cities_municipalities/barangays -- only left-joined child collections, and no reference-table join at all for category/location", () => {
    expect(body).not.toMatch(/join public\.categories/i);
    expect(body).not.toMatch(/join public\.provinces/i);
    expect(body).not.toMatch(/join public\.cities_municipalities/i);
    expect(body).not.toMatch(/join public\.barangays/i);
  });

  it("returns category_id/province_id/city_id/barangay_id as plain nullable ids, not resolved names", () => {
    expect(source).toMatch(/category_id integer,/);
    expect(source).toMatch(/province_id integer,/);
    expect(source).toMatch(/city_id integer,/);
    expect(source).toMatch(/barangay_id integer,/);
    expect(source).not.toMatch(/category_name|province_name|city_name|barangay_name/);
  });
});

describe("0063 return shape: full scalar projection plus JSON/array child collections", () => {
  const source = readFile(MIGRATION_PATH);

  it("returns every listing scalar field required to prefill the edit form", () => {
    const returnBlock = source.slice(source.indexOf("returns table"), source.indexOf("language plpgsql"));
    const requiredFields = [
      "listing_id uuid", "public_code text", "slug text", "status public.listing_status_enum",
      "title text", "description text", "category_id integer", "listing_type public.listing_type_enum",
      "condition public.listing_condition_enum", "price_cents bigint", "original_price_cents bigint",
      "is_negotiable boolean", "brand text", "known_flaws text", "stock_quantity integer",
      "province_id integer", "city_id integer", "barangay_id integer", "meetup_note text",
      "created_at timestamptz", "updated_at timestamptz", "published_at timestamptz",
    ];
    for (const field of requiredFields) {
      expect(returnBlock).toContain(field);
    }
  });

  it("returns fulfillment_methods as the complete current enum array, empty (not null) when none exist", () => {
    expect(source).toMatch(/fulfillment_methods public\.fulfillment_method_enum\[\],/);
    expect(source).toMatch(/coalesce\(fm\.methods, '\{\}'::public\.fulfillment_method_enum\[\]\) as fulfillment_methods/);
  });

  it("returns images as a jsonb array with id/storage_path/position/is_reference_image, ordered by position, empty (not null) when none exist", () => {
    expect(source).toMatch(/images jsonb,/);
    expect(source).toMatch(/'id', li\.id,/);
    expect(source).toMatch(/'storage_path', li\.storage_path,/);
    expect(source).toMatch(/'position', li\.position,/);
    expect(source).toMatch(/'is_reference_image', li\.is_reference_image/);
    expect(source).toMatch(/order by li\.position asc/);
    expect(source).toMatch(/coalesce\(imgs\.images, '\[\]'::jsonb\) as images/);
  });

  it("does not invent a separate is-cover flag -- position 0 is the cover by the same construction replace_listing_images already guarantees", () => {
    // the header legitimately names cover_image_id once, while documenting
    // the live listings columns inspected before writing this file -- the
    // function body itself must never read or return it.
    expect(getFunctionBody(source)).not.toMatch(/is_cover|cover_image_id/);
  });

  it("returns vehicle_details as a single jsonb object with every editable field, or SQL NULL (not an empty object) when no row exists", () => {
    expect(source).toMatch(/vehicle_details jsonb,/);
    const directVehicleFields = ["brand", "model", "year", "mileage_km", "transmission", "fuel_type", "registration_status"];
    for (const field of directVehicleFields) {
      expect(source).toMatch(new RegExp(`'${field}', v\\.${field}`));
    }
    // documents_available is a text[] column -- wrapped in to_jsonb() rather
    // than passed directly, unlike every other scalar vehicle field.
    expect(source).toMatch(/'documents_available', to_jsonb\(v\.documents_available\)/);
    expect(source).toMatch(/veh\.details as vehicle_details/);
    expect(source).not.toMatch(/coalesce\(veh\.details/);
  });

  it("returns rental_details as a single jsonb object with every editable field, or SQL NULL when no row exists", () => {
    expect(source).toMatch(/rental_details jsonb,?$/m);
    const rentalFields = [
      "rental_price_cents", "rental_period", "security_deposit_cents", "rental_terms",
      "minimum_rental_period", "capacity", "whats_included", "rules_restrictions", "availability",
    ];
    for (const field of rentalFields) {
      expect(source).toMatch(new RegExp(`'${field}', r\\.${field}`));
    }
    expect(source).toMatch(/rent\.details as rental_details/);
    expect(source).not.toMatch(/coalesce\(rent\.details/);
  });

  it("resolves every child collection (fulfillment, images, vehicle, rental) via its own LEFT JOIN LATERAL against the same locked-down p_listing_id -- one query, one round trip", () => {
    const body = getFunctionBody(source);
    expect(body).toMatch(/\) fm on true/);
    expect(body).toMatch(/\) imgs on true/);
    expect(body).toMatch(/\) veh on true/);
    expect(body).toMatch(/\) rent on true/);
  });
});

describe("0063 architecture / security", () => {
  const source = readFile(MIGRATION_PATH);

  it("adds no direct table SELECT policy on listings/listing_images/listing_fulfillment_methods/listing_vehicle_details/listing_rental_details -- the SECURITY DEFINER function is the sole trusted path", () => {
    expect(source).not.toMatch(/create policy/i);
  });

  it("never uses a service role or admin client", () => {
    expect(source).not.toMatch(/service_role/i);
  });

  it("uses fully schema-qualified references throughout (public.), consistent with the empty search_path", () => {
    const body = getFunctionBody(source);
    expect(body).toMatch(/public\.listings/);
    expect(body).toMatch(/public\.shops/);
    expect(body).toMatch(/public\.listing_images/);
    expect(body).toMatch(/public\.listing_fulfillment_methods/);
    expect(body).toMatch(/public\.listing_vehicle_details/);
    expect(body).toMatch(/public\.listing_rental_details/);
  });
});
