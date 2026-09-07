import Link from "next/link";
import Image from "next/image";
import { Package } from "lucide-react";
import { formatPriceFromCents } from "@/components/marketplace/ListingCard";
import { CartQuantityControls } from "@/components/cart/CartQuantityControls";

export type CartRowViewModel = {
  listingId: string;
  href: string | null;
  title: string | null;
  imageUrl: string | undefined;
  quantity: number;
  unitPriceCents: number | null;
  availableQuantity: number | null;
  isUnavailable: boolean;
  unavailableLabel: string | null;
};

type Props = {
  row: CartRowViewModel;
  isBusy?: boolean;
  onIncrement: () => void;
  onDecrement: () => void;
  onRemove: () => void;
};

/**
 * One cart line, shared by the authenticated and guest cart renderers so
 * row markup/accessibility never drifts between the two. Per PRD S20.6: an
 * unavailable row stays visible (never silently dropped), clearly marked,
 * with quantity edits disabled but removal always still possible.
 */
export function CartRow({ row, isBusy, onIncrement, onDecrement, onRemove }: Props) {
  const itemLabel = row.title ?? "this item";
  const subtotalCents = row.unitPriceCents !== null ? row.unitPriceCents * row.quantity : null;

  const image = (
    <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-[10px] bg-divider sm:h-24 sm:w-24">
      {row.imageUrl ? (
        <Image src={row.imageUrl} alt={row.title ?? ""} fill sizes="96px" className="object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <Package className="h-6 w-6 text-ink-muted/60" aria-hidden="true" />
        </div>
      )}
    </div>
  );

  return (
    <div className="flex gap-3 py-4">
      {row.href ? (
        <Link href={row.href} className="shrink-0 focus-visible:outline-none">
          {image}
        </Link>
      ) : (
        image
      )}

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            {row.href && row.title ? (
              <Link href={row.href} className="line-clamp-2 text-sm font-medium text-ink hover:underline">
                {row.title}
              </Link>
            ) : (
              <p className="text-sm font-medium text-ink-secondary">{row.title ?? "Item no longer available"}</p>
            )}
            {row.isUnavailable && row.unavailableLabel && (
              <p className="mt-0.5 text-xs font-medium text-danger">{row.unavailableLabel}</p>
            )}
          </div>
          {subtotalCents !== null && (
            <p className="shrink-0 text-sm font-semibold tabular-nums text-ink">{formatPriceFromCents(subtotalCents)}</p>
          )}
        </div>

        <CartQuantityControls
          quantity={row.quantity}
          max={row.isUnavailable ? row.quantity : row.availableQuantity}
          disabled={row.isUnavailable}
          isBusy={isBusy}
          itemLabel={itemLabel}
          onIncrement={onIncrement}
          onDecrement={onDecrement}
          onRemove={onRemove}
        />
      </div>
    </div>
  );
}
