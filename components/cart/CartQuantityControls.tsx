"use client";

import { Minus, Plus } from "lucide-react";
import { cn } from "@/lib/cn";

type Props = {
  quantity: number;
  /** null = unknown/unavailable -- increment stays disabled rather than
   * guessing a ceiling. */
  max: number | null;
  /** Fully disabled (e.g. an unavailable row) -- both stepper buttons are
   * disabled, but Remove always stays usable. */
  disabled?: boolean;
  isBusy?: boolean;
  /** Item title (or a safe fallback), included in every button's
   * accessible name so repeated rows are distinguishable to screen reader
   * users -- same reasoning as FavoriteButton's per-item aria-label. */
  itemLabel: string;
  onIncrement: () => void;
  onDecrement: () => void;
  onRemove: () => void;
};

const STEP_BUTTON_CLASS =
  "flex h-9 w-9 items-center justify-center text-ink-secondary disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand";

/**
 * Minimum quantity is always 1 (decrement disables at 1); removal is a
 * separate explicit action, never an implicit result of decrementing past
 * 1. Maximum is the caller-supplied current available stock -- increment
 * disables at/above it rather than allowing an over-quantity request.
 */
export function CartQuantityControls({ quantity, max, disabled, isBusy, itemLabel, onIncrement, onDecrement, onRemove }: Props) {
  const atMin = quantity <= 1;
  // null means "unknown ceiling" -- never allow incrementing past an
  // unknown limit rather than assuming it's safe.
  const atMax = max === null || quantity >= max;

  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center rounded-[10px] border border-border">
        <button
          type="button"
          aria-label={`Decrease quantity of ${itemLabel}`}
          disabled={disabled || isBusy || atMin}
          onClick={onDecrement}
          className={cn(STEP_BUTTON_CLASS, "rounded-l-[10px]")}
        >
          <Minus className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
        <span aria-live="polite" className="w-8 text-center text-sm font-medium tabular-nums text-ink">
          {quantity}
        </span>
        <button
          type="button"
          aria-label={`Increase quantity of ${itemLabel}`}
          disabled={disabled || isBusy || atMax}
          onClick={onIncrement}
          className={cn(STEP_BUTTON_CLASS, "rounded-r-[10px]")}
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>

      <button
        type="button"
        aria-label={`Remove ${itemLabel} from cart`}
        disabled={isBusy}
        onClick={onRemove}
        className="text-xs font-medium text-ink-secondary underline-offset-2 hover:text-danger hover:underline disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
      >
        Remove
      </button>
    </div>
  );
}
