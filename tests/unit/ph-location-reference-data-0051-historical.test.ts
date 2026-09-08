// HISTORICAL / SUPERSEDED -- this file documents the structure of 0051, the
// original 2021-vintage (isaacdarcilla/philippine-addresses) seed migration.
// 0051 has been superseded by 0052_ph_location_reference_data_correction.sql,
// which is the authoritative source of PH location reference data (built
// from the official PSA PSGC 2Q 2026 publication) -- see
// tests/unit/ph-location-reference-data-correction-architecture.test.ts for
// the current, canonical coverage. 0051 itself is left byte-for-byte
// unmodified (per this project's "never edit an already-applied migration"
// rule) and is kept only for historical regression coverage: these tests
// confirm the OLD file's own structure hasn't drifted, not that its design
// (four NCR district pseudo-provinces, undivided Maguindanao, Cotabato City
// as independent, HTTP-fetched data) is still current or correct.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

function readFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf-8");
}

const MIGRATION = "supabase/migrations/0051_ph_location_reference_data.sql";
const LOCATIONS_SCHEMA = "supabase/migrations/0003_locations.sql";

describe("[HISTORICAL, superseded by 0052] 0051 migration is data-only and idempotent", () => {
  it("never touches countries, and 0003 already seeds Philippines (this migration reuses that row)", () => {
    const source = readFile(MIGRATION);
    expect(source).not.toMatch(/insert into countries/i);
    expect(source).not.toMatch(/update countries/i);
    expect(source).not.toMatch(/delete from countries/i);

    const schema = readFile(LOCATIONS_SCHEMA);
    expect(schema).toMatch(/insert into countries[\s\S]*?'PH'[\s\S]*?'Philippines'/i);
  });

  it("never deletes/truncates/drops the real reference tables -- purely additive seeding", () => {
    const source = readFile(MIGRATION);
    for (const table of ["provinces", "cities_municipalities", "barangays"]) {
      expect(source).not.toMatch(new RegExp(`drop table[^;]*\\b${table}\\b`, "i"));
      expect(source).not.toMatch(new RegExp(`truncate[^;]*\\b${table}\\b`, "i"));
      expect(source).not.toMatch(new RegExp(`delete from ${table}\\b`, "i"));
    }
  });

  it("every insert into a real reference table is ON CONFLICT ... DO NOTHING (safe to replay on an already-seeded database)", () => {
    const source = readFile(MIGRATION);
    const realTableInserts = source.match(/insert into (provinces|cities_municipalities|barangays)[\s\S]*?;/g) ?? [];
    expect(realTableInserts.length).toBe(3);
    for (const stmt of realTableInserts) {
      expect(stmt).toMatch(/on conflict[\s\S]*do nothing/i);
    }
  });

  it("resolves parent ids by joining on the parent's natural key (name) -- no hardcoded province/city/barangay ids", () => {
    const source = readFile(MIGRATION);
    expect(source).toMatch(/insert into provinces \(country_code, name\)/i);
    expect(source).toMatch(/insert into cities_municipalities \(province_id, name\)/i);
    expect(source).toMatch(/insert into barangays \(city_id, name\)/i);
    // No real-table insert column list ever includes a literal "id" column.
    expect(source).not.toMatch(/insert into (provinces|cities_municipalities|barangays) \([^)]*\bid\b[^)]*\)/i);
  });

  it("stages fetched data in session-local temporary tables (on commit drop) -- no permanent staging tables left behind", () => {
    const source = readFile(MIGRATION);
    const tempTables = source.match(/create temporary table \S+/g) ?? [];
    expect(tempTables.length).toBeGreaterThanOrEqual(6);
    for (const decl of source.match(/create temporary table[\s\S]*?\) on commit drop;/g) ?? []) {
      expect(decl).toMatch(/on commit drop;$/);
    }
  });

  it("drops its own normalization helper function at the end -- no stray schema artifacts remain", () => {
    const source = readFile(MIGRATION);
    expect(source).toMatch(/create or replace function public\._psgc_normalize/);
    expect(source.trim().endsWith("drop function public._psgc_normalize(text);")).toBe(true);
  });
});

describe("[HISTORICAL, superseded by 0052] 0051 fetched from a pinned, immutable source (0052 no longer fetches over the network at all)", () => {
  it("fetches province.json, city.json, and barangay.json, each pinned to the same 40-char commit SHA (not a mutable branch name)", () => {
    const source = readFile(MIGRATION);
    const shaMatches = [...source.matchAll(/philippine-addresses\/([0-9a-f]{40})\/(province|city|barangay)\.json/g)];
    expect(shaMatches.length).toBe(3);

    const shas = new Set(shaMatches.map((m) => m[1]));
    expect(shas.size).toBe(1); // all three pinned to the identical commit

    const files = new Set(shaMatches.map((m) => m[2]));
    expect(files).toEqual(new Set(["province", "city", "barangay"]));

    expect(source).not.toMatch(/philippine-addresses\/(master|main)\//);
  });

  it("enables the http extension it depends on", () => {
    const source = readFile(MIGRATION);
    expect(source).toMatch(/create extension if not exists http;/);
  });
});

describe("[HISTORICAL, superseded by 0052] 0051's own normalization rules", () => {
  it("uppercases NCR while preserving trailing punctuation (e.g. 'Ncr,' -> 'NCR,')", () => {
    const source = readFile(MIGRATION);
    expect(source).toMatch(/lower\(core_prefix\) = 'ncr'/);
    expect(source).toMatch(/'NCR' \|\| core_rest/);
  });

  it("lowercases exactly the Spanish linking words + 'of' when not the first word of a name", () => {
    const source = readFile(MIGRATION);
    const linkingWordsMatch = source.match(/any \(array\[([^\]]+)\]\)/);
    expect(linkingWordsMatch).not.toBeNull();
    const words = (linkingWordsMatch?.[1] ?? "")
      .split(",")
      .map((w) => w.trim().replace(/'/g, ""))
      .sort();
    expect(words).toEqual(["de", "del", "la", "las", "of", "y"].sort());
    // Guarded by "i > 1" -- never applied to the first word of a name.
    expect(source).toMatch(/i > 1 and lower\(w\) = any/);
  });

  it("skips the one known blank-name barangay row instead of fabricating a name", () => {
    const source = readFile(MIGRATION);
    expect(source).toMatch(/btrim\(coalesce\(elem ->> 'brgy_name', ''\)\) <> ''/);
  });
});

describe("[HISTORICAL, superseded by 0052] 0051 documents the design decisions it made at the time", () => {
  it("documents 0051's own NCR representation decision (four PSGC district rows -- superseded: 0052 instead uses a single 'Metro Manila (NCR)' application-level grouping)", () => {
    const source = readFile(MIGRATION);
    expect(source).toMatch(/NCR is not a province in the ordinary administrative sense/i);
    expect(source).not.toMatch(/'Metro Manila'/);
  });

  it("documents the Manila district-tier data-shape quirk instead of fabricating a single 'City of Manila' row", () => {
    const source = readFile(MIGRATION);
    expect(source).toMatch(/does NOT appear as a single selectable/i);
  });

  it("documents the known blank barangay-name data-quality defect", () => {
    const source = readFile(MIGRATION);
    expect(source).toMatch(/Known data-quality defect in the source/i);
    expect(source).toMatch(/060406/);
  });
});
