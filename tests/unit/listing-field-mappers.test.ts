import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  vehicleFieldValuesFromServer,
  rentalFieldValuesFromServer,
  EMPTY_VEHICLE_VALUES,
  EMPTY_RENTAL_VALUES,
} from "@/components/listings/listing-field-mappers";

function readFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf-8");
}

const MAPPERS_PATH = "components/listings/listing-field-mappers.ts";
const EDIT_PAGE_PATH = "app/sell/[listingId]/edit/page.tsx";

/**
 * Regression coverage for the Next.js "Attempted to call
 * vehicleFieldValuesFromServer() from the server but ... is on the client"
 * crash on /sell/[listingId]/edit: the Server Component there was calling
 * pure mapper functions that lived in "use client" modules
 * (ListingVehicleFields.tsx / ListingRentalFields.tsx). The fix moved the
 * mappers into this plain, directive-free module; ListingVehicleFields and
 * ListingRentalFields now just re-export the same functions for their
 * existing (client-side) callers, so there is one definition, not two.
 */
describe("listing-field-mappers.ts is a server-safe module", () => {
  it("does not contain a \"use client\" directive", () => {
    const source = readFile(MAPPERS_PATH);
    // Matches only an actual directive statement (alone on its own line),
    // not this describe block's own prose mentioning "use client" by name.
    expect(source).not.toMatch(/^\s*["']use client["'];?\s*$/m);
  });

  it("vehicleFieldValuesFromServer and rentalFieldValuesFromServer are importable from it", () => {
    expect(typeof vehicleFieldValuesFromServer).toBe("function");
    expect(typeof rentalFieldValuesFromServer).toBe("function");
  });
});

describe("/sell/[listingId]/edit no longer imports callable helpers from a client module", () => {
  it("imports vehicleFieldValuesFromServer/rentalFieldValuesFromServer from the server-safe mappers module", () => {
    const source = readFile(EDIT_PAGE_PATH);
    expect(source).toMatch(
      /import\s*\{\s*vehicleFieldValuesFromServer,\s*rentalFieldValuesFromServer\s*\}\s*from\s*["']@\/components\/listings\/listing-field-mappers["']/,
    );
  });

  it("no longer imports either mapper directly from the \"use client\" seller field components", () => {
    const source = readFile(EDIT_PAGE_PATH);
    expect(source).not.toMatch(/vehicleFieldValuesFromServer.*from\s*["']@\/components\/seller\/ListingVehicleFields["']/);
    expect(source).not.toMatch(/rentalFieldValuesFromServer.*from\s*["']@\/components\/seller\/ListingRentalFields["']/);
  });
});

describe("vehicleFieldValuesFromServer", () => {
  it("maps a null vehicleDetails (title-only draft) to the empty defaults, without throwing", () => {
    expect(vehicleFieldValuesFromServer(null)).toEqual(EMPTY_VEHICLE_VALUES);
  });

  it("maps a complete vehicle row exactly as before", () => {
    const values = vehicleFieldValuesFromServer({
      brand: "Toyota",
      model: "Vios",
      year: 2020,
      mileageKm: 50000,
      transmission: "Automatic",
      fuelType: "Gasoline",
      registrationStatus: "registered",
      documentsAvailable: ["OR/CR"],
    });

    expect(values).toEqual({
      brand: "Toyota",
      model: "Vios",
      year: "2020",
      mileageKm: "50000",
      transmission: "Automatic",
      fuelType: "Gasoline",
      registrationStatus: "registered",
      documentsAvailable: ["OR/CR"],
    });
  });

  it("maps a partial draft row (some sub-fields null) to blank strings for those fields only", () => {
    const values = vehicleFieldValuesFromServer({
      brand: "Toyota",
      model: null,
      year: null,
      mileageKm: null,
      transmission: null,
      fuelType: null,
      registrationStatus: null,
      documentsAvailable: null,
    });

    expect(values).toEqual({
      ...EMPTY_VEHICLE_VALUES,
      brand: "Toyota",
    });
  });
});

describe("rentalFieldValuesFromServer", () => {
  it("maps a null rentalDetails (title-only draft) to the empty defaults, without throwing", () => {
    expect(rentalFieldValuesFromServer(null)).toEqual(EMPTY_RENTAL_VALUES);
  });

  it("maps a complete rental row exactly as before", () => {
    const values = rentalFieldValuesFromServer({
      rentalPriceCents: 150000,
      rentalPeriod: "daily",
      securityDepositCents: 50000,
      rentalTerms: "No smoking",
      minimumRentalPeriod: "1 day",
      capacity: 4,
      whatsIncluded: "Helmet",
      rulesRestrictions: "Valid license required",
      availability: "unavailable",
    });

    expect(values).toEqual({
      priceInput: "1500.00",
      period: "daily",
      securityDepositInput: "500.00",
      terms: "No smoking",
      minimumRentalPeriod: "1 day",
      capacity: "4",
      whatsIncluded: "Helmet",
      rulesRestrictions: "Valid license required",
      availability: "unavailable",
    });
  });

  it("maps a partial draft row (some sub-fields null) to blank strings and the default availability", () => {
    const values = rentalFieldValuesFromServer({
      rentalPriceCents: null,
      rentalPeriod: null,
      securityDepositCents: null,
      rentalTerms: null,
      minimumRentalPeriod: null,
      capacity: null,
      whatsIncluded: null,
      rulesRestrictions: null,
      availability: null,
    });

    expect(values).toEqual(EMPTY_RENTAL_VALUES);
  });
});
