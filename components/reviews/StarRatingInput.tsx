"use client";

import { Star } from "lucide-react";

type Props = {
  value: number | null;
  onChange: (rating: number) => void;
  errorId?: string;
};

const LABELS = ["1 star -- Poor", "2 stars -- Fair", "3 stars -- Good", "4 stars -- Very good", "5 stars -- Excellent"];

/**
 * Native radio-input group styled as stars -- this (not a row of plain
 * buttons) is what makes it keyboard accessible for free: Tab moves into
 * the group once, and the arrow keys move the native radio selection
 * between stars, exactly like any other radio group. The visual star icons
 * are decorative; the accessible name for each choice comes from the
 * associated <label> text (visually hidden, read by screen readers).
 */
export function StarRatingInput({ value, onChange, errorId }: Props) {
  return (
    <fieldset aria-describedby={errorId}>
      <legend className="text-sm font-medium text-ink">Rating</legend>
      <div className="mt-2 flex items-center gap-1">
        {[1, 2, 3, 4, 5].map((star) => {
          const checked = value === star;
          return (
            <label
              key={star}
              className="relative flex h-11 w-11 cursor-pointer items-center justify-center rounded-[10px] hover:bg-canvas has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand"
            >
              <input
                type="radio"
                name="rating"
                value={star}
                checked={checked}
                onChange={() => onChange(star)}
                className="sr-only"
              />
              <span className="sr-only">{LABELS[star - 1]}</span>
              <Star
                aria-hidden="true"
                className={`h-7 w-7 ${value !== null && star <= value ? "fill-current text-brand-link" : "text-divider"}`}
              />
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
