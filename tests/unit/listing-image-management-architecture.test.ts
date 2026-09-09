import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

function readFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf-8");
}

const MIGRATION_PATH = "supabase/migrations/0060_listing_image_management_rpc.sql";

/** The function body only. */
function getFunctionBody(source: string): string {
  const start = source.lastIndexOf("begin\n");
  const end = source.lastIndexOf("end;\n$$;");
  return source.slice(start, end);
}

describe("0060 is scoped to replace_listing_images only", () => {
  const source = readFile(MIGRATION_PATH);

  it("creates exactly one function, replace_listing_images -- no schema/enum/policy change, no new image column", () => {
    expect(source).toMatch(/create or replace function public\.replace_listing_images\s*\(/);
    expect(source).not.toMatch(/create table|alter table|drop table/i);
    expect(source).not.toMatch(/create type|alter type/i);
    expect(source).not.toMatch(/create policy|alter policy|drop policy|create index|drop index/i);
    expect(source).not.toMatch(/add column|create table.*image/i);
    expect(source).not.toMatch(/create or replace function public\.update_listing\b/i);
  });

  it("never references orders/order_items/inventory_reservations", () => {
    expect(source).not.toMatch(/\bpublic\.orders\b/);
    expect(source).not.toMatch(/\bpublic\.order_items\b/);
    expect(source).not.toMatch(/\bpublic\.inventory_reservations\b/);
  });

  it("is SECURITY DEFINER with an empty search_path, granted to authenticated only", () => {
    expect(source).toMatch(/security definer/i);
    expect(source).toMatch(/set search_path = ''/);
    expect(source).toMatch(/revoke all on function public\.replace_listing_images\(uuid, text\[\], boolean\[\]\) from public/i);
    expect(source).toMatch(/revoke all on function public\.replace_listing_images\(uuid, text\[\], boolean\[\]\) from anon/i);
    expect(source).toMatch(/grant execute on function public\.replace_listing_images\(uuid, text\[\], boolean\[\]\) to authenticated/i);
    expect(source).not.toMatch(/grant execute on function public\.replace_listing_images\(uuid, text\[\], boolean\[\]\) to anon/i);
  });

  it("locks the listing row FOR UPDATE before touching listing_images -- the universal serialization point", () => {
    const body = getFunctionBody(source);
    expect(body).toMatch(/from public\.listings l\s*\n\s*where l\.id = p_listing_id\s*\n\s*for update;/);
    const lockIndex = body.indexOf("for update;");
    const firstImageWriteIndex = body.indexOf("delete from public.listing_images");
    expect(firstImageWriteIndex).toBeGreaterThan(lockIndex);
  });
});

describe("0060 chosen design: one whole-set replace, not four fine-grained RPCs", () => {
  const source = readFile(MIGRATION_PATH);

  it("documents the design choice and its atomicity/race rationale in the migration header", () => {
    expect(source).toMatch(/RPC design choice/i);
    expect(source).toMatch(/atomic/i);
    expect(source).toMatch(/race/i);
  });

  it("does not define separate add_listing_image/remove_listing_image/reorder RPCs", () => {
    expect(source).not.toMatch(/create or replace function public\.(add|remove|reorder)_listing_image/i);
  });
});

describe("0060 auth / ownership / draft-only gating", () => {
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

  it("rejects image edits on anything that is not currently draft", () => {
    expect(source).toMatch(/if v_listing_status <> 'draft' then\s*\n\s*raise exception 'Only draft listings can be edited with this operation\.' using detail = 'LISTING_NOT_DRAFT';/);
  });
});

describe("0060 image count: 0-8, no requirement while draft", () => {
  const source = readFile(MIGRATION_PATH);

  it("never rejects zero images -- a draft may be saved with no photos", () => {
    const body = getFunctionBody(source);
    expect(body).not.toMatch(/IMAGE_REQUIRED/);
  });

  it("rejects more than 8 images", () => {
    expect(source).toMatch(/if v_image_count > 8 then\s*\n\s*raise exception 'A listing may have at most 8 photos\.' using detail = 'TOO_MANY_LISTING_IMAGES';/);
  });

  it("does not enforce the Pre-loved/Brand-New actual-vs-reference publish rules here -- that remains publish_listing's job", () => {
    const body = getFunctionBody(source);
    expect(body).not.toMatch(/REFERENCE_IMAGES_NOT_ALLOWED_FOR_PRELOVED/);
    expect(body).not.toMatch(/BRAND_NEW_REQUIRES_ACTUAL_IMAGE/);
  });
});

describe("0060 storage path ownership + structural validity", () => {
  const source = readFile(MIGRATION_PATH);

  it("validates every path belongs to the caller via the same prefix check as create_listing", () => {
    expect(source).toMatch(/v_path !~ \('\^listing-images\/' \|\| v_caller::text \|\| '\/'\)/);
    expect(source).toMatch(/LISTING_IMAGE_PATH_INVALID/);
  });

  it("rejects a null or blank path", () => {
    expect(source).toMatch(/v_path is null\s*\n\s*or v_path !~ '\[\^\[:space:\]\]'/);
  });
});

describe("0060 no duplicate image paths within the same listing", () => {
  const source = readFile(MIGRATION_PATH);

  it("rejects the same path submitted more than once in a single call", () => {
    expect(source).toMatch(/v_image_count <> \(select count\(distinct p\) from unnest\(p_image_paths\) p\)/);
    expect(source).toMatch(/DUPLICATE_LISTING_IMAGE_PATH/);
  });
});

describe("0060 reference_flags array must match the image path array in length", () => {
  const source = readFile(MIGRATION_PATH);

  it("rejects a reference_flags array of a different length than the image paths", () => {
    expect(source).toMatch(/if v_flag_count <> v_image_count then/);
    expect(source).toMatch(/IMAGE_ARRAYS_LENGTH_MISMATCH/);
  });

  it("defaults every image to is_reference_image = false when p_reference_flags is not supplied", () => {
    expect(source).toMatch(/v_reference_flags := array_fill\(false, array\[v_image_count\]\);/);
  });

  it("uses the existing is_reference_image column, does not invent a new one", () => {
    expect(source).toMatch(/is_reference_image/);
    expect(source).not.toMatch(/add column.*reference/i);
  });
});

describe("0060 atomic whole-set replace: contiguous positions, deterministic cover", () => {
  const source = readFile(MIGRATION_PATH);

  it("deletes the entire existing image set before inserting the new one", () => {
    expect(source).toMatch(/delete from public\.listing_images where listing_id = p_listing_id;/);
  });

  it("assigns position as the array index (i - 1), guaranteeing contiguous 0..N-1 by construction", () => {
    expect(source).toMatch(/for i in 1\.\.v_image_count loop\s*\n\s*insert into public\.listing_images \(listing_id, storage_path, position, is_reference_image\)\s*\n\s*values \(p_listing_id, p_image_paths\[i\], i - 1, coalesce\(v_reference_flags\[i\], false\)\);/);
  });

  it("sets cover_image_id to the position-0 image's id when at least one image exists", () => {
    expect(source).toMatch(/select li\.id into v_cover_image_id\s*\n\s*from public\.listing_images li\s*\n\s*where li\.listing_id = p_listing_id and li\.position = 0;/);
  });

  it("sets cover_image_id to null when zero images remain", () => {
    expect(source).toMatch(/else\s*\n\s*v_cover_image_id := null;\s*\n\s*end if;/);
  });

  it("always writes the resolved cover_image_id back onto the listing row, even when it is null", () => {
    expect(source).toMatch(/update public\.listings as l\s*\n\s*set cover_image_id = v_cover_image_id\s*\n\s*where l\.id = p_listing_id;/);
  });
});

describe("0060 remains atomic, no order/order_item writes", () => {
  const source = readFile(MIGRATION_PATH);

  it("every write stays inside one function body, no explicit COMMIT", () => {
    const body = getFunctionBody(source);
    expect(body).toMatch(/delete from public\.listing_images/);
    expect(body).toMatch(/update public\.listings as l/);
    expect(body).not.toMatch(/\bcommit\b/i);
  });

  it("returns listing_id, the final image_count, and the resolved cover_image_id", () => {
    expect(source).toMatch(/select p_listing_id, v_image_count, v_cover_image_id;/);
  });
});
