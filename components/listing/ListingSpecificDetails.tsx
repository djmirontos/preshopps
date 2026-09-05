import { formatPriceFromCents } from "@/components/marketplace/ListingCard";
import type {
  RentalAvailability,
  RentalDetails,
  RentalPeriod,
  VehicleDetails,
  VehicleRegistrationStatus,
} from "@/lib/marketplace/listing-detail";

type Props = {
  vehicle: VehicleDetails | null;
  rental: RentalDetails | null;
};

const REGISTRATION_LABELS: Record<VehicleRegistrationStatus, string> = {
  registered: "Registered",
  expired_registration: "Expired Registration",
  for_renewal: "For Renewal",
};

const RENTAL_PERIOD_LABELS: Record<RentalPeriod, string> = {
  daily: "day",
  weekly: "week",
  monthly: "month",
  other: "period",
};

const RENTAL_AVAILABILITY_LABELS: Record<RentalAvailability, string> = {
  available: "Available",
  unavailable: "Unavailable",
  paused: "Paused",
};

type Row = { label: string; value: string };

function buildVehicleRows(vehicle: VehicleDetails): Row[] {
  const rows: Row[] = [];
  if (vehicle.brand) rows.push({ label: "Brand", value: vehicle.brand });
  if (vehicle.model) rows.push({ label: "Model", value: vehicle.model });
  if (vehicle.year !== null) rows.push({ label: "Year", value: String(vehicle.year) });
  if (vehicle.mileageKm !== null) {
    rows.push({ label: "Mileage", value: `${vehicle.mileageKm.toLocaleString("en-PH")} km` });
  }
  if (vehicle.transmission) rows.push({ label: "Transmission", value: vehicle.transmission });
  if (vehicle.fuelType) rows.push({ label: "Fuel Type", value: vehicle.fuelType });
  if (vehicle.registrationStatus) {
    rows.push({ label: "Registration", value: REGISTRATION_LABELS[vehicle.registrationStatus] });
  }
  if (vehicle.documentsAvailable.length > 0) {
    rows.push({ label: "Documents Available", value: vehicle.documentsAvailable.join(", ") });
  }
  return rows;
}

function buildRentalRows(rental: RentalDetails): Row[] {
  const rows: Row[] = [];
  if (rental.priceCents !== null) {
    const perPeriod = rental.period ? ` / ${RENTAL_PERIOD_LABELS[rental.period]}` : "";
    rows.push({ label: "Rental Price", value: `${formatPriceFromCents(rental.priceCents)}${perPeriod}` });
  }
  if (rental.securityDepositCents !== null) {
    rows.push({ label: "Security Deposit", value: formatPriceFromCents(rental.securityDepositCents) });
  }
  if (rental.minimumRentalPeriod) rows.push({ label: "Minimum Rental Period", value: rental.minimumRentalPeriod });
  if (rental.capacity !== null) rows.push({ label: "Capacity", value: String(rental.capacity) });
  if (rental.availability) {
    rows.push({ label: "Availability", value: RENTAL_AVAILABILITY_LABELS[rental.availability] });
  }
  return rows;
}

/** Free-text rental fields (terms/what's-included/rules) render as their
 * own labeled paragraphs rather than cramming prose into the compact
 * grid -- same plain-text safety as ListingDescription (no auto-link,
 * no dangerouslySetInnerHTML), since these are seller-entered text too. */
function buildRentalTextBlocks(rental: RentalDetails): Row[] {
  const blocks: Row[] = [];
  if (rental.whatsIncluded) blocks.push({ label: "What's Included", value: rental.whatsIncluded });
  if (rental.rulesRestrictions) blocks.push({ label: "Rules & Restrictions", value: rental.rulesRestrictions });
  if (rental.terms) blocks.push({ label: "Terms", value: rental.terms });
  return blocks;
}

function DetailGrid({ rows }: { rows: Row[] }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
      {rows.map((row) => (
        <div key={row.label}>
          <dt className="text-ink-muted">{row.label}</dt>
          <dd className="text-ink-secondary">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Compact, conditional block for the structured fields get_listing_detail
 * already returns for Cars/Motorcycles (vehicle_*) and For Rent (rental_*)
 * listings. Renders nothing for an ordinary listing -- never an empty
 * "Details" box -- and only the specific fields that are actually
 * non-null/non-empty for whichever group(s) apply.
 */
export function ListingSpecificDetails({ vehicle, rental }: Props) {
  const vehicleRows = vehicle ? buildVehicleRows(vehicle) : [];
  const rentalRows = rental ? buildRentalRows(rental) : [];
  const rentalTextBlocks = rental ? buildRentalTextBlocks(rental) : [];

  if (vehicleRows.length === 0 && rentalRows.length === 0 && rentalTextBlocks.length === 0) {
    return null;
  }

  return (
    <div className="space-y-6">
      {vehicleRows.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold text-ink">Vehicle Details</h2>
          <div className="mt-2">
            <DetailGrid rows={vehicleRows} />
          </div>
        </div>
      )}

      {(rentalRows.length > 0 || rentalTextBlocks.length > 0) && (
        <div>
          <h2 className="text-lg font-semibold text-ink">Rental Details</h2>
          {rentalRows.length > 0 && (
            <div className="mt-2">
              <DetailGrid rows={rentalRows} />
            </div>
          )}
          {rentalTextBlocks.map((block) => (
            <div key={block.label} className="mt-3">
              <h3 className="text-sm font-semibold text-ink">{block.label}</h3>
              <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-ink-secondary">
                {block.value}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
