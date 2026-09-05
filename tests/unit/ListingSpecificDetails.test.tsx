import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ListingSpecificDetails } from "@/components/listing/ListingSpecificDetails";
import type { RentalDetails, VehicleDetails } from "@/lib/marketplace/listing-detail";

const fullVehicle: VehicleDetails = {
  brand: "Toyota",
  model: "Vios",
  year: 2019,
  mileageKm: 45000,
  transmission: "Manual",
  fuelType: "Gasoline",
  registrationStatus: "registered",
  documentsAvailable: ["OR/CR", "Deed of Sale"],
};

const fullRental: RentalDetails = {
  priceCents: 150000,
  period: "daily",
  securityDepositCents: 300000,
  terms: "Full payment upfront, ID required.",
  minimumRentalPeriod: "3 days",
  capacity: 4,
  whatsIncluded: "Helmet and raincoat included.",
  rulesRestrictions: "No smoking. Return with a full tank.",
  availability: "available",
};

describe("ListingSpecificDetails", () => {
  it("renders nothing for an ordinary listing (no vehicle/rental data)", () => {
    const { container } = render(<ListingSpecificDetails vehicle={null} rental={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the Vehicle Details block with every populated field", () => {
    render(<ListingSpecificDetails vehicle={fullVehicle} rental={null} />);
    expect(screen.getByText("Vehicle Details")).toBeInTheDocument();
    expect(screen.getByText("Toyota")).toBeInTheDocument();
    expect(screen.getByText("Vios")).toBeInTheDocument();
    expect(screen.getByText("2019")).toBeInTheDocument();
    expect(screen.getByText("45,000 km")).toBeInTheDocument();
    expect(screen.getByText("Manual")).toBeInTheDocument();
    expect(screen.getByText("Gasoline")).toBeInTheDocument();
    expect(screen.getByText("Registered")).toBeInTheDocument();
    expect(screen.getByText("OR/CR, Deed of Sale")).toBeInTheDocument();
  });

  it("does not render the Rental Details heading when only vehicle data is present", () => {
    render(<ListingSpecificDetails vehicle={fullVehicle} rental={null} />);
    expect(screen.queryByText("Rental Details")).not.toBeInTheDocument();
  });

  it("omits a vehicle field row entirely when that field is null, without a blank row", () => {
    render(
      <ListingSpecificDetails
        vehicle={{ ...fullVehicle, model: null, mileageKm: null }}
        rental={null}
      />,
    );
    expect(screen.queryByText("Model")).not.toBeInTheDocument();
    expect(screen.queryByText("Mileage")).not.toBeInTheDocument();
    expect(screen.getByText("Brand")).toBeInTheDocument();
  });

  it("renders the Rental Details block with price formatted via the shared PHP helper", () => {
    render(<ListingSpecificDetails vehicle={null} rental={fullRental} />);
    expect(screen.getByText("Rental Details")).toBeInTheDocument();
    expect(screen.getByText("₱1,500 / day")).toBeInTheDocument();
    expect(screen.getByText("₱3,000")).toBeInTheDocument();
  });

  it("renders free-text rental fields as their own labeled paragraphs", () => {
    render(<ListingSpecificDetails vehicle={null} rental={fullRental} />);
    expect(screen.getByText("What's Included")).toBeInTheDocument();
    expect(screen.getByText("Helmet and raincoat included.")).toBeInTheDocument();
    expect(screen.getByText("Rules & Restrictions")).toBeInTheDocument();
    expect(screen.getByText("Terms")).toBeInTheDocument();
  });

  it("omits a rental field row entirely when that field is null", () => {
    render(
      <ListingSpecificDetails
        vehicle={null}
        rental={{ ...fullRental, capacity: null, whatsIncluded: null }}
      />,
    );
    expect(screen.queryByText("Capacity")).not.toBeInTheDocument();
    expect(screen.queryByText("What's Included")).not.toBeInTheDocument();
  });

  it("does not render the Vehicle Details heading when only rental data is present", () => {
    render(<ListingSpecificDetails vehicle={null} rental={fullRental} />);
    expect(screen.queryByText("Vehicle Details")).not.toBeInTheDocument();
  });

  it("renders both sections when a listing safely has both groups", () => {
    render(<ListingSpecificDetails vehicle={fullVehicle} rental={fullRental} />);
    expect(screen.getByText("Vehicle Details")).toBeInTheDocument();
    expect(screen.getByText("Rental Details")).toBeInTheDocument();
  });
});
