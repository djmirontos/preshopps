import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

function readFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf-8");
}

const MIGRATION = "supabase/migrations/0049_shop_create_update_rpcs.sql";
const SLUG_MIGRATION = "supabase/migrations/0050_shop_setup_custom_slug.sql";

describe("Shop write RPCs never trust client-supplied identity", () => {
  it("shop-actions.ts calls create_shop/update_shop with only form fields -- no owner/user id", () => {
    const source = readFile("lib/seller/shop-actions.ts");
    expect(source).toMatch(/rpc\(\s*["']create_shop["']/);
    expect(source).toMatch(/rpc\(\s*["']update_shop["']/);
    expect(source).not.toMatch(/p_owner_id|p_user_id|p_caller_id/);
  });

  it("no shop write module ever selects/writes the shops or shop_slugs tables directly", () => {
    const files = ["lib/seller/shop-actions.ts", "components/seller/ShopForm.tsx"];
    for (const file of files) {
      const source = readFile(file);
      expect(source).not.toMatch(/\.from\(\s*["']shops["']\s*\)\.(insert|update|upsert|delete)/);
      expect(source).not.toMatch(/\.from\(\s*["']shop_slugs["']\s*\)/);
    }
  });

  it("get-my-shop-profile.ts only ever selects (never mutates) the shops table", () => {
    const source = readFile("lib/seller/get-my-shop-profile.ts");
    expect(source).toMatch(/\.from\(\s*["']shops["']\s*\)\s*\.select\(/);
    expect(source).not.toMatch(/\.(insert|update|upsert|delete)\(/);
  });
});

describe("no service-role bypass anywhere in the Seller Shop module", () => {
  it("no shop file references a service-role key", () => {
    const files = [
      "lib/seller/get-my-shop-profile.ts",
      "lib/seller/shop-actions.ts",
      "components/seller/ShopForm.tsx",
      "components/seller/ShopLogoPicker.tsx",
      "components/seller/ShopLocationFields.tsx",
      "app/seller/shop/page.tsx",
    ];
    for (const file of files) {
      const source = readFile(file);
      expect(source.toLowerCase()).not.toContain("service_role");
      expect(source.toLowerCase()).not.toContain("service-role");
    }
  });
});

describe("Seller Shop module does not build out-of-scope features", () => {
  it("does not reference listing creation, seller analytics, payments, messaging, reviews, or notifications concepts", () => {
    const files = ["components/seller/ShopForm.tsx", "app/seller/shop/page.tsx"];
    for (const file of files) {
      const source = readFile(file);
      expect(source).not.toMatch(/create listing|publish listing|listing draft/i);
      expect(source).not.toMatch(/analytics|revenue|dashboard chart/i);
      expect(source).not.toMatch(/gcash|escrow|payment intent/i);
      expect(source).not.toMatch(/send_message|start_conversation/i);
      expect(source).not.toMatch(/create_review|upsert_review_reply/i);
    }
  });

  it("does not expose a featured-listing selection control (deferred until Listing Management exists)", () => {
    const source = readFile("components/seller/ShopForm.tsx");
    expect(source).not.toMatch(/featured.?listing.*select|choose.*featured listing/i);
  });

  it("does not seed or fabricate location reference rows anywhere", () => {
    const files = ["components/seller/ShopLocationFields.tsx", "app/seller/shop/page.tsx"];
    for (const file of files) {
      const source = readFile(file);
      expect(source).not.toMatch(/insert into provinces|insert into cities|insert into barangays/i);
    }
  });
});

describe("Shop write migration is scoped to exactly two RPCs plus one private helper", () => {
  it("0049 adds create_shop, update_shop, and generate_unique_shop_slug only -- no unrelated table/RPC change", () => {
    const source = readFile(MIGRATION);
    expect(source).toMatch(/create or replace function public\.create_shop/i);
    expect(source).toMatch(/create or replace function public\.update_shop/i);
    expect(source).toMatch(/create or replace function public\.generate_unique_shop_slug/i);
    expect(source).not.toMatch(/\b(create|alter|drop)\s+table\s+(if\s+(not\s+)?exists\s+)?public\./i);
    expect(source).not.toMatch(/create type|alter type/i);
    expect(source).not.toMatch(/create policy|drop policy|alter policy/i);
  });

  it("create_shop and update_shop are granted to authenticated only, never anon or public", () => {
    const source = readFile(MIGRATION);
    for (const fn of ["create_shop", "update_shop"]) {
      expect(source).toMatch(new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public`, "i"));
      expect(source).toMatch(new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from anon`, "i"));
      expect(source).toMatch(new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to authenticated`, "i"));
    }
  });

  it("the private slug helper is revoked from public, anon, and authenticated -- unreachable by any client role", () => {
    const source = readFile(MIGRATION);
    expect(source).toMatch(/revoke all on function public\.generate_unique_shop_slug\(text\) from public/i);
    expect(source).toMatch(/revoke all on function public\.generate_unique_shop_slug\(text\) from anon/i);
    expect(source).toMatch(/revoke all on function public\.generate_unique_shop_slug\(text\) from authenticated/i);
    expect(source).not.toMatch(/grant execute on function public\.generate_unique_shop_slug/i);
  });

  it("neither RPC accepts an owner id, is_trusted_seller, or a suspension-related parameter", () => {
    const source = readFile(MIGRATION);
    const createSignature = source.match(/create or replace function public\.create_shop\(([\s\S]*?)\)\s*\n?returns/i)?.[1] ?? "";
    const updateSignature = source.match(/create or replace function public\.update_shop\(([\s\S]*?)\)\s*\n?returns/i)?.[1] ?? "";
    for (const signature of [createSignature, updateSignature]) {
      expect(signature).not.toMatch(/p_owner_id/i);
      expect(signature).not.toMatch(/is_trusted_seller/i);
      expect(signature).not.toMatch(/suspend/i);
    }
  });

  it("update_shop's status parameter is typed as the shop_status_enum -- no arbitrary string can be passed", () => {
    const source = readFile(MIGRATION);
    expect(source).toMatch(/p_status public\.shop_status_enum/i);
  });

  it("both RPCs derive the caller from auth.uid(), never a client-supplied id", () => {
    const source = readFile(MIGRATION);
    const createBody = source.match(/create_shop\([\s\S]*?\$\$([\s\S]*?)\$\$;/i)?.[1] ?? "";
    const updateBody = source.match(/update_shop\([\s\S]*?\$\$([\s\S]*?)\$\$;/i)?.[1] ?? "";
    expect(createBody).toMatch(/auth\.uid\(\)/);
    expect(updateBody).toMatch(/auth\.uid\(\)/);
  });
});

describe("0049 was already applied live and is restored to its original content", () => {
  it("0049's create_shop has no p_slug parameter and no DROP FUNCTION statement -- the slug correction lives entirely in 0050", () => {
    const source = readFile(MIGRATION);
    const createSignature = source.match(/create or replace function public\.create_shop\(([\s\S]*?)\)\s*\n?returns/i)?.[1] ?? "";
    expect(createSignature).not.toMatch(/p_slug/i);
    expect(source).not.toMatch(/drop function/i);
    expect(source).not.toMatch(/SLUG_INVALID|SLUG_UNAVAILABLE/);
  });

  it("0049's create_shop is granted under its original 7-argument signature", () => {
    const source = readFile(MIGRATION);
    expect(source).toMatch(/grant execute on function public\.create_shop\(text, text, integer, integer, integer, text, text\) to authenticated/i);
  });
});

describe("Seller may customize the shop slug during setup only (PRD 6.3) -- 0050", () => {
  it("0050 touches create_shop only -- update_shop and generate_unique_shop_slug are not redefined", () => {
    const source = readFile(SLUG_MIGRATION);
    expect(source).toMatch(/create or replace function public\.create_shop/i);
    expect(source).not.toMatch(/create or replace function public\.update_shop/i);
    expect(source).not.toMatch(/create or replace function public\.generate_unique_shop_slug/i);
    expect(source).not.toMatch(/\b(create|alter|drop)\s+table\s+(if\s+(not\s+)?exists\s+)?public\./i);
    expect(source).not.toMatch(/create type|alter type/i);
    expect(source).not.toMatch(/create policy|drop policy|alter policy/i);
  });

  it("safely drops the old 7-argument create_shop signature before recreating it with 8 arguments", () => {
    const source = readFile(SLUG_MIGRATION);
    expect(source).toMatch(/drop function if exists public\.create_shop\(text, text, integer, integer, integer, text, text\)/i);
  });

  it("create_shop accepts an optional p_slug parameter", () => {
    const source = readFile(SLUG_MIGRATION);
    const createSignature = source.match(/create or replace function public\.create_shop\(([\s\S]*?)\)\s*\n?returns/i)?.[1] ?? "";
    expect(createSignature).toMatch(/p_slug text default null/i);
  });

  it("re-grants the new 8-argument signature to authenticated only, never anon or public", () => {
    const source = readFile(SLUG_MIGRATION);
    expect(source).toMatch(/revoke all on function public\.create_shop\(text, text, integer, integer, integer, text, text, text\) from public/i);
    expect(source).toMatch(/revoke all on function public\.create_shop\(text, text, integer, integer, integer, text, text, text\) from anon/i);
    expect(source).toMatch(/grant execute on function public\.create_shop\(text, text, integer, integer, integer, text, text, text\) to authenticated/i);
  });

  it("a requested slug is validated against the same format rule as shops.slug's own CHECK constraint", () => {
    const source = readFile(SLUG_MIGRATION);
    const createBody = source.match(/create_shop\([\s\S]*?\$\$([\s\S]*?)\$\$;/i)?.[1] ?? "";
    expect(createBody).toMatch(/SLUG_INVALID/);
    expect(createBody).toMatch(/\^\[a-z0-9\]\+\(-\[a-z0-9\]\+\)\*\$/);
  });

  it("availability is checked against shop_slugs with no is_current filter -- current AND historical slugs both block reuse", () => {
    const source = readFile(SLUG_MIGRATION);
    const createBody = source.match(/create_shop\([\s\S]*?\$\$([\s\S]*?)\$\$;/i)?.[1] ?? "";
    const availabilityCheck = createBody.match(/exists\s*\(\s*select 1 from public\.shop_slugs ss where ss\.slug = v_requested_slug\s*\)/i);
    expect(availabilityCheck).not.toBeNull();
    expect(availabilityCheck?.[0]).not.toMatch(/is_current/i);
    expect(createBody).toMatch(/SLUG_UNAVAILABLE/);
  });

  it("a same-instant race on the slug is also caught, via the unique_violation handler, and mapped to the same safe code", () => {
    const source = readFile(SLUG_MIGRATION);
    const createBody = source.match(/create_shop\([\s\S]*?\$\$([\s\S]*?)\$\$;/i)?.[1] ?? "";
    expect(createBody).toMatch(/when unique_violation/i);
    expect(createBody).toMatch(/get stacked diagnostics/i);
  });

  it("does not weaken the shop_slugs history model -- no DELETE anywhere in either migration", () => {
    expect(readFile(MIGRATION)).not.toMatch(/delete from public\.shop_slugs/i);
    expect(readFile(SLUG_MIGRATION)).not.toMatch(/delete from public\.shop_slugs/i);
  });

  it("dropping the old create_shop overload never touches update_shop or any table", () => {
    const source = readFile(SLUG_MIGRATION);
    // Anchored to the start of a line (optional whitespace only) so a
    // prose mention of "DROP FUNCTION" inside a `--` comment can never be
    // mistaken for an actual statement.
    const dropStatements = source.match(/^[ \t]*drop function[^;]*;/gim) ?? [];
    expect(dropStatements.length).toBe(1);
    expect(dropStatements[0]).toMatch(/create_shop/i);
    expect(dropStatements[0]).not.toMatch(/update_shop/i);
    expect(source).not.toMatch(/^[ \t]*drop table|^[ \t]*drop policy/im);
  });

  it("neither the requested slug nor any other new parameter carries an owner id, trusted-seller flag, or suspension field", () => {
    const source = readFile(SLUG_MIGRATION);
    const createSignature = source.match(/create or replace function public\.create_shop\(([\s\S]*?)\)\s*\n?returns/i)?.[1] ?? "";
    expect(createSignature).not.toMatch(/p_owner_id/i);
    expect(createSignature).not.toMatch(/is_trusted_seller/i);
    expect(createSignature).not.toMatch(/suspend/i);
  });
});
