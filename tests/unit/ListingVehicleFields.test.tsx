import { describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  ListingVehicleFields,
  EMPTY_VEHICLE_VALUES,
  isVehicleValuesEmpty,
  vehicleValuesEqual,
  validateVehicleValues,
  buildVehicleDetailsJson,
  vehicleFieldValuesFromServer,
  type VehicleFieldValues,
} from "@/components/seller/ListingVehicleFields";

describe("isVehicleValuesEmpty", () => {
  it("is true for the empty defaults", () => {
    expect(isVehicleValuesEmpty(EMPTY_VEHICLE_VALUES)).toBe(true);
  });

  it("is false once any field is filled", () => {
    expect(isVehicleValuesEmpty({ ...EMPTY_VEHICLE_VALUES, brand: "Toyota" })).toBe(false);
    expect(isVehicleValuesEmpty({ ...EMPTY_VEHICLE_VALUES, documentsAvailable: ["OR/CR"] })).toBe(false);
  });
});

describe("vehicleValuesEqual", () => {
  it("treats two identical value sets as equal", () => {
    const a: VehicleFieldValues = { ...EMPTY_VEHICLE_VALUES, brand: "Toyota", documentsAvailable: ["OR/CR"] };
    const b: VehicleFieldValues = { ...EMPTY_VEHICLE_VALUES, brand: "Toyota", documentsAvailable: ["OR/CR"] };
    expect(vehicleValuesEqual(a, b)).toBe(true);
  });

  it("detects a difference in documentsAvailable order or contents", () => {
    const a: VehicleFieldValues = { ...EMPTY_VEHICLE_VALUES, documentsAvailable: ["OR/CR", "Deed of sale"] };
    const b: VehicleFieldValues = { ...EMPTY_VEHICLE_VALUES, documentsAvailable: ["Deed of sale", "OR/CR"] };
    expect(vehicleValuesEqual(a, b)).toBe(false);
  });
});

describe("validateVehicleValues", () => {
  it("has no errors when every field is blank", () => {
    expect(validateVehicleValues(EMPTY_VEHICLE_VALUES)).toEqual({});
  });

  it("rejects a year before 1900", () => {
    expect(validateVehicleValues({ ...EMPTY_VEHICLE_VALUES, year: "1899" }).year).toBeDefined();
  });

  it("accepts a valid year", () => {
    expect(validateVehicleValues({ ...EMPTY_VEHICLE_VALUES, year: "2020" }).year).toBeUndefined();
  });

  it("rejects a negative mileage", () => {
    expect(validateVehicleValues({ ...EMPTY_VEHICLE_VALUES, mileageKm: "-5" }).mileageKm).toBeDefined();
  });

  it("rejects non-numeric year/mileage", () => {
    const errors = validateVehicleValues({ ...EMPTY_VEHICLE_VALUES, year: "abc", mileageKm: "xyz" });
    expect(errors.year).toBeDefined();
    expect(errors.mileageKm).toBeDefined();
  });
});

describe("buildVehicleDetailsJson", () => {
  it("omits every key for empty values", () => {
    expect(buildVehicleDetailsJson(EMPTY_VEHICLE_VALUES)).toEqual({});
  });

  it("includes only the filled-in fields, correctly typed", () => {
    const json = buildVehicleDetailsJson({
      ...EMPTY_VEHICLE_VALUES,
      brand: "Toyota",
      year: "2020",
      mileageKm: "50000",
      registrationStatus: "registered",
      documentsAvailable: ["OR/CR"],
    });

    expect(json).toEqual({
      brand: "Toyota",
      year: 2020,
      mileage_km: 50000,
      registration_status: "registered",
      documents_available: ["OR/CR"],
    });
  });

  it("never sends plate number or VIN keys -- canon explicitly excludes them", () => {
    const json = buildVehicleDetailsJson({ ...EMPTY_VEHICLE_VALUES, brand: "Toyota" });
    expect(json).not.toHaveProperty("plate_number");
    expect(json).not.toHaveProperty("vin");
  });
});

describe("vehicleFieldValuesFromServer", () => {
  it("maps a null extension to the empty defaults", () => {
    expect(vehicleFieldValuesFromServer(null)).toEqual(EMPTY_VEHICLE_VALUES);
  });

  it("maps a populated row to raw string field values", () => {
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

  it("maps null sub-fields to blank strings, not the literal 'null'", () => {
    const values = vehicleFieldValuesFromServer({
      brand: null,
      model: null,
      year: null,
      mileageKm: null,
      transmission: null,
      fuelType: null,
      registrationStatus: null,
      documentsAvailable: null,
    });

    expect(values).toEqual(EMPTY_VEHICLE_VALUES);
  });
});

describe("ListingVehicleFields component", () => {
  it("renders every canonical field: brand, model, year, mileage, transmission, fuel type, registration status, documents", () => {
    render(<ListingVehicleFields value={EMPTY_VEHICLE_VALUES} onChange={() => {}} />);

    expect(screen.getByLabelText(/^brand/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^model/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^year/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/mileage/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/transmission/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/fuel type/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/registration status/i)).toBeInTheDocument();
    expect(screen.getByText("OR/CR")).toBeInTheDocument();
    expect(screen.getByText("Deed of sale")).toBeInTheDocument();
    expect(screen.getByText("Service records")).toBeInTheDocument();
  });

  it("never renders a plate number or VIN field", () => {
    render(<ListingVehicleFields value={EMPTY_VEHICLE_VALUES} onChange={() => {}} />);
    expect(screen.queryByLabelText(/plate number/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/\bvin\b/i)).not.toBeInTheDocument();
  });

  it("uses the shared REGISTRATION_LABELS option text (Registered/Expired Registration/For Renewal)", () => {
    render(<ListingVehicleFields value={EMPTY_VEHICLE_VALUES} onChange={() => {}} />);
    expect(screen.getByRole("option", { name: "Registered" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Expired Registration" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "For Renewal" })).toBeInTheDocument();
  });

  it("is fully controlled -- toggling a document checkbox calls onChange with the updated array, not internal state", () => {
    let latest: VehicleFieldValues = EMPTY_VEHICLE_VALUES;
    const { rerender } = render(<ListingVehicleFields value={EMPTY_VEHICLE_VALUES} onChange={(next) => (latest = next)} />);

    fireEvent.click(screen.getByText("OR/CR"));
    expect(latest.documentsAvailable).toEqual(["OR/CR"]);

    rerender(<ListingVehicleFields value={latest} onChange={(next) => (latest = next)} />);
    expect(screen.getByText("OR/CR").closest("label")?.querySelector("input")).toBeChecked();
  });

  it("every field is optional -- no required attribute or asterisk anywhere", () => {
    const { container } = render(<ListingVehicleFields value={EMPTY_VEHICLE_VALUES} onChange={() => {}} />);
    expect(container.querySelectorAll("[required]")).toHaveLength(0);
  });
});
