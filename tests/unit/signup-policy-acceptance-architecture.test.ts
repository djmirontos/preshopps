import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

function readFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf-8");
}

const MIGRATION_PATH = "supabase/migrations/0071_signup_policy_acceptance.sql";

const FN_ANCHOR = "create or replace function public.handle_new_user()";

function getFunctionBody(source: string): string {
  const fnStart = source.indexOf(FN_ANCHOR);
  const bodyStart = source.indexOf("begin\n", fnStart);
  const bodyEnd = source.indexOf("end;\n$$;", bodyStart);
  return source.slice(bodyStart, bodyEnd);
}

/** Everything from the real ALTER TABLE statement onward -- excludes the
 * header comment block, which legitimately discusses things that do NOT
 * exist in code (e.g. "no versioning", "no backfill") and would otherwise
 * false-positive a plain substring/regex absence check against the whole
 * file, mirroring 0058's own test convention. */
function getCodeOnly(source: string): string {
  return source.slice(source.lastIndexOf("alter table public.profiles"));
}

describe("0071 is scoped to the signup Terms of Use / Privacy Policy acceptance gap only", () => {
  const source = readFile(MIGRATION_PATH);

  it("adds exactly two nullable profiles columns -- no default, no not null, no other schema/enum/policy change", () => {
    const alterStart = source.lastIndexOf("alter table public.profiles");
    const alterStatement = source.slice(alterStart, source.indexOf(";", alterStart) + 1);
    expect(alterStatement).toMatch(/add column terms_accepted_at timestamptz,\s*\n\s*add column privacy_accepted_at timestamptz;/);
    expect(alterStatement).not.toMatch(/not null/i);
    expect(alterStatement).not.toMatch(/default/i);
    expect(source).not.toMatch(/create table|drop table|drop column/i);
    expect(source).not.toMatch(/create type|alter type/i);
    expect(source).not.toMatch(/create policy|alter policy|drop policy|create index|drop index/i);
  });

  it("does not collapse the two policies into one combined column, unlike 0058's seller-policy precedent", () => {
    const alterStart = source.lastIndexOf("alter table public.profiles");
    const alterStatement = source.slice(alterStart, source.indexOf(";", alterStart) + 1);
    expect(alterStatement).not.toMatch(/\bpolicies_accepted_at\b/);
  });

  it("does not add a policy-version or acceptance-audit-metadata column", () => {
    expect(getCodeOnly(source)).not.toMatch(/policy_version|accepted_ip|accepted_user_agent|policy_acceptances/i);
  });

  it("redefines only handle_new_user -- no new CREATE TRIGGER, no other function touched", () => {
    expect(source).toMatch(new RegExp(FN_ANCHOR.replace(/[().]/g, "\\$&")));
    expect(source).not.toMatch(/create trigger/i);
    expect(source).not.toMatch(/create or replace function public\.accept_seller_policies/i);
    expect(source).not.toMatch(/create or replace function public\.(create|update)_listing\(/i);
  });

  it("does not bulk-update or backfill any existing row -- no UPDATE statement anywhere in the file", () => {
    expect(source).not.toMatch(/\bupdate\s+public\.profiles\b/i);
    expect(source).not.toMatch(/\bupdate\s+profiles\b/i);
  });
});

describe("0071 handle_new_user: consent enforcement", () => {
  const source = readFile(MIGRATION_PATH);
  const body = getFunctionBody(source);

  it("takes no parameters -- consent comes from auth.users' own raw_user_meta_data, never a function argument", () => {
    const signature = source.slice(source.indexOf(FN_ANCHOR), source.indexOf("returns trigger"));
    expect(signature).toMatch(/handle_new_user\(\)/);
  });

  it("reads the consent flag as a literal text comparison, never a ::boolean cast that could throw on malformed input", () => {
    expect(body).toMatch(/v_policies_accepted := coalesce\(new\.raw_user_meta_data ->> 'policies_accepted', 'false'\) = 'true';/);
    expect(body).not.toMatch(/::boolean/);
  });

  it("rejects the signup outright when consent is not explicitly true (SIGNUP_POLICIES_NOT_ACCEPTED)", () => {
    expect(body).toMatch(/if not v_policies_accepted then\s*\n\s*raise exception 'You must agree to the Terms of Use and Privacy Policy to create an account\.' using detail = 'SIGNUP_POLICIES_NOT_ACCEPTED';/);
  });

  it("checks consent before inserting the profile row -- a rejected signup never creates a profile", () => {
    const consentCheckIndex = body.indexOf("SIGNUP_POLICIES_NOT_ACCEPTED");
    const insertIndex = body.indexOf("insert into public.profiles");
    expect(consentCheckIndex).toBeGreaterThan(-1);
    expect(insertIndex).toBeGreaterThan(consentCheckIndex);
  });

  it("stamps both timestamps from one server-side now() -- never a client-supplied timestamp of any kind", () => {
    expect(body).toMatch(/v_now := now\(\);/);
    expect(body).toMatch(/insert into public\.profiles \(id, display_name, terms_accepted_at, privacy_accepted_at\)\s*\n\s*values \(new\.id, v_display_name, v_now, v_now\);/);
    expect(getCodeOnly(source)).not.toMatch(/p_accepted_at|p_terms_accepted|p_privacy_accepted|new\.raw_user_meta_data ->> 'accepted_at'/);
  });

  it("writes the identical timestamp to both columns -- one combined checkbox, two columns, always in sync at signup", () => {
    const insertMatch = body.match(/values \((.+)\);/);
    expect(insertMatch).not.toBeNull();
    expect(insertMatch![1]).toBe("new.id, v_display_name, v_now, v_now");
  });
});

describe("0071 preserves the original display_name resolution logic unchanged", () => {
  const source = readFile(MIGRATION_PATH);
  const body = getFunctionBody(source);

  it("still resolves display_name from metadata, then email local-part, then 'Member'", () => {
    expect(body).toMatch(/v_display_name := btrim\(coalesce\(new\.raw_user_meta_data ->> 'display_name', ''\)\);/);
    expect(body).toMatch(/v_email_local_part := btrim\(split_part\(new\.email, '@', 1\)\);/);
    expect(body).toMatch(/v_display_name := 'Member';/);
  });
});

describe("0071 handle_new_user: security posture unchanged from 0004", () => {
  const source = readFile(MIGRATION_PATH);

  it("remains SECURITY DEFINER with an empty search_path", () => {
    expect(source).toMatch(/security definer/i);
    expect(source).toMatch(/set search_path = ''/);
  });

  it("adds no EXECUTE grant of any kind -- this is a trigger-invoked function, never called directly", () => {
    expect(source).not.toMatch(/grant execute on function public\.handle_new_user/i);
    expect(source).not.toMatch(/revoke all on function public\.handle_new_user/i);
  });

  it("returns new, exactly like the original trigger function", () => {
    expect(getFunctionBody(source)).toMatch(/return new;/);
  });
});
