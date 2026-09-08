import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

function readFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf-8");
}

const MIGRATION_PATH = "supabase/migrations/0052_ph_location_reference_data_correction.sql";

function getSlice(source: string, startAnchor: string, endAnchor: string): string {
  const start = source.indexOf(startAnchor);
  if (start === -1) throw new Error(`Anchor not found: ${startAnchor}`);
  const end = source.indexOf(endAnchor, start);
  if (end === -1) throw new Error(`End anchor not found: ${endAnchor}`);
  return source.slice(start, end);
}

function countTupleLines(block: string): number {
  return block
    .split(/\r?\n/)
    .filter((line) => line.trim().startsWith("(")).length;
}

describe("0052 PH location correction migration is self-contained and deterministic", () => {
  it("exists on disk as a single, complete migration file", () => {
    expect(existsSync(path.join(process.cwd(), MIGRATION_PATH))).toBe(true);
    const source = readFile(MIGRATION_PATH);
    expect(source.length).toBeGreaterThan(1_000_000); // ~1.9MB of literal data
  });

  it("does not depend on outbound HTTP or network fetching of any kind", () => {
    const source = readFile(MIGRATION_PATH);
    // No extension/function that could perform a network fetch, and no
    // quoted URL literal that could be passed to one. This deliberately
    // does NOT forbid the plain-text domain name "raw.githubusercontent.com"
    // appearing in the migration's own documentary header comment, which
    // explains -- in prose, not code -- why this migration no longer
    // depends on it (unlike 0051, which did).
    expect(source).not.toMatch(/create extension if not exists http/i);
    expect(source).not.toMatch(/http_get\s*\(/i);
    expect(source).not.toMatch(/'https?:\/\/[^']*'/i);
  });

  it("embeds every province/city/barangay row literally -- no dynamic generation", () => {
    const source = readFile(MIGRATION_PATH);
    // All real-table population is INSERT ... SELECT ... FROM a staging
    // table populated by literal VALUES lists -- never a function call that
    // could produce different data on a different run.
    expect(source).toMatch(/insert into _ph_provinces \(name\) values/);
    expect(source).toMatch(/insert into _ph_cities \(province_name, name\) values/);
    expect(source).toMatch(/insert into _ph_barangays \(province_name, city_name, name\) values/);
  });
});

describe("0052 embedded data counts match the official 30 June 2026 PSGC totals", () => {
  const source = readFile(MIGRATION_PATH);

  it("embeds exactly 97 province/application-parent rows (82 official PSA provinces + 15 region-named pseudo-provinces for orphan HUCs/ICCs/SGA municipalities)", () => {
    const block = getSlice(
      source,
      "insert into _ph_provinces (name) values",
      "insert into provinces (country_code, name)",
    );
    expect(countTupleLines(block)).toBe(97);
  });

  it("embeds exactly 1,642 cities/municipalities (149 official cities + 1,493 official municipalities)", () => {
    const block = getSlice(
      source,
      "insert into _ph_cities (province_name, name) values",
      "insert into cities_municipalities (province_id, name)",
    );
    expect(countTupleLines(block)).toBe(1_642);
  });

  it("embeds exactly 42,010 barangays across its batched insert blocks", () => {
    const block = getSlice(
      source,
      "insert into _ph_barangays (province_name, city_name, name) values",
      "insert into barangays (city_id, name)",
    );
    expect(countTupleLines(block)).toBe(42_010);
  });
});

describe("0052 NCR representation uses exactly one application-level grouping", () => {
  const source = readFile(MIGRATION_PATH);

  it("creates exactly one 'Metro Manila (NCR)' province row, not the old four PSGC district pseudo-provinces", () => {
    const provincesBlock = getSlice(
      source,
      "insert into _ph_provinces (name) values",
      "insert into provinces (country_code, name)",
    );
    const ncrMatches = provincesBlock.match(/\('Metro Manila \(NCR\)'\)/g) ?? [];
    expect(ncrMatches.length).toBe(1);

    // The four PSGC-official district-tier rows 0051 used instead must not
    // reappear -- 0052 deliberately replaces that representation.
    expect(source).not.toMatch(/NCR, City of Manila, First District/);
    expect(source).not.toMatch(/NCR, Second District/);
    expect(source).not.toMatch(/NCR, Third District/);
    expect(source).not.toMatch(/NCR, Fourth District/);
  });

  it("places exactly the 17 official NCR cities/municipalities (16 cities + Pateros) under 'Metro Manila (NCR)'", () => {
    const citiesBlock = getSlice(
      source,
      "insert into _ph_cities (province_name, name) values",
      "insert into cities_municipalities (province_id, name)",
    );
    const ncrCityRows = citiesBlock
      .split(/\r?\n/)
      .filter((line) => line.includes("('Metro Manila (NCR)',"));
    expect(ncrCityRows.length).toBe(17);
    expect(citiesBlock).toMatch(/\('Metro Manila \(NCR\)', 'Pateros'\)/);
  });
});

describe("0052 representative city-to-parent mappings match the official PSGC 2Q 2026 data", () => {
  const source = readFile(MIGRATION_PATH);

  it.each([
    ["City of Tangub", "Misamis Occidental"],
    ["City of Las Piñas", "Metro Manila (NCR)"],
    ["City of Parañaque", "Metro Manila (NCR)"],
    ["City of Cebu", "Central Visayas"],
    ["City of Davao", "Davao Region"],
    ["City of Cotabato", "Maguindanao del Norte"],
    ["City of Bacolod", "Negros Island Region (NIR)"],
  ])("%s -> %s", (city, province) => {
    const escapedProvince = province.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const escapedCity = city.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`\\('${escapedProvince}', '${escapedCity}'\\)`);
    expect(source).toMatch(pattern);
  });
});

describe("0052 preserves non-ASCII place names exactly, with no encoding corruption", () => {
  const source = readFile(MIGRATION_PATH);

  it.each([
    "Las Piñas",
    "Parañaque",
    "Biñan",
    "Muñoz",
    "Doña",
    "Los Baños",
    "Santo Niño",
  ])("contains the correctly-encoded name '%s'", (name) => {
    expect(source).toContain(name);
  });

  it("contains no Unicode replacement character (U+FFFD) anywhere in the file", () => {
    expect(source).not.toContain("�");
  });
});
