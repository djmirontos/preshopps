import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

function readFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf-8");
}

const MIGRATION_PATH = "supabase/migrations/0085_fix_replace_listing_images_ambiguity.sql";
const PRIOR_MIGRATION_PATH = "supabase/migrations/0082_harden_anonymized_account_mutations.sql";

/** The function body only -- excludes header prose and grants, matching
 * the convention already used by 0060's and 0079's own architecture
 * tests. */
function getFunctionBody(source: string): string {
  const start = source.indexOf("create or replace function public.replace_listing_images");
  const end = source.indexOf("$$;", start) + "$$;".length;
  return source.slice(start, end);
}

/** Extracts just replace_listing_images's own function definition out of
 * 0082, which defines several functions in one file. */
function get0082ReplaceListingImagesDef(): string {
  const source = readFile(PRIOR_MIGRATION_PATH);
  const start = source.indexOf("create or replace function public.replace_listing_images");
  const end = source.indexOf("$$;", start) + "$$;".length;
  return source.slice(start, end);
}

describe("0085 fixes the replace_listing_images ambiguity, nothing else", () => {
  const source = readFile(MIGRATION_PATH);
  const body = getFunctionBody(source);

  it("defines exactly one function, replace_listing_images -- no schema/enum/policy change, no other RPC touched", () => {
    const createStatements = source.match(/create or replace function/g) ?? [];
    expect(createStatements).toHaveLength(1);
    expect(source).toMatch(/create or replace function public\.replace_listing_images\s*\(/);
    expect(source).not.toMatch(/create or replace function public\.(create_listing|update_listing|publish_listing|update_listing_status|get_my_listing)\b/);
    expect(source).not.toMatch(/create table|alter table|drop table/i);
    expect(source).not.toMatch(/create type|alter type/i);
    expect(source).not.toMatch(/create policy|alter policy|drop policy|create index|drop index/i);
  });

  it("no longer contains the bare, ambiguous 'where listing_id = p_listing_id' reference", () => {
    expect(body).not.toMatch(/delete from public\.listing_images\s+where listing_id = p_listing_id;/);
  });

  it("qualifies the fixed DELETE with an explicit table alias", () => {
    expect(body).toMatch(/delete from public\.listing_images as li where li\.listing_id = p_listing_id;/);
  });
});

describe("0085 preserves the exact live signature and return shape", () => {
  const source = readFile(MIGRATION_PATH);

  it("keeps the exact parameter list and defaults", () => {
    expect(source).toMatch(
      /create or replace function public\.replace_listing_images\(p_listing_id uuid, p_image_paths text\[\] default '\{\}'::text\[\], p_reference_flags boolean\[\] default null::boolean\[\]\)/,
    );
  });

  it("keeps the exact RETURNS TABLE shape: listing_id, image_count, cover_image_id", () => {
    expect(source).toMatch(/returns table\(listing_id uuid, image_count integer, cover_image_id uuid\)/);
  });

  it("keeps the final return query shape unchanged", () => {
    expect(source).toMatch(/return query\s*\n\s*select p_listing_id, v_image_count, v_cover_image_id;/);
  });
});

describe("0085 preserves SECURITY DEFINER, search_path, and grants exactly", () => {
  const source = readFile(MIGRATION_PATH);

  it("is SECURITY DEFINER with an empty search_path", () => {
    expect(source).toMatch(/security definer/i);
    expect(source).toMatch(/set search_path = ''/);
  });

  it("keeps the identical revoke/grant set: authenticated only, no anon/public", () => {
    expect(source).toMatch(/revoke all on function public\.replace_listing_images\(uuid, text\[\], boolean\[\]\) from public/i);
    expect(source).toMatch(/revoke all on function public\.replace_listing_images\(uuid, text\[\], boolean\[\]\) from anon/i);
    expect(source).toMatch(/grant execute on function public\.replace_listing_images\(uuid, text\[\], boolean\[\]\) to authenticated/i);
    expect(source).not.toMatch(/grant execute on function public\.replace_listing_images\(uuid, text\[\], boolean\[\]\) to anon/i);
  });
});

describe("0085 preserves every existing auth/ownership/business check unchanged", () => {
  const source = readFile(MIGRATION_PATH);

  it("requires auth.uid() (NOT_AUTHENTICATED)", () => {
    expect(source).toMatch(/v_caller := auth\.uid\(\);/);
    expect(source).toMatch(/'Authentication required\.' using detail = 'NOT_AUTHENTICATED'/);
  });

  it("blocks a deleted/anonymized caller via profiles.deleted_at (INTERACTION_BLOCKED)", () => {
    expect(source).toMatch(/select p\.deleted_at into v_caller_deleted_at\s*\n\s*from public\.profiles p\s*\n\s*where p\.id = v_caller;/);
    expect(source).toMatch(/if not found or v_caller_deleted_at is not null then\s*\n\s*raise exception 'Account is not available\.' using detail = 'INTERACTION_BLOCKED';/);
  });

  it("blocks seller_suspended/account_suspended restricted sellers (INTERACTION_BLOCKED)", () => {
    expect(source).toMatch(/restriction_type in \('seller_suspended', 'account_suspended'\)/);
    expect(source).toMatch(/'You are not able to edit listings right now\.' using detail = 'INTERACTION_BLOCKED'/);
  });

  it("distinguishes listing-not-found from not-your-listing", () => {
    expect(source).toMatch(/'Listing not found\.' using detail = 'LISTING_NOT_FOUND'/);
    expect(source).toMatch(/if v_listing_shop_id <> v_shop_id then\s*\n\s*raise exception 'You do not have permission to edit this listing\.' using detail = 'NOT_LISTING_OWNER';/);
  });

  it("rejects edits on anything that is not currently draft (LISTING_NOT_DRAFT)", () => {
    expect(source).toMatch(/if v_listing_status <> 'draft' then\s*\n\s*raise exception 'Only draft listings can be edited with this operation\.' using detail = 'LISTING_NOT_DRAFT';/);
  });

  it("still rejects more than 8 images (TOO_MANY_LISTING_IMAGES)", () => {
    expect(source).toMatch(/if v_image_count > 8 then\s*\n\s*raise exception 'A listing may have at most 8 photos\.' using detail = 'TOO_MANY_LISTING_IMAGES';/);
  });

  it("still validates every path's caller-prefix ownership (LISTING_IMAGE_PATH_INVALID)", () => {
    expect(source).toMatch(/v_path !~ \('\^listing-images\/' \|\| v_caller::text \|\| '\/'\)/);
    expect(source).toMatch(/LISTING_IMAGE_PATH_INVALID/);
  });

  it("still rejects duplicate paths within the same call (DUPLICATE_LISTING_IMAGE_PATH)", () => {
    expect(source).toMatch(/v_image_count <> \(select count\(distinct p\) from unnest\(p_image_paths\) p\)/);
    expect(source).toMatch(/DUPLICATE_LISTING_IMAGE_PATH/);
  });

  it("still enforces the reference_flags length match (IMAGE_ARRAYS_LENGTH_MISMATCH)", () => {
    expect(source).toMatch(/if v_flag_count <> v_image_count then/);
    expect(source).toMatch(/IMAGE_ARRAYS_LENGTH_MISMATCH/);
  });

  it("still assigns contiguous 0..N-1 positions and a deterministic cover image", () => {
    expect(source).toMatch(/for i in 1\.\.v_image_count loop\s*\n\s*insert into public\.listing_images \(listing_id, storage_path, position, is_reference_image\)\s*\n\s*values \(p_listing_id, p_image_paths\[i\], i - 1, coalesce\(v_reference_flags\[i\], false\)\);/);
    expect(source).toMatch(/select li\.id into v_cover_image_id\s*\n\s*from public\.listing_images li\s*\n\s*where li\.listing_id = p_listing_id and li\.position = 0;/);
    expect(source).toMatch(/update public\.listings as l\s*\n\s*set cover_image_id = v_cover_image_id\s*\n\s*where l\.id = p_listing_id;/);
  });
});

describe("0085's function body is identical to the live 0082 definition except for the one fixed statement", () => {
  it("differs from 0082's replace_listing_images only in the DELETE alias qualification", () => {
    const oldDef = get0082ReplaceListingImagesDef();
    const newDef = getFunctionBody(readFile(MIGRATION_PATH));

    const oldNormalized = oldDef.replace(
      "delete from public.listing_images where listing_id = p_listing_id;",
      "delete from public.listing_images as li where li.listing_id = p_listing_id;",
    );

    expect(newDef).toBe(oldNormalized);
  });
});

describe("0085 does not touch update_listing, even though it has the same bug class", () => {
  const source = readFile(MIGRATION_PATH);

  it("never defines or replaces update_listing", () => {
    expect(source).not.toMatch(/create or replace function public\.update_listing\b/);
  });
});
