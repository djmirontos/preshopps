import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

function readFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf-8");
}

const MIGRATION_PATH = "supabase/migrations/0076_harden_dispute_image_paths.sql";
const PRIOR_MIGRATION_PATH = "supabase/migrations/0074_dispute_rpcs.sql";

function getFunctionBody(source: string, anchor: string): string {
  const fnStart = source.indexOf(anchor);
  const bodyStart = source.indexOf("begin\n", fnStart);
  const bodyEnd = source.indexOf("end;\n$$;", bodyStart);
  return source.slice(bodyStart, bodyEnd);
}

/**
 * This migration's own explanatory comments legitimately discuss
 * `storage.objects` and signed URLs in prose (documenting what was
 * deliberately NOT added) -- strip `-- ...` line comments before asserting
 * absence, so those tests check actual SQL, not commentary about it.
 */
function stripSqlComments(sql: string): string {
  return sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

const CREATE_ANCHOR = "create or replace function public.create_dispute(";

describe("0076 is scoped to create_dispute image-path hardening only", () => {
  const source = readFile(MIGRATION_PATH);

  it("creates exactly one function: create_dispute, via CREATE OR REPLACE under the identical signature", () => {
    const matches = source.match(/create or replace function public\.\w+\(/g) ?? [];
    expect(matches).toEqual(["create or replace function public.create_dispute("]);
    expect(source).toMatch(
      /create or replace function public\.create_dispute\(\s*p_order_id uuid,\s*p_reason text,\s*p_explanation text,\s*p_image_paths text\[\] default '\{\}'::text\[\]\s*\)/,
    );
  });

  it("adds no table, policy, enum, or storage change of any kind", () => {
    expect(source).not.toMatch(/create table|alter table|drop table|create type|alter type|create policy|storage\.buckets/i);
  });

  it("does not touch signed-URL generation or storage.objects existence checking", () => {
    const codeOnly = stripSqlComments(source);
    expect(codeOnly).not.toMatch(/storage\.objects/);
    expect(codeOnly).not.toMatch(/createSignedUrl/);
  });

  it("never mentions escrow, refund, or payment arbitration", () => {
    expect(source).not.toMatch(/escrow|refund|payment arbitration/i);
  });
});

describe("0076 create_dispute: hardened image path validation", () => {
  const source = readFile(MIGRATION_PATH);
  const body = getFunctionBody(source, CREATE_ANCHOR);

  it("still caps images at 3, preserving TOO_MANY_DISPUTE_IMAGES", () => {
    expect(body).toMatch(/if v_image_count > 3 then/);
    expect(body).toMatch(/'TOO_MANY_DISPUTE_IMAGES'/);
  });

  it("still rejects a blank/whitespace-only path string, preserving DISPUTE_IMAGE_PATH_INVALID", () => {
    expect(body).toMatch(/if v_path is null or v_path !~ '\[\^\[:space:\]\]' then/);
    expect(body).toMatch(/raise exception 'One or more dispute image paths are invalid\.' using detail = 'DISPUTE_IMAGE_PATH_INVALID';/);
  });

  it("derives the expected prefix from auth.uid() (v_caller), never a client-supplied id", () => {
    const prefixLine = body.match(/v_expected_prefix := (.+);/)?.[1] ?? "";
    expect(prefixLine).toMatch(/v_caller::text/);
    expect(prefixLine).not.toMatch(/p_uploader|p_user_id|p_owner/);
  });

  it("derives the expected prefix from p_order_id, the function's own already-authorized parameter", () => {
    const prefixLine = body.match(/v_expected_prefix := (.+);/)?.[1] ?? "";
    expect(prefixLine).toMatch(/p_order_id::text/);
  });

  it("anchors the prefix to the dispute-images bucket literally", () => {
    const prefixLine = body.match(/v_expected_prefix := (.+);/)?.[1] ?? "";
    expect(prefixLine).toMatch(/'dispute-images\/'/);
  });

  it("builds the prefix as exactly dispute-images/{auth.uid()}/{p_order_id}/ in that order", () => {
    expect(body).toMatch(
      /v_expected_prefix := 'dispute-images\/' \|\| v_caller::text \|\| '\/' \|\| p_order_id::text \|\| '\/';/,
    );
  });

  it("rejects any path not starting with the exact expected prefix (rejects a foreign user's folder)", () => {
    expect(body).toMatch(/if left\(v_path, char_length\(v_expected_prefix\)\) <> v_expected_prefix then/);
  });

  it("rejects a path scoped to a different order id (same prefix-mismatch branch, no separate order-id special case)", () => {
    // The prefix embeds p_order_id verbatim, so any path naming a different
    // order id necessarily fails the same left()-prefix comparison above --
    // there is exactly one prefix-mismatch branch, not a bucket-only check
    // plus a separate order-id check.
    const prefixMismatchBranches = body.match(/if left\(v_path, char_length\(v_expected_prefix\)\) <> v_expected_prefix then/g) ?? [];
    expect(prefixMismatchBranches).toHaveLength(1);
  });

  it("rejects a path with the correct prefix but an empty filename/path remainder", () => {
    expect(body).toMatch(/if char_length\(v_path\) <= char_length\(v_expected_prefix\) then/);
    expect(body).toMatch(/raise exception 'One or more dispute image paths are invalid\.' using detail = 'DISPUTE_IMAGE_PATH_INVALID';\s*\n\s*end if;\s*\n\s*end loop;/);
  });

  it("all three per-path rejections use the same DISPUTE_IMAGE_PATH_INVALID code (no existence-oracle-shaped distinction)", () => {
    const invalidCodeCount = (body.match(/'DISPUTE_IMAGE_PATH_INVALID'/g) ?? []).length;
    expect(invalidCodeCount).toBe(3);
  });

  it("rejects duplicate paths in the same submission with a dedicated DUPLICATE_DISPUTE_IMAGE_PATH code", () => {
    expect(body).toMatch(/if \(select count\(distinct u\) from unnest\(p_image_paths\) as u\) <> v_image_count then/);
    expect(body).toMatch(/'DUPLICATE_DISPUTE_IMAGE_PATH'/);
  });

  it("performs the duplicate check after per-path validation, only when at least one image was submitted", () => {
    const imageBlockStart = body.indexOf("v_image_count := coalesce(array_length(p_image_paths, 1), 0);");
    const loopIndex = body.indexOf("foreach v_path in array p_image_paths loop", imageBlockStart);
    const duplicateIndex = body.indexOf("'DUPLICATE_DISPUTE_IMAGE_PATH'", imageBlockStart);
    expect(loopIndex).toBeGreaterThan(-1);
    expect(duplicateIndex).toBeGreaterThan(loopIndex);
  });

  it("does not introduce a storage.objects existence check", () => {
    expect(stripSqlComments(body)).not.toMatch(/storage\.objects/);
  });
});

describe("0076 preserves every other create_dispute behavior byte-for-byte in meaning", () => {
  const source = readFile(MIGRATION_PATH);
  const body = getFunctionBody(source, CREATE_ANCHOR);
  const priorSource = readFile(PRIOR_MIGRATION_PATH);
  const priorBody = getFunctionBody(priorSource, CREATE_ANCHOR);

  it("requires authentication and a non-deleted account, unchanged", () => {
    expect(body).toMatch(/'Authentication required\.' using detail = 'NOT_AUTHENTICATED'/);
    expect(body).toMatch(/'INTERACTION_BLOCKED'/);
  });

  it("still locks the order row before any decision, universal serialization point", () => {
    expect(body).toMatch(/from public\.orders o\s*\n\s*where o\.id = p_order_id\s*\n\s*for update;/);
  });

  it("still rejects a caller who is neither the buyer nor the shop owner", () => {
    expect(body).toMatch(/if v_caller <> v_order_buyer_id and v_caller <> v_shop_owner_id then/);
    expect(body).toMatch(/'NOT_ORDER_PARTICIPANT'/);
  });

  it("still restricts eligibility to exactly accepted/ready/handed_over_or_shipped/received_confirmed", () => {
    expect(body).toMatch(
      /if v_order_status not in \('accepted', 'ready', 'handed_over_or_shipped', 'received_confirmed'\) then/,
    );
    expect(body).toMatch(/'ORDER_NOT_DISPUTABLE'/);
  });

  it("still guards duplicate-active-dispute before insert, and catches unique_violation as a final guard", () => {
    expect(body).toMatch(/if exists \(select 1 from public\.disputes d where d\.order_id = p_order_id and d\.status <> 'resolved'\) then/);
    expect(body).toMatch(/'DISPUTE_ALREADY_ACTIVE'/);
    expect(body).toMatch(/exception\s*\n\s*when unique_violation then\s*\n\s*raise exception 'A dispute is already open for this order\.' using detail = 'DISPUTE_ALREADY_ACTIVE';/);
  });

  it("still validates reason (<=200) and explanation (<=2000) as required, non-blank text", () => {
    expect(body).toMatch(/'DISPUTE_REASON_REQUIRED'/);
    expect(body).toMatch(/'DISPUTE_REASON_TOO_LONG'/);
    expect(body).toMatch(/char_length\(v_reason\) > 200/);
    expect(body).toMatch(/'DISPUTE_EXPLANATION_REQUIRED'/);
    expect(body).toMatch(/'DISPUTE_EXPLANATION_TOO_LONG'/);
    expect(body).toMatch(/char_length\(v_explanation\) > 2000/);
  });

  it("still transitions the order to 'disputed' transactionally, preserving the real from_status", () => {
    expect(body).toMatch(/v_from_status := v_order_status;/);
    expect(body).toMatch(/update public\.orders\s*\n\s*set status = 'disputed',\s*\n\s*disputed_at = v_now\s*\n\s*where id = p_order_id;/);
    expect(body).toMatch(/insert into public\.order_status_history \(order_id, from_status, to_status, changed_by, note\)\s*\n\s*values \(p_order_id, v_from_status, 'disputed', v_caller, null\);/);
  });

  it("still never touches order_items or inventory_reservations", () => {
    expect(body).not.toMatch(/public\.order_items|public\.inventory_reservations/);
  });

  it("still writes the dispute's own status timeline row: null -> opened", () => {
    expect(body).toMatch(/insert into public\.dispute_status_history \(dispute_id, from_status, to_status, changed_by\)\s*\n\s*values \(v_dispute_id, null, 'opened', v_caller\);/);
  });

  it("still inserts one dispute_images row per submitted path, in array order", () => {
    expect(body).toMatch(/for i in 1\.\.v_image_count loop\s*\n\s*insert into public\.dispute_images \(dispute_id, storage_path\)\s*\n\s*values \(v_dispute_id, p_image_paths\[i\]\);/);
  });

  it("still notifies only the other participant, never the opener themself, with dispute_opened", () => {
    expect(body).toMatch(/v_recipient_id := case when v_caller = v_order_buyer_id then v_shop_owner_id else v_order_buyer_id end;/);
    expect(body).toMatch(/select v_recipient_id, 'dispute_opened', v_caller, p_order_id, v_dispute_id::text \|\| ':opened'/);
  });

  it("still returns exactly (dispute_id, created_at)", () => {
    expect(source).toMatch(/returns table \(\s*dispute_id uuid,\s*created_at timestamptz\s*\)/);
    expect(body).toMatch(/return query\s*\n\s*select v_dispute_id, v_created_at;/);
  });

  it("is still SECURITY DEFINER, empty search_path, granted to authenticated only", () => {
    expect(source).toMatch(/language plpgsql\s*\nsecurity definer\s*\nset search_path = ''/);
    expect(source).toMatch(/revoke all on function public\.create_dispute\(uuid, text, text, text\[\]\) from public/);
    expect(source).toMatch(/revoke all on function public\.create_dispute\(uuid, text, text, text\[\]\) from anon/);
    expect(source).toMatch(/grant execute on function public\.create_dispute\(uuid, text, text, text\[\]\) to authenticated/);
  });

  it("every statement outside the image-path validation block is functionally unchanged from 0074 (comments may be reworded, code may not)", () => {
    // Strip comments (this migration deliberately adds/rewords explanatory
    // comments -- that's documentation, not behavior), then strip both
    // bodies down to the code outside their respective image path
    // validation blocks, and compare the remaining executable SQL.
    function stripImageValidationBlock(fnBody: string): string {
      const codeOnly = stripSqlComments(fnBody);
      const start = codeOnly.indexOf("v_image_count := coalesce(array_length(p_image_paths, 1), 0);");
      const end = codeOnly.indexOf("v_from_status := v_order_status;");
      return codeOnly.slice(0, start) + codeOnly.slice(end);
    }

    const strippedNew = stripImageValidationBlock(body).replace(/\s+/g, " ").trim();
    const strippedPrior = stripImageValidationBlock(priorBody).replace(/\s+/g, " ").trim();
    expect(strippedNew).toBe(strippedPrior);
  });
});

describe("0076 does not require any frontend change", () => {
  it("DisputeImagePicker already uploads to exactly the prefix this migration now requires", () => {
    const picker = readFile("components/disputes/DisputeImagePicker.tsx");
    expect(picker).toMatch(/uploadImage\("dispute-images", uploaderUserId, orderId, file/);
  });

  it("uploadImage already builds {ownerUserId}/{entityId}/{randomFileName} under the caller's own auth.uid()-enforced folder", () => {
    const uploadImage = readFile("lib/image-processing/upload-image.ts");
    expect(uploadImage).toMatch(/const path = `\$\{ownerUserId\}\/\$\{entityId\}\/\$\{randomFileName\(\)\}`;/);
  });
});
