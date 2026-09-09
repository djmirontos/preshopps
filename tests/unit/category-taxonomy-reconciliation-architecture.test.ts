import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

function readFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf-8");
}

const MIGRATION_PATH = "supabase/migrations/0068_category_taxonomy_reconciliation.sql";

const CANONICAL_16_CATEGORIES = [
  "Women",
  "Men",
  "Kids & Baby",
  "Shoes",
  "Bags & Accessories",
  "Electronics",
  "Home & Living",
  "Beauty & Personal Care",
  "Sports & Hobbies",
  "Cars",
  "Motorcycles",
  "For Rent",
  "Foods",
  "Bicycle",
  "Pet",
  "Other",
];

describe("Preshopps has exactly 16 canonical MVP categories", () => {
  it("is a fixed list of 16 with no duplicates", () => {
    expect(CANONICAL_16_CATEGORIES).toHaveLength(16);
    expect(new Set(CANONICAL_16_CATEGORIES).size).toBe(16);
  });

  it("Cars, Motorcycles, and For Rent are the only inquiry-only categories", () => {
    const inquiryOnly = ["Cars", "Motorcycles", "For Rent"];
    for (const name of inquiryOnly) {
      expect(CANONICAL_16_CATEGORIES).toContain(name);
    }
    const normalSale = CANONICAL_16_CATEGORIES.filter((name) => !inquiryOnly.includes(name));
    expect(normalSale).toHaveLength(13);
    expect(normalSale).toContain("Foods");
    expect(normalSale).toContain("Bicycle");
    expect(normalSale).toContain("Pet");
  });
});

describe("0068 reconciles Foods/Bicycle/Pet and Other.sort_order additively", () => {
  const source = readFile(MIGRATION_PATH);

  it("inserts exactly Foods, Bicycle, and Pet as ordinary (non-inquiry-only) categories with the live sort_order values", () => {
    expect(source).toMatch(/insert into public\.categories \(name, slug, is_inquiry_only, sort_order\) values/);
    expect(source).toMatch(/\('Foods', 'foods', false, 130\)/);
    expect(source).toMatch(/\('Bicycle', 'bicycle', false, 140\)/);
    expect(source).toMatch(/\('Pet', 'pet', false, 150\)/);
  });

  it("guards the insert with ON CONFLICT (slug) DO NOTHING -- idempotent, no duplicate rows possible", () => {
    expect(source).toMatch(/on conflict \(slug\) do nothing;/);
  });

  it("never specifies an id column for the inserted rows -- matches 0005's identity-column convention", () => {
    const insertBlock = source.slice(
      source.indexOf("insert into public.categories"),
      source.indexOf("on conflict"),
    );
    expect(insertBlock).not.toMatch(/\bid\b/);
  });

  it("updates Other to sort_order 160, guarded so it is a no-op once already correct", () => {
    expect(source).toMatch(/update public\.categories\s+set sort_order = 160\s+where slug = 'other'\s+and sort_order <> 160;/);
  });

  it("is purely additive -- no destructive statements anywhere in the migration", () => {
    expect(source).not.toMatch(/\bdelete\s+from\b/i);
    expect(source).not.toMatch(/\bdrop\s+(table|column|type)\b/i);
    expect(source).not.toMatch(/\btruncate\b/i);
  });

  it("never touches Cars, Motorcycles, or For Rent -- their inquiry-only rows are left exactly as 0005 defined them", () => {
    expect(source).not.toMatch(/'cars'/);
    expect(source).not.toMatch(/'motorcycles'/);
    expect(source).not.toMatch(/'for-rent'/);
  });

  it("does not create, alter, or drop any table, enum, or RLS policy -- scoped purely to categories data", () => {
    expect(source).not.toMatch(/create table|alter table|drop table/i);
    expect(source).not.toMatch(/create policy|alter policy|drop policy/i);
    expect(source).not.toMatch(/create type|alter type|drop type/i);
  });
});
