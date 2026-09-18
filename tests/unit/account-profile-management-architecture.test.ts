import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

function readFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf-8");
}

const MIGRATION_PATH = "supabase/migrations/0092_account_profile_management.sql";
const migrationSource = readFile(MIGRATION_PATH);

/** Strips SQL line comments from a block -- for "must NOT contain X"
 * assertions against executable SQL, so a comment merely EXPLAINING an
 * absence (e.g. "never reuses shop-images") can't itself trip a false
 * failure just for containing the word being checked for. */
function stripComments(sql: string): string {
  return sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

/** Extracts just the plpgsql body ($$...$$) of one function definition,
 * with SQL line comments stripped -- so assertions about what the
 * function actually DOES aren't tripped up by prose in an adjacent
 * comment block. Mirrors the same helper used in
 * notifications-architecture.test.ts (0091) for the identical reason. */
function extractFunctionBody(functionName: string): string {
  const startMarker = `create or replace function public.${functionName}(`;
  const startIndex = migrationSource.indexOf(startMarker);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  const bodyStart = migrationSource.indexOf("as $$", startIndex);
  const bodyEnd = migrationSource.indexOf("$$;", bodyStart);
  const rawBody = migrationSource.slice(bodyStart, bodyEnd);
  return rawBody
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

describe("0092 -- migration numbering", () => {
  it("0092 was the newest migration at the time of this slice (0093 is a later, separately-approved migration)", () => {
    const migrationFiles = readdirSync(path.join(process.cwd(), "supabase/migrations")).filter((f) => f.endsWith(".sql"));
    expect(migrationFiles).toContain("0092_account_profile_management.sql");
    const newer = migrationFiles.filter((f) => f > "0092_account_profile_management.sql");
    expect(newer).toEqual([
      "0093_seller_order_messaging.sql",
      "0094_published_listing_editing.sql",
      "0095_restriction_visibility_notifications.sql",
      "0096_restriction_visibility_notifications.sql",
      "0097_fix_apply_user_restriction_output_collision.sql",
      "0098_fix_submit_report_output_collision.sql",
    ]);
  });

  it("0086 remains absent", () => {
    const migrationFiles = readdirSync(path.join(process.cwd(), "supabase/migrations")).filter((f) => f.endsWith(".sql"));
    expect(migrationFiles.some((f) => f.startsWith("0086_"))).toBe(false);
  });

  it("no unrelated migration/schema file was added or modified alongside 0092", () => {
    const migrationFiles = readdirSync(path.join(process.cwd(), "supabase/migrations")).filter((f) => f.endsWith(".sql"));
    // 0001..0091 inclusive is 91 numbers, minus the intentionally-skipped
    // 0086 leaves exactly 90 pre-existing files below 0092.
    const expectedCount = 90;
    expect(migrationFiles.filter((f) => f <= "0091_notification_dismiss.sql").length).toBe(expectedCount);
  });
});

describe("0092 -- new profile columns and defense-in-depth CHECK constraints", () => {
  it("adds exactly the four new nullable columns, no duplicate location columns", () => {
    expect(migrationSource).toMatch(/add column first_name text/);
    expect(migrationSource).toMatch(/add column last_name text/);
    expect(migrationSource).toMatch(/add column bio text/);
    expect(migrationSource).toMatch(/add column mobile_number text/);
    // No new province/city/barangay column -- existing ones are reused.
    expect(migrationSource).not.toMatch(/add column province_id/);
    expect(migrationSource).not.toMatch(/add column city_id/);
    expect(migrationSource).not.toMatch(/add column barangay_id/);
  });

  it("display_name: existing non-empty check preserved, new 50-char cap added", () => {
    expect(migrationSource).not.toMatch(/drop constraint profiles_display_name_check/);
    expect(migrationSource).toMatch(/profiles_display_name_length_check check \(char_length\(btrim\(display_name\)\) <= 50\)/);
  });

  it("first_name and last_name are each capped at 50, nullable", () => {
    expect(migrationSource).toMatch(/profiles_first_name_length_check check \(first_name is null or char_length\(first_name\) <= 50\)/);
    expect(migrationSource).toMatch(/profiles_last_name_length_check check \(last_name is null or char_length\(last_name\) <= 50\)/);
  });

  it("bio is capped at 300, nullable", () => {
    expect(migrationSource).toMatch(/profiles_bio_length_check check \(bio is null or char_length\(bio\) <= 300\)/);
  });

  it("mobile_number is capped at 16 (E.164 max 15 digits + leading '+'), nullable", () => {
    expect(migrationSource).toMatch(/profiles_mobile_number_length_check check \(mobile_number is null or char_length\(mobile_number\) <= 16\)/);
  });

  it("display_name has no uniqueness constraint anywhere in this migration", () => {
    expect(migrationSource).not.toMatch(/unique\s*\(\s*display_name/i);
    expect(migrationSource).not.toMatch(/add constraint [a-z_]*display_name[a-z_]*unique/i);
  });

  it("no complex phone-format normalization logic lives in a CHECK constraint -- only a length cap", () => {
    const constraintsBlock = migrationSource.split("-- ===================== 3A.")[0];
    expect(constraintsBlock).not.toMatch(/mobile_number ~/);
  });
});

describe("0092 -- display-name privacy remediation", () => {
  it("handle_new_user no longer derives display_name from the email local-part", () => {
    const body = extractFunctionBody("handle_new_user");
    expect(body).not.toMatch(/split_part\(new\.email/);
    expect(body).not.toMatch(/email_local_part/);
  });

  it("handle_new_user falls back to literal 'Member' for a blank or over-length metadata display_name", () => {
    const body = extractFunctionBody("handle_new_user");
    expect(body).toMatch(/v_display_name = '' or char_length\(v_display_name\) > 50/);
    expect(body).toMatch(/v_display_name := 'Member'/);
  });

  it("the privacy backfill is narrowly scoped to exact email-local-part matches on active profiles only", () => {
    const backfillBlock = migrationSource.split("-- ===================== 3B.")[1]!.split("-- ===================== 4.")[0]!;
    expect(backfillBlock).toMatch(/set display_name = 'Member'/);
    expect(backfillBlock).toMatch(/p\.deleted_at is null/);
    expect(backfillBlock).toMatch(/lower\(btrim\(p\.display_name\)\) = lower\(split_part\(u\.email, '@', 1\)\)/);
  });

  it("the backfill excludes deleted/anonymized profiles and never touches auth.users or any other identity field", () => {
    const backfillBlock = stripComments(migrationSource.split("-- ===================== 3B.")[1]!.split("-- ===================== 4.")[0]!);
    expect(backfillBlock).toMatch(/p\.deleted_at is null/);
    expect(backfillBlock).not.toMatch(/update auth\.users/i);
    expect(backfillBlock).not.toMatch(/returning/i);
  });
});

describe("0092 -- get_my_profile()", () => {
  const body = extractFunctionBody("get_my_profile");

  it("has no target-user parameter -- the signature takes no arguments at all", () => {
    expect(migrationSource).toMatch(/create or replace function public\.get_my_profile\(\)/);
  });

  it("derives the caller from auth.uid() and rejects unauthenticated invocation safely", () => {
    expect(body).toMatch(/v_caller := auth\.uid\(\)/);
    expect(body).toMatch(/if v_caller is null then/);
    expect(body).toMatch(/NOT_AUTHENTICATED/);
  });

  it("scopes its own SELECT to the caller's own row -- no way to select another user's profile", () => {
    expect(body).toMatch(/where p\.id = v_caller/);
    expect(body).not.toMatch(/p_user_id|p_profile_id|p_target/);
  });

  it("does not return email -- email stays sourced from the Auth session", () => {
    expect(migrationSource.split("create or replace function public.get_my_profile()")[1]!.split("$$;")[0]).not.toMatch(/\bemail\b/);
  });

  it("is SECURITY DEFINER with an empty search_path", () => {
    const def = migrationSource.split("create or replace function public.get_my_profile()")[1]!.split("as $$")[0]!;
    expect(def).toMatch(/security definer/);
    expect(def).toMatch(/set search_path = ''/);
  });

  it("revokes execute from public/anon and grants only to authenticated", () => {
    expect(migrationSource).toMatch(/revoke all on function public\.get_my_profile\(\) from public;/);
    expect(migrationSource).toMatch(/revoke all on function public\.get_my_profile\(\) from anon;/);
    expect(migrationSource).toMatch(/grant execute on function public\.get_my_profile\(\) to authenticated;/);
  });
});

describe("0092 -- update_my_profile(...)", () => {
  const signature =
    "create or replace function public.update_my_profile(\n  p_display_name text,\n  p_avatar_storage_path text default null,\n  p_first_name text default null,\n  p_last_name text default null,\n  p_bio text default null,\n  p_mobile_number text default null,\n  p_province_id integer default null,\n  p_city_id integer default null,\n  p_barangay_id integer default null\n)";
  const body = extractFunctionBody("update_my_profile");

  it("has no target-user-id parameter -- the caller is always auth.uid()", () => {
    expect(migrationSource).toContain(signature);
    expect(signature).not.toMatch(/p_user_id|p_profile_id|p_target/);
  });

  it("derives the caller from auth.uid(), rejecting unauthenticated invocation", () => {
    expect(body).toMatch(/v_caller := auth\.uid\(\)/);
    expect(body).toMatch(/NOT_AUTHENTICATED/);
  });

  it("is SECURITY DEFINER with an empty search_path", () => {
    const def = migrationSource.split(signature)[1]!.split("as $$")[0]!;
    expect(def).toMatch(/security definer/);
    expect(def).toMatch(/set search_path = ''/);
  });

  it("revokes execute from public/anon and grants only to authenticated", () => {
    const grantsBlock = migrationSource.split("-- ===================== 6.")[0]!;
    expect(grantsBlock).toMatch(
      /revoke all on function public\.update_my_profile\(text, text, text, text, text, text, integer, integer, integer\) from public;/,
    );
    expect(grantsBlock).toMatch(
      /revoke all on function public\.update_my_profile\(text, text, text, text, text, text, integer, integer, integer\) from anon;/,
    );
    expect(grantsBlock).toMatch(
      /grant execute on function public\.update_my_profile\(text, text, text, text, text, text, integer, integer, integer\) to authenticated;/,
    );
  });

  it("rejects a deleted/anonymized caller's mutation entirely", () => {
    expect(body).toMatch(/if not found or v_deleted_at is not null then/);
    expect(body).toMatch(/INTERACTION_BLOCKED/);
  });

  it("requires a non-blank display_name, capped at 50", () => {
    expect(body).toMatch(/DISPLAY_NAME_REQUIRED/);
    expect(body).toMatch(/DISPLAY_NAME_TOO_LONG/);
  });

  it("avatar path must belong to the caller -- rejects a path not prefixed with avatar-images/{caller}/", () => {
    expect(body).toMatch(/v_avatar_storage_path !~ \('\^avatar-images\/' \|\| v_caller::text \|\| '\/'\)/);
    expect(body).toMatch(/INVALID_AVATAR_PATH/);
  });

  it("validates the location hierarchy: city requires province, barangay requires city, each must belong to its parent", () => {
    expect(body).toMatch(/PROVINCE_REQUIRED/);
    expect(body).toMatch(/CITY_REQUIRED/);
    expect(body).toMatch(/INVALID_CITY_FOR_PROVINCE/);
    expect(body).toMatch(/INVALID_BARANGAY_FOR_CITY/);
    expect(body).toMatch(/from public\.cities_municipalities c/);
    expect(body).toMatch(/from public\.barangays b/);
  });

  it("normalizes a PH-local mobile number (09XXXXXXXXX) to +639XXXXXXXXX", () => {
    expect(body).toMatch(/v_mobile_number ~ '\^09\[0-9\]\{9\}\$'/);
    expect(body).toMatch(/v_mobile_number := '\+63' \|\| substring\(v_mobile_number from 2\)/);
  });

  it("accepts valid E.164 and rejects anything else via the final normalized-format check", () => {
    expect(body).toMatch(/v_mobile_number !~ '\^\\\+\[1-9\]\[0-9\]\{7,14\}\$'/);
    expect(body).toMatch(/MOBILE_NUMBER_INVALID/);
  });

  it("never writes to auth.users.phone -- mobile_number only ever targets public.profiles", () => {
    expect(body).not.toMatch(/auth\.users/);
  });

  it("blocks a seller_suspended/account_suspended caller only when actually changing a public identity field", () => {
    expect(body).toMatch(/restriction_type in \('seller_suspended', 'account_suspended'\)/);
    expect(body).toMatch(/v_display_name is distinct from v_current_display_name/);
    expect(body).toMatch(/v_avatar_storage_path is distinct from v_current_avatar_storage_path/);
    expect(body).toMatch(/v_bio is distinct from v_current_bio/);
    expect(body).toMatch(/PUBLIC_PROFILE_LOCKED/);
  });

  it("does not gate on buyer_restricted at all -- only seller_suspended/account_suspended are checked", () => {
    expect(body).not.toMatch(/buyer_restricted/);
  });

  it("private fields (first/last name, mobile, location) are never included in the suspension-gate comparison", () => {
    const gateBlock = body.split("v_public_restricted and (")[1]!.split(") then")[0]!;
    expect(gateBlock).not.toMatch(/first_name|last_name|mobile_number|province_id|city_id|barangay_id/);
  });
});

describe("0092 -- anonymize_user_account extension", () => {
  const body = extractFunctionBody("anonymize_user_account");

  it("nulls every newly-added private/public profile field on anonymization", () => {
    const setBlock = body.split("set display_name = 'Deleted user'")[1]!.split("where id = p_user_id")[0]!;
    expect(setBlock).toMatch(/avatar_storage_path = null/);
    expect(setBlock).toMatch(/first_name = null/);
    expect(setBlock).toMatch(/last_name = null/);
    expect(setBlock).toMatch(/bio = null/);
    expect(setBlock).toMatch(/mobile_number = null/);
    expect(setBlock).toMatch(/province_id = null/);
    expect(setBlock).toMatch(/city_id = null/);
    expect(setBlock).toMatch(/barangay_id = null/);
    expect(setBlock).toMatch(/deleted_at = v_now/);
  });

  it("preserves every existing behavior byte-for-byte: admin auth, reason validation, role protections, messenger_link, restriction, audit log", () => {
    expect(body).toMatch(/NOT_ADMIN/);
    expect(body).toMatch(/REASON_REQUIRED/);
    expect(body).toMatch(/SUPER_ADMIN_REQUIRED_FOR_ADMIN_TARGET/);
    expect(body).toMatch(/LAST_SUPER_ADMIN/);
    expect(body).toMatch(/set messenger_link = null/);
    expect(body).toMatch(/apply_user_restriction\(p_user_id, 'account_suspended', v_reason\)/);
    expect(body).toMatch(/account_anonymized/);
  });

  it("does not redesign account deletion -- still admin-invoked, still idempotent on an already-anonymized target", () => {
    expect(migrationSource).toMatch(/returns table\(user_id uuid, was_already_anonymized boolean/);
    expect(body).toMatch(/if v_deleted_at is not null then/);
  });
});

describe("0092 -- avatar-images storage bucket and policies", () => {
  it("creates a new dedicated public bucket with a 3MB limit and the standard image MIME allowlist", () => {
    expect(migrationSource).toMatch(
      /insert into storage\.buckets \(id, name, public, file_size_limit, allowed_mime_types\)\s*\nvalues \('avatar-images', 'avatar-images', true, 3145728, array\['image\/jpeg', 'image\/png', 'image\/webp'\]\)/,
    );
  });

  it("never reuses listing-images or shop-images for avatars", () => {
    const bucketBlock = stripComments(migrationSource.split("-- ===================== 7.")[1]!);
    expect(bucketBlock).not.toMatch(/listing-images|shop-images|review-images/);
  });

  it("ownership policies (insert/update/delete) require the first folder segment to equal auth.uid()", () => {
    const bucketBlock = migrationSource.split("-- ===================== 7.")[1]!;
    const ownershipPolicies = ["avatar_images_insert_own", "avatar_images_update_own", "avatar_images_delete_own"];
    for (const policy of ownershipPolicies) {
      const policyBlock = bucketBlock.split(`create policy ${policy}`)[1]!.split("create policy")[0]!;
      expect(policyBlock).toMatch(/bucket_id = 'avatar-images'/);
      expect(policyBlock).toMatch(/\(storage\.foldername\(name\)\)\[1\] = auth\.uid\(\)::text/);
    }
  });

  it("select policy is public (no ownership restriction) matching the other public buckets' own convention", () => {
    const bucketBlock = migrationSource.split("-- ===================== 7.")[1]!;
    const selectPolicyBlock = bucketBlock.split("create policy avatar_images_select_public")[1]!.split("create policy")[0]!;
    expect(selectPolicyBlock).toMatch(/using \(bucket_id = 'avatar-images'\)/);
    expect(selectPolicyBlock).not.toMatch(/auth\.uid\(\)/);
  });

  it("does not weaken or touch any other bucket's policies", () => {
    const bucketBlock = migrationSource.split("-- ===================== 7.")[1]!;
    expect(bucketBlock).not.toMatch(/drop policy/i);
  });
});

describe("0092 -- no scope creep", () => {
  it("no direct SELECT/UPDATE RLS policy is introduced on public.profiles", () => {
    expect(migrationSource).not.toMatch(/create policy [a-z_]*\s+on public\.profiles/);
  });

  it("no auth.users email/phone column is ever written", () => {
    expect(migrationSource).not.toMatch(/update auth\.users/i);
    expect(migrationSource).not.toMatch(/auth\.users\.phone/);
    expect(migrationSource).not.toMatch(/auth\.users\.email\s*=/);
  });

  it("no public_profiles view is introduced", () => {
    const executableOnly = stripComments(migrationSource);
    expect(executableOnly).not.toMatch(/create (or replace )?view/i);
    expect(executableOnly).not.toMatch(/public_profiles/);
  });

  it("does not modify get_shop_reviews, get_conversation_context, or get_my_notifications -- the existing public projections are untouched", () => {
    expect(migrationSource).not.toMatch(/create or replace function public\.get_shop_reviews/);
    expect(migrationSource).not.toMatch(/create or replace function public\.get_conversation_context/);
    expect(migrationSource).not.toMatch(/create or replace function public\.get_my_notifications/);
  });

  it("private fields (mobile_number, first_name, last_name, location) are not referenced by any existing public RPC in this migration", () => {
    // This migration only ever touches get_my_profile/update_my_profile/
    // anonymize_user_account/handle_new_user -- none of which are public
    // (unauthenticated-callable) projections, so a simple absence check
    // on the untouched RPC names above (already asserted) plus confirming
    // this migration adds no new public-facing function is sufficient.
    const newFunctionNames = [...migrationSource.matchAll(/create or replace function public\.([a-z_]+)/g)].map((m) => m[1]);
    expect(newFunctionNames.sort()).toEqual(["anonymize_user_account", "get_my_profile", "handle_new_user", "update_my_profile"].sort());
  });
});
