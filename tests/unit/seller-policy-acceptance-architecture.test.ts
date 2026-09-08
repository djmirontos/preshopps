import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

function readFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf-8");
}

const MIGRATION_PATH = "supabase/migrations/0058_seller_policy_acceptance.sql";

/** Slices out one function's body ("begin\n" .. "end;\n$$;") starting the
 * search from a given anchor, so accept_seller_policies and
 * publish_listing (which share the same begin/end token shape) can each be
 * isolated without one matching inside the other. */
function getFunctionBody(source: string, anchor: string): string {
  const fnStart = source.indexOf(anchor);
  const bodyStart = source.indexOf("begin\n", fnStart);
  const bodyEnd = source.indexOf("end;\n$$;", bodyStart);
  return source.slice(bodyStart, bodyEnd);
}

/** Everything from the first real statement onward -- excludes the file's
 * header comment block, which legitimately discusses things that do NOT
 * exist (e.g. "no default", "No p_user_id/p_profile_id parameter exists",
 * "not only the seller's first listing") and would otherwise false-positive
 * a plain substring/regex absence check against the whole file. */
function getCodeOnly(source: string): string {
  // lastIndexOf, not indexOf: the header comment itself quotes the upcoming
  // ALTER TABLE statement inline (in backticks) while explaining the schema
  // change -- indexOf would anchor on that quote instead of the real
  // statement. The real, executable "alter table profiles" is the final
  // occurrence in the file.
  return source.slice(source.lastIndexOf("alter table profiles"));
}

const ACCEPT_ANCHOR = "create or replace function public.accept_seller_policies()";
const PUBLISH_ANCHOR = "create or replace function public.publish_listing(";

describe("0058 is scoped to the seller policy-acceptance gap only", () => {
  const source = readFile(MIGRATION_PATH);

  it("adds exactly one nullable profiles column -- no other schema/enum/policy change", () => {
    const alterStart = source.lastIndexOf("alter table profiles");
    const alterStatement = source.slice(alterStart, source.indexOf(";", alterStart) + 1);
    expect(alterStatement).toMatch(/alter table profiles\s*\n\s*add column seller_policies_accepted_at timestamptz;/);
    expect(alterStatement).not.toMatch(/not null/i);
    expect(alterStatement).not.toMatch(/default/i);
    expect(source).not.toMatch(/create table|drop table|drop column/i);
    expect(source).not.toMatch(/create type|alter type/i);
    expect(source).not.toMatch(/create policy|alter policy|drop policy|create index|drop index/i);
  });

  it("does not add a boolean duplicate or a policy-version/audit-metadata column", () => {
    expect(source).not.toMatch(/seller_policies_accepted\b(?!\_at)/); // no bare boolean-named column
    expect(source).not.toMatch(/policy_version|accepted_ip|accepted_user_agent|policy_acceptances/i);
  });

  it("does not touch signup Terms of Use / Privacy Policy acceptance", () => {
    expect(source).not.toMatch(/terms_accepted|privacy_accepted|terms_of_use|privacy_policy/i);
  });

  it("creates exactly two functions: accept_seller_policies and publish_listing -- no update_listing/pause/resume/archive/mark-sold", () => {
    expect(source).toMatch(/create or replace function public\.accept_seller_policies\s*\(\s*\)/);
    expect(source).toMatch(/create or replace function public\.publish_listing\s*\(/);
    expect(source).not.toMatch(/create or replace function public\.update_listing/i);
    expect(source).not.toMatch(/create or replace function public\.(pause|resume|archive)_listing/i);
  });

  it("never references orders/order_items/inventory_reservations anywhere", () => {
    expect(source).not.toMatch(/\bpublic\.orders\b/);
    expect(source).not.toMatch(/\bpublic\.order_items\b/);
    expect(source).not.toMatch(/\bpublic\.inventory_reservations\b/);
  });
});

describe("0058 does not edit 0057 -- CREATE OR REPLACE under the identical signature", () => {
  const source = readFile(MIGRATION_PATH);

  it("publish_listing keeps the exact same single-parameter signature as 0057 (no DROP FUNCTION needed)", () => {
    expect(source).not.toMatch(/drop function/i);
    const signature = source.slice(source.indexOf(PUBLISH_ANCHOR), source.indexOf("returns table", source.indexOf(PUBLISH_ANCHOR)));
    expect(signature).toMatch(/p_listing_id uuid/);
    expect(signature).not.toMatch(/p_status|p_shop_id|p_owner_id|p_accepted_at/);
  });
});

describe("0058 accept_seller_policies: auth, identity, idempotency", () => {
  const source = readFile(MIGRATION_PATH);
  const body = getFunctionBody(source, ACCEPT_ANCHOR);

  it("takes no parameters", () => {
    const signature = source.slice(source.indexOf(ACCEPT_ANCHOR), source.indexOf("returns table", source.indexOf(ACCEPT_ANCHOR)));
    expect(signature).toMatch(/accept_seller_policies\s*\(\s*\)/);
  });

  it("requires auth.uid() (NOT_AUTHENTICATED)", () => {
    expect(body).toMatch(/v_caller := auth\.uid\(\);/);
    expect(body).toMatch(/'Authentication required\.' using detail = 'NOT_AUTHENTICATED'/);
  });

  it("derives identity exclusively from auth.uid() -- never accepts a user/profile id parameter", () => {
    expect(getCodeOnly(source)).not.toMatch(/p_user_id|p_profile_id|p_caller_id/);
  });

  it("requires the caller's profile to exist (PROFILE_NOT_FOUND)", () => {
    expect(body).toMatch(/if not found then\s*\n\s*raise exception 'Profile not found\.' using detail = 'PROFILE_NOT_FOUND';/);
  });

  it("locks the profile row FOR UPDATE before reading it", () => {
    expect(body).toMatch(/where p\.id = v_caller\s*\n\s*for update;/);
  });

  it("is idempotent: sets accepted_at to now() only when currently null", () => {
    expect(body).toMatch(/if v_accepted_at is null then\s*\n\s*v_accepted_at := now\(\);/);
  });

  it("preserves the original timestamp when already accepted -- the UPDATE only runs inside the null branch", () => {
    const nullBranchStart = body.indexOf("if v_accepted_at is null then");
    const updateIndex = body.indexOf("update public.profiles");
    const endIfIndex = body.indexOf("end if;", nullBranchStart);
    expect(updateIndex).toBeGreaterThan(nullBranchStart);
    expect(updateIndex).toBeLessThan(endIfIndex);
  });

  it("never accepts a client-supplied timestamp -- the only value ever written is this function's own now()", () => {
    expect(getCodeOnly(source)).not.toMatch(/p_accepted_at/);
  });

  it("returns the acceptance timestamp", () => {
    expect(body).toMatch(/return query\s*\n\s*select v_accepted_at;/);
  });

  it("is SECURITY DEFINER with an empty search_path, granted to authenticated only", () => {
    expect(source).toMatch(/security definer/i);
    expect(source).toMatch(/revoke all on function public\.accept_seller_policies\(\) from public/i);
    expect(source).toMatch(/revoke all on function public\.accept_seller_policies\(\) from anon/i);
    expect(source).toMatch(/grant execute on function public\.accept_seller_policies\(\) to authenticated/i);
    expect(source).not.toMatch(/grant execute on function public\.accept_seller_policies\(\) to anon/i);
  });
});

describe("0058 publish_listing: seller-policy gate placement and behavior", () => {
  const source = readFile(MIGRATION_PATH);
  const body = getFunctionBody(source, PUBLISH_ANCHOR);

  it("checks seller_policies_accepted_at on every call -- not only a detected 'first listing'", () => {
    expect(body).toMatch(/select p\.seller_policies_accepted_at into v_seller_policies_accepted_at/);
    expect(getCodeOnly(source)).not.toMatch(/first.listing|is_first_listing|has_published_before/i);
  });

  it("blocks publish with SELLER_POLICIES_NOT_ACCEPTED when the value is null", () => {
    expect(body).toMatch(/if v_seller_policies_accepted_at is null then\s*\n\s*raise exception 'You must accept the Marketplace Rules and Prohibited Items Policy before publishing\.' using detail = 'SELLER_POLICIES_NOT_ACCEPTED';/);
  });

  it("allows the publish path to continue past the gate when the value is non-null (no early return, falls through to completeness checks)", () => {
    const gateIndex = body.indexOf("SELLER_POLICIES_NOT_ACCEPTED");
    const titleCheckIndex = body.indexOf("TITLE_REQUIRED");
    expect(titleCheckIndex).toBeGreaterThan(gateIndex);
  });

  it("is placed after auth/shop/restriction/ownership/draft-status checks and before the completeness validation block", () => {
    const restrictionIndex = body.indexOf("INTERACTION_BLOCKED");
    const draftStatusIndex = body.indexOf("LISTING_NOT_DRAFT");
    const gateIndex = body.indexOf("SELLER_POLICIES_NOT_ACCEPTED");
    const titleCheckIndex = body.indexOf("TITLE_REQUIRED");
    expect(gateIndex).toBeGreaterThan(restrictionIndex);
    expect(gateIndex).toBeGreaterThan(draftStatusIndex);
    expect(gateIndex).toBeLessThan(titleCheckIndex);
  });
});

describe("0058 preserves every other 0057 rule unchanged", () => {
  const source = readFile(MIGRATION_PATH);
  const body = getFunctionBody(source, PUBLISH_ANCHOR);

  it("still auth/shop/restriction/ownership/draft-only gated exactly as 0057", () => {
    expect(body).toMatch(/'Authentication required\.' using detail = 'NOT_AUTHENTICATED'/);
    expect(body).toMatch(/'Create your shop first\.' using detail = 'SHOP_NOT_FOUND'/);
    expect(body).toMatch(/restriction_type in \('seller_suspended', 'account_suspended'\)/);
    expect(body).not.toMatch(/buyer_restricted/);
    expect(body).toMatch(/'Listing not found\.' using detail = 'LISTING_NOT_FOUND'/);
    expect(body).toMatch(/'You do not have permission to publish this listing\.' using detail = 'NOT_LISTING_OWNER'/);
    expect(body).toMatch(/'Only draft listings can be published\.' using detail = 'LISTING_NOT_DRAFT'/);
  });

  it("still validates full publish completeness (title, description, category, type/condition, known flaws, price, stock, location)", () => {
    expect(body).toMatch(/TITLE_REQUIRED/);
    expect(body).toMatch(/DESCRIPTION_REQUIRED/);
    expect(body).toMatch(/CATEGORY_REQUIRED/);
    expect(body).toMatch(/LISTING_TYPE_REQUIRED/);
    expect(body).toMatch(/CONDITION_REQUIRED/);
    expect(body).toMatch(/LISTING_TYPE_CONDITION_MISMATCH/);
    expect(body).toMatch(/KNOWN_FLAWS_REQUIRED/);
    expect(body).toMatch(/PRICE_REQUIRED/);
    expect(body).toMatch(/STOCK_QUANTITY_INVALID/);
    expect(body).toMatch(/PROVINCE_REQUIRED/);
    expect(body).toMatch(/CITY_REQUIRED/);
  });

  it("still requires fulfillment methods unless the category is inquiry-only", () => {
    expect(body).toMatch(/select c\.is_inquiry_only into v_category_is_inquiry_only/);
    expect(body).toMatch(/if not coalesce\(v_category_is_inquiry_only, false\) and v_fulfillment_count = 0 then/);
    expect(body).toMatch(/FULFILLMENT_REQUIRED/);
  });

  it("still enforces 1-8 images and the Pre-loved/Brand-New actual-vs-reference rules", () => {
    expect(body).toMatch(/IMAGE_REQUIRED/);
    expect(body).toMatch(/TOO_MANY_LISTING_IMAGES/);
    expect(body).toMatch(/REFERENCE_IMAGES_NOT_ALLOWED_FOR_PRELOVED/);
    expect(body).toMatch(/BRAND_NEW_REQUIRES_ACTUAL_IMAGE/);
  });

  it("still transitions draft -> available only, never touches reserved_quantity, sets published_at once", () => {
    expect(body).toMatch(/set status = 'available',\s*\n\s*published_at = v_now/);
    expect(body).not.toMatch(/reserved_quantity/);
  });

  it("still locks the listing row FOR UPDATE", () => {
    expect(body).toMatch(/from public\.listings l\s*\n\s*where l\.id = p_listing_id\s*\n\s*for update;/);
  });

  it("still SECURITY DEFINER, empty search_path, authenticated-only grant", () => {
    expect(source).toMatch(/security definer/i);
    expect(source).toMatch(/revoke all on function public\.publish_listing\(uuid\) from public/i);
    expect(source).toMatch(/revoke all on function public\.publish_listing\(uuid\) from anon/i);
    expect(source).toMatch(/grant execute on function public\.publish_listing\(uuid\) to authenticated/i);
  });

  it("remains atomic -- no explicit COMMIT, the whole call is one implicit transaction", () => {
    expect(body).not.toMatch(/\bcommit\b/i);
  });
});
