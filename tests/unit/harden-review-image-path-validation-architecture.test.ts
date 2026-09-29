import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

function readFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf-8");
}

const MIGRATION_PATH = "supabase/migrations/0105_harden_review_image_path_validation.sql";
const PRIOR_MIGRATION_PATH = "supabase/migrations/0065_trusted_seller_recalculation.sql";

function getFunctionBody(source: string, anchor: string): string {
  const fnStart = source.indexOf(anchor);
  const bodyStart = source.indexOf("begin\n", fnStart);
  const bodyEnd = source.indexOf("end;\n$$;", bodyStart);
  return source.slice(bodyStart, bodyEnd);
}

/**
 * This migration's own explanatory comments legitimately discuss
 * storage.objects, review-images, and the Storage bucket layout in prose
 * (documenting the rule being added) -- strip `-- ...` line comments
 * before asserting equality/absence, so those tests check actual SQL, not
 * commentary about it. Mirrors 0076's own identical helper.
 */
function stripSqlComments(sql: string): string {
  return sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

const CREATE_ANCHOR = "create or replace function public.create_review(";
const UPDATE_ANCHOR = "create or replace function public.update_review(";

describe("0105 is scoped to create_review/update_review image-path hardening only", () => {
  const source = readFile(MIGRATION_PATH);

  it("creates exactly two functions, create_review and update_review, via CREATE OR REPLACE under their identical existing signatures", () => {
    const matches = source.match(/create or replace function public\.\w+\(/g) ?? [];
    expect(matches).toEqual([
      "create or replace function public.create_review(",
      "create or replace function public.update_review(",
    ]);
    expect(source).toMatch(
      /create or replace function public\.create_review\(p_order_id uuid, p_rating integer, p_body text default null, p_image_paths text\[\] default '\{\}'::text\[\]\)/,
    );
    expect(source).toMatch(
      /create or replace function public\.update_review\(\s*p_review_id uuid,\s*p_rating integer,\s*p_body text default null,\s*p_image_paths text\[\] default '\{\}'::text\[\]\s*\)/,
    );
  });

  it("adds no table, policy, enum, bucket, or storage.objects policy change of any kind", () => {
    expect(source).not.toMatch(/create table|alter table|drop table|create type|alter type|create policy|drop policy|storage\.buckets/i);
  });

  it("adds no table CHECK constraint (a caller-identity check cannot live in one)", () => {
    expect(source).not.toMatch(/add constraint|check \(/i);
  });

  it("never mentions escrow, refund, or payment arbitration", () => {
    expect(source).not.toMatch(/escrow|refund|payment arbitration/i);
  });
});

describe("0105 create_review: hardened image path validation", () => {
  const source = readFile(MIGRATION_PATH);
  const body = getFunctionBody(source, CREATE_ANCHOR);

  it("still caps images at 2, preserving TOO_MANY_REVIEW_IMAGES", () => {
    expect(body).toMatch(/if v_image_count > 2 then/);
    expect(body).toMatch(/'TOO_MANY_REVIEW_IMAGES'/);
  });

  it("builds the prefix as exactly review-images/{auth.uid()}/{p_order_id}/ in that order", () => {
    expect(body).toMatch(
      /v_path_prefix := 'review-images\/' \|\| v_caller::text \|\| '\/' \|\| p_order_id::text \|\| '\/';/,
    );
  });

  it("derives the prefix from v_caller (auth.uid()) and the function's own already-authorized p_order_id, never a client-supplied user/order id", () => {
    const prefixLine = body.match(/v_path_prefix := (.+);/)?.[1] ?? "";
    expect(prefixLine).toMatch(/v_caller::text/);
    expect(prefixLine).toMatch(/p_order_id::text/);
    expect(prefixLine).not.toMatch(/p_uploader|p_user_id|p_owner|p_buyer/);
  });

  it("rejects any path not starting with the exact expected prefix (rejects a foreign user's or a different order's folder, and a cross-bucket path)", () => {
    expect(body).toMatch(/left\(v_path, length\(v_path_prefix\)\) <> v_path_prefix/);
  });

  it("rejects a path with the correct prefix but an empty object-name remainder", () => {
    expect(body).toMatch(/length\(v_path\) = length\(v_path_prefix\)/);
  });

  it("requires a matching storage.objects row scoped to the review-images bucket (rejects a fabricated/nonexistent path)", () => {
    expect(body).toMatch(
      /not exists \(\s*select 1 from storage\.objects so\s*\n\s*where so\.bucket_id = 'review-images'\s*\n\s*and so\.name = substring\(v_path from length\('review-images\/'\) \+ 1\)\s*\n\s*\)/,
    );
  });

  it("still rejects a null path via the same short-circuiting null check", () => {
    expect(body).toMatch(/if v_path is null/);
  });

  it("every per-path rejection uses the existing REVIEW_IMAGE_PATH_INVALID detail -- no new/distinct error code introduced", () => {
    const invalidCodeCount = (stripSqlComments(body).match(/'REVIEW_IMAGE_PATH_INVALID'/g) ?? []).length;
    expect(invalidCodeCount).toBe(1);
    expect(stripSqlComments(body)).not.toMatch(/CROSS_BUCKET|CROSS_USER|CROSS_ORDER|DUPLICATE_REVIEW_IMAGE/);
  });

  it("only computes/checks the prefix when at least one image was submitted (empty-image behavior preserved)", () => {
    const guardIndex = body.indexOf("if v_image_count > 0 then");
    const prefixIndex = body.indexOf("v_path_prefix :=");
    expect(guardIndex).toBeGreaterThan(-1);
    expect(prefixIndex).toBeGreaterThan(guardIndex);
  });
});

describe("0105 update_review: hardened image path validation, including retained images", () => {
  const source = readFile(MIGRATION_PATH);
  const body = getFunctionBody(source, UPDATE_ANCHOR);

  it("still caps images at 2, preserving TOO_MANY_REVIEW_IMAGES", () => {
    expect(body).toMatch(/if v_image_count > 2 then/);
    expect(body).toMatch(/'TOO_MANY_REVIEW_IMAGES'/);
  });

  it("now selects the review's own order_id (previously unused), never trusting p_review_id as the order", () => {
    expect(body).toMatch(
      /select r\.buyer_id, r\.created_at, r\.shop_id, r\.order_id\s*\n\s*into v_review_buyer_id, v_review_created_at, v_review_shop_id, v_review_order_id\s*\n\s*from public\.reviews r/,
    );
  });

  it("builds the prefix as exactly review-images/{auth.uid()}/{the review's own order_id}/ in that order", () => {
    expect(body).toMatch(
      /v_path_prefix := 'review-images\/' \|\| v_caller::text \|\| '\/' \|\| v_review_order_id::text \|\| '\/';/,
    );
  });

  it("derives the prefix from v_caller and v_review_order_id only -- never p_review_id or any p_-prefixed parameter", () => {
    const prefixLine = body.match(/v_path_prefix := (.+);/)?.[1] ?? "";
    expect(prefixLine).toMatch(/v_caller::text/);
    expect(prefixLine).toMatch(/v_review_order_id::text/);
    expect(prefixLine).not.toMatch(/p_review_id|p_order_id/);
  });

  it("rejects any path not starting with the exact expected prefix", () => {
    expect(body).toMatch(/left\(v_path, length\(v_path_prefix\)\) <> v_path_prefix/);
  });

  it("requires a matching storage.objects row scoped to the review-images bucket", () => {
    expect(body).toMatch(
      /not exists \(\s*select 1 from storage\.objects so\s*\n\s*where so\.bucket_id = 'review-images'\s*\n\s*and so\.name = substring\(v_path from length\('review-images\/'\) \+ 1\)\s*\n\s*\)/,
    );
  });

  it("applies the identical rule to a retained existing image: the full image set is re-validated then fully re-inserted, with no separate 'unchanged path' branch", () => {
    const codeOnly = stripSqlComments(body);
    // Exactly one validation loop and exactly one delete+reinsert pair --
    // nothing here distinguishes a path the caller already had from a
    // brand-new one, so a genuinely retained image goes through the same
    // check as any other.
    expect((codeOnly.match(/foreach v_path in array p_image_paths loop/g) ?? []).length).toBe(1);
    expect(codeOnly).toMatch(/delete from public\.review_images as ri where ri\.review_id = p_review_id;/);
    expect(codeOnly).toMatch(/insert into public\.review_images \(review_id, storage_path, sort_order\)/);
  });

  it("only the original review author can reach this validation (unchanged NOT_REVIEW_AUTHOR gate runs first)", () => {
    const authorGateIndex = body.indexOf("'NOT_REVIEW_AUTHOR'");
    const prefixIndex = body.indexOf("v_path_prefix :=");
    expect(authorGateIndex).toBeGreaterThan(-1);
    expect(prefixIndex).toBeGreaterThan(authorGateIndex);
  });

  it("every per-path rejection uses the existing REVIEW_IMAGE_PATH_INVALID detail -- no new/distinct error code introduced", () => {
    const invalidCodeCount = (stripSqlComments(body).match(/'REVIEW_IMAGE_PATH_INVALID'/g) ?? []).length;
    expect(invalidCodeCount).toBe(1);
  });
});

describe("0105 preserves every other create_review/update_review behavior outside the image-path validation block", () => {
  const source = readFile(MIGRATION_PATH);
  const priorSource = readFile(PRIOR_MIGRATION_PATH);

  function stripImageValidationBlock(fnBody: string): string {
    const codeOnly = stripSqlComments(fnBody);
    const start = codeOnly.indexOf("v_image_count := coalesce(array_length(p_image_paths, 1), 0);");
    const end = codeOnly.indexOf("v_now := now();");
    return codeOnly.slice(0, start) + codeOnly.slice(end);
  }

  it("create_review: every statement outside the image-path validation block is unchanged from the prior (0065) definition", () => {
    const body = getFunctionBody(source, CREATE_ANCHOR);
    const priorBody = getFunctionBody(priorSource, CREATE_ANCHOR);
    const strippedNew = stripImageValidationBlock(body).replace(/\s+/g, " ").trim();
    const strippedPrior = stripImageValidationBlock(priorBody).replace(/\s+/g, " ").trim();
    expect(strippedNew).toBe(strippedPrior);
  });

  it("update_review: every statement outside the image-path validation block and the new order_id select is unchanged from the prior (0065) definition", () => {
    const body = getFunctionBody(source, UPDATE_ANCHOR);
    const priorBody = getFunctionBody(priorSource, UPDATE_ANCHOR);

    // The lock-row select gained one extra selected/target column
    // (r.order_id / v_review_order_id) so the validation below has
    // something non-client-supplied to check against -- normalize that
    // one, intentional, additive difference out of both sides before
    // comparing everything else.
    function normalizeLockSelect(codeOnly: string): string {
      return codeOnly.replace(
        /select r\.buyer_id, r\.created_at, r\.shop_id(?:, r\.order_id)?\s*\n\s*into v_review_buyer_id, v_review_created_at, v_review_shop_id(?:, v_review_order_id)?\s*\n\s*from public\.reviews r/,
        "select r.buyer_id, r.created_at, r.shop_id\n    into v_review_buyer_id, v_review_created_at, v_review_shop_id\n    from public.reviews r",
      );
    }

    const strippedNew = normalizeLockSelect(stripImageValidationBlock(body)).replace(/\s+/g, " ").trim();
    const strippedPrior = normalizeLockSelect(stripImageValidationBlock(priorBody)).replace(/\s+/g, " ").trim();
    expect(strippedNew).toBe(strippedPrior);
  });

  it("both functions remain SECURITY DEFINER, empty search_path, granted to authenticated only, under their exact original signatures", () => {
    expect(source).toMatch(
      /create or replace function public\.create_review\([^)]*\)\nreturns table \(review_id uuid, created_at timestamptz\)\nlanguage plpgsql\nsecurity definer\nset search_path = ''/,
    );
    expect(source).toMatch(/revoke all on function public\.create_review\(uuid, integer, text, text\[\]\) from public/);
    expect(source).toMatch(/revoke all on function public\.create_review\(uuid, integer, text, text\[\]\) from anon/);
    expect(source).toMatch(/grant execute on function public\.create_review\(uuid, integer, text, text\[\]\) to authenticated/);

    expect(source).toMatch(/language plpgsql\nsecurity definer\nset search_path = ''\nas \$\$\ndeclare\n  v_caller uuid;\n  v_caller_deleted_at timestamptz;\n  v_review_buyer_id uuid;/);
    expect(source).toMatch(/revoke all on function public\.update_review\(uuid, integer, text, text\[\]\) from public/);
    expect(source).toMatch(/revoke all on function public\.update_review\(uuid, integer, text, text\[\]\) from anon/);
    expect(source).toMatch(/grant execute on function public\.update_review\(uuid, integer, text, text\[\]\) to authenticated/);
  });

  it("both functions still return their exact original shape", () => {
    expect(source).toMatch(/create or replace function public\.create_review\([^)]*\)\nreturns table \(review_id uuid, created_at timestamptz\)/);
    expect(source).toMatch(/returns table \(\s*review_id uuid,\s*updated_at timestamptz\s*\)/);
  });
});

describe("0105 does not require any frontend change", () => {
  it("ReviewImagePicker already uploads to exactly the prefix this migration now requires", () => {
    const picker = readFile("components/orders/ReviewImagePicker.tsx");
    expect(picker).toMatch(/uploadImage\("review-images", buyerId, orderId, file/);
  });

  it("uploadImage already builds {ownerUserId}/{entityId}/{randomFileName} under the caller's own auth.uid()-enforced folder, and returns the bucket-prefixed path this migration now validates", () => {
    const uploadImage = readFile("lib/image-processing/upload-image.ts");
    expect(uploadImage).toMatch(/const path = `\$\{ownerUserId\}\/\$\{entityId\}\/\$\{randomFileName\(\)\}`;/);
    expect(uploadImage).toMatch(/return \{ ok: true, path: `\$\{bucket\}\/\$\{path\}` \};/);
  });
});
