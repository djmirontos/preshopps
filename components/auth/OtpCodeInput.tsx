"use client";

import { useState, type ChangeEvent } from "react";

const CODE_LENGTH = 6;

type Props = {
  id: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  hasError?: boolean;
  ariaDescribedBy?: string;
};

/**
 * One real, accessible numeric input (inputMode="numeric", maxLength=6,
 * autoComplete="one-time-code") overlaid -- fully transparent, but exactly
 * covering the visible row -- by six decorative cells. This is the
 * established accessible pattern for a 6-digit code entry (matches
 * shadcn/ui's InputOTP, and how GitHub/Stripe build theirs): a single
 * input gets Backspace, cursor movement, and full-code paste correct for
 * free from native `<input>` behavior, whereas six separate real inputs
 * would each need their own paste-splitting and cross-field focus
 * management -- a much larger surface for subtle bugs for no behavioral
 * benefit here. The six cells are `aria-hidden` -- they exist purely to
 * show the typed digits visually; the real input is the only thing
 * assistive tech or the browser's own focus/selection model ever sees.
 */
export function OtpCodeInput({ id, value, onChange, disabled, hasError, ariaDescribedBy }: Props) {
  const [isFocused, setIsFocused] = useState(false);

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const digitsOnly = event.target.value.replace(/\D/g, "").slice(0, CODE_LENGTH);
    onChange(digitsOnly);
  }

  // The next cell to fill (or the last cell, once full) gets the focus
  // ring while the real input has focus -- a lightweight stand-in for a
  // true per-character caret, sufficient for a 6-digit code entry.
  const activeCellIndex = Math.min(value.length, CODE_LENGTH - 1);

  return (
    <div className="relative">
      <input
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        maxLength={CODE_LENGTH}
        value={value}
        onChange={handleChange}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        disabled={disabled}
        aria-describedby={ariaDescribedBy}
        aria-invalid={hasError || undefined}
        className="absolute inset-0 h-full w-full cursor-text opacity-0"
      />
      <div className="flex justify-between gap-2" aria-hidden="true">
        {Array.from({ length: CODE_LENGTH }, (_, index) => {
          const isActive = isFocused && index === activeCellIndex;
          return (
            <div
              key={index}
              className={`flex h-12 w-11 items-center justify-center rounded-md border bg-canvas text-lg font-semibold text-ink sm:w-12 ${
                hasError
                  ? "border-danger"
                  : isActive
                    ? "border-brand ring-2 ring-brand"
                    : "border-border"
              }`}
            >
              {value[index] ?? ""}
            </div>
          );
        })}
      </div>
    </div>
  );
}
