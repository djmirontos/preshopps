import type { ListingStatus } from "@/lib/marketplace/listing-detail";

type Props = {
  status: ListingStatus;
  isInquiryOnly: boolean;
};

const UNAVAILABLE_NOTES: Partial<Record<ListingStatus, string>> = {
  reserved: "This item is currently reserved.",
  sold: "This item has already been sold.",
  archived: "This listing is archived and no longer available.",
};

/**
 * Visual-only action area. Add to Cart and Message Seller are rendered as
 * disabled buttons rather than pretending either action succeeds -- no
 * cart/order/messaging backend or auth exists to wire them to yet, and no
 * placeholder route exists for either that wouldn't itself be misleading.
 * Exact choice reported per task instruction.
 */
export function ListingActions({ status, isInquiryOnly }: Props) {
  const isAvailable = status === "available";
  const unavailableNote = UNAVAILABLE_NOTES[status];

  return (
    <div className="mt-5 space-y-2.5">
      {!isAvailable && unavailableNote && (
        <p className="text-sm font-medium text-ink-secondary">{unavailableNote}</p>
      )}

      <div className="flex flex-col gap-2.5 sm:flex-row">
        {!isInquiryOnly && isAvailable && (
          <button
            type="button"
            disabled
            aria-disabled="true"
            className="h-12 flex-1 rounded-[10px] bg-brand-hover px-5 text-sm font-semibold text-white opacity-60 cursor-not-allowed"
          >
            Add to Cart
          </button>
        )}

        <button
          type="button"
          disabled
          aria-disabled="true"
          className="h-12 flex-1 rounded-[10px] border border-border bg-surface px-5 text-sm font-semibold text-ink opacity-60 cursor-not-allowed"
        >
          Message Seller
        </button>
      </div>

      <p className="text-xs text-ink-muted">Cart and messaging are coming soon.</p>
    </div>
  );
}
