import { Bike, Handshake, MapPinned, Truck } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { FULFILLMENT_LABELS, type FulfillmentMethod } from "@/lib/marketplace/search-params";

type Props = {
  methods: FulfillmentMethod[];
  meetupNote: string | null;
};

const FULFILLMENT_ICONS: Record<FulfillmentMethod, LucideIcon> = {
  meetup: Handshake,
  pickup: MapPinned,
  local_delivery: Bike,
  shipping: Truck,
};

/** Shows only the methods this listing actually supports -- an
 * unsupported method is never rendered, never implied. */
export function ListingFulfillment({ methods, meetupNote }: Props) {
  if (methods.length === 0) return null;

  return (
    <div>
      <h2 className="text-lg font-semibold text-ink">Fulfillment</h2>
      <ul className="mt-2 flex flex-wrap gap-2">
        {methods.map((method) => {
          const Icon = FULFILLMENT_ICONS[method];
          return (
            <li
              key={method}
              className="flex h-9 items-center gap-1.5 rounded-full border border-border bg-surface px-3 text-sm text-ink-secondary"
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              {FULFILLMENT_LABELS[method]}
            </li>
          );
        })}
      </ul>

      {methods.includes("meetup") && meetupNote && (
        <p className="mt-2 text-sm text-ink-muted">{meetupNote}</p>
      )}
    </div>
  );
}
