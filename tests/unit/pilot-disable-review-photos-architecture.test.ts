import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

function readFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf-8");
}

const MIGRATION_PATH = "supabase/migrations/0118_pilot_disable_new_review_photos.sql";

function getFunctionBody(source: string, anchor: string): string {
  const fnStart = source.indexOf(anchor);
  const bodyStart = source.indexOf("begin\n", fnStart);
  const bodyEnd = source.indexOf("end;\n$$;", bodyStart);
  return source.slice(bodyStart, bodyEnd);
}

/**
 * This migration's own explanatory header comment legitimately discusses
 * storage.objects and moderation in prose (documenting the rule being
 * superseded, and explicitly disclaiming that no moderation is built) --
 * strip `-- ...` line comments before asserting their absence from actual
 * SQL. Mirrors 0105's and 0076's own identical helper.
 */
function stripSqlComments(sql: string): string {
  return sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

const CREATE_ANCHOR = "create or replace function public.create_review(";
const UPDATE_ANCHOR = "create or replace function public.update_review(";

describe("0118 is scoped to create_review/update_review photo-attachment restriction only", () => {
  const source = readFile(MIGRATION_PATH);

  it("redefines exactly two functions, create_review and update_review, via CREATE OR REPLACE under their identical existing signatures", () => {
    const matches = source.match(/create or replace function public\.\w+\(/g) ?? [];
    expect(matches).toEqual([
      "create or replace function public.create_review(",
      "create or replace function public.update_review(",
    ]);
  });

  it("adds no table, policy, enum, bucket, or storage.objects policy change of any kind", () => {
    expect(source).not.toMatch(/create table|alter table|drop table|create type|alter type|create policy|drop policy|storage\.buckets/i);
  });

  it("deletes no review, review_images, or Storage object -- this is a future-write restriction only", () => {
    const codeOnly = stripSqlComments(source);
    expect(codeOnly).not.toMatch(/delete from public\.reviews\b/);
    expect(codeOnly).not.toMatch(/storage\.objects/);
    // The one existing delete+reinsert pair in update_review (atomic
    // image-set replacement) predates this migration unchanged -- confirm
    // it is still scoped to exactly the caller's own already-validated set.
    expect(codeOnly).toMatch(/delete from public\.review_images as ri where ri\.review_id = p_review_id;/);
  });

  it("builds no new image moderation (content review/approval), escrow, refund, or payment arbitration -- the only 'moderation' text present is update_review's own pre-existing, inherited-unchanged REVIEW_REMOVED error message from 0117", () => {
    const codeOnly = stripSqlComments(source);
    const matches = codeOnly.match(/moderat\w*|escrow|refund|payment arbitration/gi) ?? [];
    for (const match of matches) {
      expect(match.toLowerCase()).toBe("moderation");
    }
    expect(codeOnly).not.toMatch(/escrow|refund|payment arbitration/i);
    expect(codeOnly).toContain("This review was removed by moderation.");
  });

  it("both functions remain SECURITY DEFINER, empty search_path, granted to authenticated only, under their exact original signatures", () => {
    expect(source).toMatch(
      /create or replace function public\.create_review\(p_order_id uuid, p_rating integer, p_body text default null, p_image_paths text\[\] default '\{\}'::text\[\]\)\nreturns table \(review_id uuid, created_at timestamptz\)\nlanguage plpgsql\nsecurity definer\nset search_path = ''/,
    );
    expect(source).toMatch(/revoke all on function public\.create_review\(uuid, integer, text, text\[\]\) from public/);
    expect(source).toMatch(/revoke all on function public\.create_review\(uuid, integer, text, text\[\]\) from anon/);
    expect(source).toMatch(/grant execute on function public\.create_review\(uuid, integer, text, text\[\]\) to authenticated/);

    expect(source).toMatch(
      /create or replace function public\.update_review\(\s*p_review_id uuid,\s*p_rating integer,\s*p_body text default null,\s*p_image_paths text\[\] default '\{\}'::text\[\]\s*\)\nreturns table \(\s*review_id uuid,\s*updated_at timestamptz\s*\)\nlanguage plpgsql\nsecurity definer\nset search_path = ''/,
    );
    expect(source).toMatch(/revoke all on function public\.update_review\(uuid, integer, text, text\[\]\) from public/);
    expect(source).toMatch(/revoke all on function public\.update_review\(uuid, integer, text, text\[\]\) from anon/);
    expect(source).toMatch(/grant execute on function public\.update_review\(uuid, integer, text, text\[\]\) to authenticated/);
  });

  it("both functions still return their exact original shape", () => {
    expect(source).toMatch(/returns table \(review_id uuid, created_at timestamptz\)/);
    expect(source).toMatch(/returns table \(\s*review_id uuid,\s*updated_at timestamptz\s*\)/);
  });
});

describe("0118 create_review: any non-empty photo set is rejected outright", () => {
  const source = readFile(MIGRATION_PATH);
  const body = getFunctionBody(source, CREATE_ANCHOR);

  it("still caps images at 2 before the disablement check, preserving TOO_MANY_REVIEW_IMAGES", () => {
    const tooManyIndex = body.indexOf("'TOO_MANY_REVIEW_IMAGES'");
    const disabledIndex = body.indexOf("'REVIEW_IMAGES_DISABLED'");
    expect(tooManyIndex).toBeGreaterThan(-1);
    expect(disabledIndex).toBeGreaterThan(tooManyIndex);
  });

  it("rejects any v_image_count > 0 with REVIEW_IMAGES_DISABLED -- there is no legitimate 'existing photo' case for a brand-new review", () => {
    expect(body).toMatch(/if v_image_count > 0 then\s*\n\s*raise exception 'Photo uploads are temporarily unavailable for reviews\.' using detail = 'REVIEW_IMAGES_DISABLED';/);
  });

  it("no longer validates a per-path prefix or storage.objects existence -- that branch is unreachable now that any non-empty array is rejected first", () => {
    expect(body).not.toMatch(/foreach v_path in array p_image_paths loop/);
    expect(body).not.toMatch(/'REVIEW_IMAGE_PATH_INVALID'/);
  });

  it("every other validation (auth, deleted account, order lock/ownership/status, one-review-per-order, peer block, admin restriction, rating, body) is unchanged from 0105", () => {
    for (const fragment of [
      "v_caller := auth.uid();",
      "'NOT_AUTHENTICATED'",
      "'INTERACTION_BLOCKED'",
      "for update;",
      "'ORDER_NOT_FOUND'",
      "'NOT_ORDER_BUYER'",
      "'ORDER_NOT_REVIEWABLE'",
      "'REVIEW_ALREADY_EXISTS'",
      "'RATING_INVALID'",
      "'REVIEW_BODY_TOO_LONG'",
    ]) {
      expect(body).toContain(fragment);
    }
  });

  it("still inserts the review and recalculates Trusted Seller exactly as before", () => {
    expect(body).toMatch(/insert into public\.reviews as r/);
    expect(body).toMatch(/perform public\.recalculate_trusted_seller\(v_order_shop_id\);/);
  });
});

describe("0118 update_review: only a review's own already-attached photos may be resubmitted", () => {
  const source = readFile(MIGRATION_PATH);
  const body = getFunctionBody(source, UPDATE_ANCHOR);

  it("still caps images at 2, preserving TOO_MANY_REVIEW_IMAGES", () => {
    expect(body).toMatch(/if v_image_count > 2 then/);
    expect(body).toMatch(/'TOO_MANY_REVIEW_IMAGES'/);
  });

  it("checks each submitted path against public.review_images scoped to this exact p_review_id -- not a prefix or a cross-review check", () => {
    expect(body).toMatch(
      /not exists \(\s*select 1 from public\.review_images ri\s*\n\s*where ri\.review_id = p_review_id\s*\n\s*and ri\.storage_path = v_path\s*\n\s*\)/,
    );
  });

  it("rejects a null path via the same short-circuiting null check, and any non-membership path with REVIEW_IMAGES_DISABLED", () => {
    expect(body).toMatch(/if v_path is null\s*\n\s*or not exists/);
    expect(body).toMatch(/raise exception 'Photo uploads are temporarily unavailable for reviews\.' using detail = 'REVIEW_IMAGES_DISABLED';/);
  });

  it("no longer validates a per-path prefix or storage.objects existence -- replaced by the review_images-membership rule", () => {
    expect(body).not.toMatch(/v_path_prefix/);
    expect(body).not.toMatch(/storage\.objects/);
    expect(body).not.toMatch(/'REVIEW_IMAGE_PATH_INVALID'/);
  });

  it("preserves the 0117 removed-by-moderation guard ahead of the image check, and the 7-day edit window", () => {
    const removedIndex = body.indexOf("'REVIEW_REMOVED'");
    const windowIndex = body.indexOf("'REVIEW_EDIT_WINDOW_CLOSED'");
    const imagesIndex = body.indexOf("'REVIEW_IMAGES_DISABLED'");
    expect(removedIndex).toBeGreaterThan(-1);
    expect(windowIndex).toBeGreaterThan(removedIndex);
    expect(imagesIndex).toBeGreaterThan(windowIndex);
  });

  it("re-validates the review's own order_id selection is still present (unused by the new rule, but left intact rather than dropped)", () => {
    expect(body).toMatch(
      /select r\.buyer_id, r\.created_at, r\.shop_id, r\.order_id, r\.removed_at\s*\n\s*into v_review_buyer_id, v_review_created_at, v_review_shop_id, v_review_order_id, v_review_removed_at\s*\n\s*from public\.reviews r/,
    );
  });

  it("the full image set is still re-validated then fully re-inserted on every call -- exactly one validation loop, one delete+reinsert pair", () => {
    expect((body.match(/foreach v_path in array p_image_paths loop/g) ?? []).length).toBe(1);
    expect(body).toMatch(/delete from public\.review_images as ri where ri\.review_id = p_review_id;/);
    expect(body).toMatch(/insert into public\.review_images \(review_id, storage_path, sort_order\)/);
  });

  it("still updates rating/body and recalculates Trusted Seller exactly as before", () => {
    expect(body).toMatch(/set rating = p_rating,\s*\n\s*body = v_body,/);
    expect(body).toMatch(/perform public\.recalculate_trusted_seller\(v_review_shop_id\);/);
  });
});
