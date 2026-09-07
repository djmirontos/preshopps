import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

function readFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf-8");
}

const MIGRATION = "supabase/migrations/0048_media_storage_foundation.sql";
const BUCKETS = ["listing-images", "review-images", "shop-images"] as const;

describe("Media storage migration creates exactly the three approved buckets", () => {
  it("inserts listing-images, review-images, and shop-images -- no fourth bucket (e.g. dispute/profile images, out of this task's scope)", () => {
    const source = readFile(MIGRATION);
    for (const bucket of BUCKETS) {
      expect(source).toMatch(new RegExp(`'${bucket}'`));
    }
    expect(source).not.toMatch(/dispute-images|profile-images/);
  });

  it("every bucket is public (listing/review photos and shop logo are public marketplace content)", () => {
    const source = readFile(MIGRATION);
    const insertStatement = source.match(/insert into storage\.buckets[\s\S]*?;/)?.[0] ?? "";
    for (const bucket of BUCKETS) {
      expect(insertStatement).toMatch(new RegExp(`'${bucket}',\\s*'${bucket}',\\s*true`));
    }
  });

  it("every bucket restricts allowed_mime_types to image types only -- no video, no wildcard", () => {
    const source = readFile(MIGRATION);
    const insertStatement = source.match(/insert into storage\.buckets[\s\S]*?;/)?.[0] ?? "";
    expect(insertStatement).not.toMatch(/video\//);
    expect(insertStatement.match(/image\/jpeg/g)?.length).toBe(3);
    expect(insertStatement.match(/image\/png/g)?.length).toBe(3);
    expect(insertStatement.match(/image\/webp/g)?.length).toBe(3);
  });

  it("every bucket sets a file_size_limit -- not unusually high, and not unlimited (null)", () => {
    const source = readFile(MIGRATION);
    const insertStatement = source.match(/insert into storage\.buckets[\s\S]*?;/)?.[0] ?? "";
    // 5 MB for listing/review photos, 3 MB for the single shop logo.
    expect(insertStatement).toMatch(/'listing-images',\s*'listing-images',\s*true,\s*5242880/);
    expect(insertStatement).toMatch(/'review-images',\s*'review-images',\s*true,\s*5242880/);
    expect(insertStatement).toMatch(/'shop-images',\s*'shop-images',\s*true,\s*3145728/);
  });
});

describe("Media storage migration scopes writes to the caller's own path only", () => {
  for (const bucket of BUCKETS) {
    const slug = bucket.replace(/-/g, "_");

    it(`${bucket}: insert/update/delete policies are authenticated-only and check (storage.foldername(name))[1] = auth.uid()`, () => {
      const source = readFile(MIGRATION);
      for (const action of ["insert", "update", "delete"]) {
        const policyRegex = new RegExp(
          `create policy ${slug}_${action}_own[\\s\\S]*?for ${action}[\\s\\S]*?to authenticated[\\s\\S]*?bucket_id = '${bucket}'[\\s\\S]*?\\(storage\\.foldername\\(name\\)\\)\\[1\\] = auth\\.uid\\(\\)::text`,
          "i",
        );
        expect(source).toMatch(policyRegex);
      }
    });

    it(`${bucket}: has a public SELECT policy (anon + authenticated) -- no bucket is read-restricted`, () => {
      const source = readFile(MIGRATION);
      const policyRegex = new RegExp(
        `create policy ${slug}_select_public[\\s\\S]*?for select[\\s\\S]*?to anon, authenticated[\\s\\S]*?bucket_id = '${bucket}'`,
        "i",
      );
      expect(source).toMatch(policyRegex);
    });

    it(`${bucket}: no policy grants anon INSERT/UPDATE/DELETE`, () => {
      const source = readFile(MIGRATION);
      const writePolicies = source.match(new RegExp(`create policy ${slug}_(insert|update|delete)_own[\\s\\S]*?;`, "gi")) ?? [];
      expect(writePolicies.length).toBe(3);
      for (const policy of writePolicies) {
        expect(policy).not.toMatch(/to\s+[^;]*\banon\b/i);
      }
    });
  }
});

describe("Media storage migration touches nothing outside storage.buckets/storage.objects", () => {
  it("no application table, RLS policy, or RPC is created/altered", () => {
    const source = readFile(MIGRATION);
    expect(source).not.toMatch(/create table|alter table public\.|drop table/i);
    expect(source).not.toMatch(/create or replace function/i);
    expect(source).not.toMatch(/create policy \w+ on public\./i);
  });

  it("no service-role key/env-var reference anywhere -- bucket/policy creation is plain SQL, not a service-role client call", () => {
    const source = readFile(MIGRATION);
    expect(source).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY|service_role/);
  });
});
