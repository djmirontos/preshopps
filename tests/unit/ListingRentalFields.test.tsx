import { describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  ListingRentalFields,
  EMPTY_RENTAL_VALUES,
  isRentalValuesEmpty,
  rentalValuesEqual,
  validateRentalValues,
  buildRentalDetailsJson,
  rentalFieldValuesFromServer,
} from "@/components/seller/ListingRentalFields";

describe("isRentalValuesEmpty", () => {
  it("is true for the empty defaults (availability defaults to 'available', not blank)", () => {
    expect(EMPTY_RENTAL_VALUES.availability).toBe("available");
    expect(isRentalValuesEmpty(EMPTY_RENTAL_VALUES)).toBe(true);
  });

  it("is false once any field is filled, or availability is changed away from the default", () => {
    expect(isRentalValuesEmpty({ ...EMPTY_RENTAL_VALUES, priceInput: "500" })).toBe(false);
    expect(isRentalValuesEmpty({ ...EMPTY_RENTAL_VALUES, availability: "paused" })).toBe(false);
  });
});

describe("rentalValuesEqual", () => {
  it("treats two identical value sets as equal", () => {
    const a = { ...EMPTY_RENTAL_VALUES, priceInput: "500.00" };
    const b = { ...EMPTY_RENTAL_VALUES, priceInput: "500.00" };
    expect(rentalValuesEqual(a, b)).toBe(true);
  });

  it("detects a difference", () => {
    expect(rentalValuesEqual(EMPTY_RENTAL_VALUES, { ...EMPTY_RENTAL_VALUES, period: "daily" })).toBe(false);
  });
});

describe("validateRentalValues", () => {
  it("has no errors when every field is blank/default", () => {
    expect(validateRentalValues(EMPTY_RENTAL_VALUES)).toEqual({});
  });

  it("rejects a malformed rental price", () => {
    expect(validateRentalValues({ ...EMPTY_RENTAL_VALUES, priceInput: "abc" }).price).toBeDefined();
  });

  it("rejects a malformed security deposit", () => {
    expect(validateRentalValues({ ...EMPTY_RENTAL_VALUES, securityDepositInput: "abc" }).securityDeposit).toBeDefined();
  });

  it("rejects a zero or negative capacity", () => {
    expect(validateRentalValues({ ...EMPTY_RENTAL_VALUES, capacity: "0" }).capacity).toBeDefined();
    expect(validateRentalValues({ ...EMPTY_RENTAL_VALUES, capacity: "-1" }).capacity).toBeDefined();
  });

  it("accepts a valid capacity", () => {
    expect(validateRentalValues({ ...EMPTY_RENTAL_VALUES, capacity: "4" }).capacity).toBeUndefined();
  });
});

describe("buildRentalDetailsJson", () => {
  it("omits every key for empty/default values", () => {
    expect(buildRentalDetailsJson(EMPTY_RENTAL_VALUES)).toEqual({});
  });

  it("converts rental price and security deposit to integer cents without floating-point drift", () => {
    const json = buildRentalDetailsJson({ ...EMPTY_RENTAL_VALUES, priceInput: "19.99", securityDepositInput: "500" });
    expect(json.rental_price_cents).toBe(1999);
    expect(json.security_deposit_cents).toBe(50000);
  });

  it("includes availability only when it differs from the 'available' default", () => {
    const defaultJson = buildRentalDetailsJson({ ...EMPTY_RENTAL_VALUES, priceInput: "100" });
    expect(defaultJson).not.toHaveProperty("availability");

    const changedJson = buildRentalDetailsJson({ ...EMPTY_RENTAL_VALUES, availability: "paused" });
    expect(changedJson.availability).toBe("paused");
  });

  it("includes text fields only when non-blank", () => {
    const json = buildRentalDetailsJson({
      ...EMPTY_RENTAL_VALUES,
      terms: "No smoking",
      minimumRentalPeriod: "1 day",
      whatsIncluded: "Helmet",
      rulesRestrictions: "No pets",
      period: "daily",
      capacity: "2",
    });

    expect(json).toEqual({
      rental_terms: "No smoking",
      minimum_rental_period: "1 day",
      whats_included: "Helmet",
      rules_restrictions: "No pets",
      rental_period: "daily",
      capacity: 2,
    });
  });
});

describe("rentalFieldValuesFromServer", () => {
  it("maps a null extension to the empty defaults", () => {
    expect(rentalFieldValuesFromServer(null)).toEqual(EMPTY_RENTAL_VALUES);
  });

  it("displays stored cents as pesos", () => {
    const values = rentalFieldValuesFromServer({
      rentalPriceCents: 1999,
      rentalPeriod: "daily",
      securityDepositCents: 50000,
      rentalTerms: "No smoking",
      minimumRentalPeriod: "1 day",
      capacity: 2,
      whatsIncluded: "Helmet",
      rulesRestrictions: "No pets",
      availability: "paused",
    });

    expect(values.priceInput).toBe("19.99");
    expect(values.securityDepositInput).toBe("500.00");
    expect(values.period).toBe("daily");
    expect(values.availability).toBe("paused");
  });

  it("maps null sub-fields to blank strings and defaults availability to 'available'", () => {
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

describe("ListingRentalFields component", () => {
  it("renders every canonical field: price, period, deposit, terms, minimum period, capacity, what's included, rules, availability", () => {
    render(<ListingRentalFields value={EMPTY_RENTAL_VALUES} onChange={() => {}} />);

    expect(screen.getByLabelText(/rental price/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^rental period/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/security deposit/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/rental terms/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/minimum rental period/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/capacity/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/what.s included/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/rules/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/availability/i)).toBeInTheDocument();
  });

  it("uses standalone option labels (Daily/Weekly/Monthly/Other) for the period select, not the day/week/month suffix form", () => {
    render(<ListingRentalFields value={EMPTY_RENTAL_VALUES} onChange={() => {}} />);
    expect(screen.getByRole("option", { name: "Daily" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Weekly" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Monthly" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Other" })).toBeInTheDocument();
  });

  it("uses the shared RENTAL_AVAILABILITY_LABELS for the availability select", () => {
    render(<ListingRentalFields value={EMPTY_RENTAL_VALUES} onChange={() => {}} />);
    expect(screen.getByRole("option", { name: "Available" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Unavailable" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Paused" })).toBeInTheDocument();
  });

  it("is fully controlled -- changing the period select calls onChange", () => {
    let latest = EMPTY_RENTAL_VALUES;
    render(<ListingRentalFields value={EMPTY_RENTAL_VALUES} onChange={(next) => (latest = next)} />);

    fireEvent.change(screen.getByLabelText(/^rental period/i), { target: { value: "weekly" } });
    expect(latest.period).toBe("weekly");
  });

  it("every field is optional -- no required attribute anywhere", () => {
    const { container } = render(<ListingRentalFields value={EMPTY_RENTAL_VALUES} onChange={() => {}} />);
    expect(container.querySelectorAll("[required]")).toHaveLength(0);
  });
});
