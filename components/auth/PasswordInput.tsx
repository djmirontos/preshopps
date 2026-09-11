"use client";

import { useState, type ReactNode } from "react";
import { Eye, EyeOff } from "lucide-react";
import { AUTH_INPUT_CLASS } from "./auth-field-styles";

type Props = {
  id: string;
  name: string;
  label: string;
  autoComplete: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  minLength?: number;
  helperText?: string;
  /** Optional element rendered at the far end of the label row, e.g. the
   * sign-in form's "Forgot password?" link -- keeps that link's position
   * identical to before this component existed. */
  labelRowEnd?: ReactNode;
};

/**
 * Shared password field for Sign In and Create Account: same compact
 * input styling as the plain email field, plus a self-contained show/hide
 * toggle. Visibility state is local to each instance -- rendering two of
 * these (password + confirm password) on SignUpForm never lets one
 * toggle affect the other. The toggle button is type="button" (never
 * submits the enclosing form) and only ever changes the input's `type`;
 * the typed value itself is untouched by toggling.
 */
export function PasswordInput({
  id,
  name,
  label,
  autoComplete,
  value,
  onChange,
  required,
  minLength,
  helperText,
  labelRowEnd,
}: Props) {
  const [isVisible, setIsVisible] = useState(false);

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <label htmlFor={id} className="block text-sm font-medium text-ink">
          {label}
        </label>
        {labelRowEnd}
      </div>
      <div className="relative">
        <input
          id={id}
          name={name}
          type={isVisible ? "text" : "password"}
          autoComplete={autoComplete}
          required={required}
          minLength={minLength}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={`${AUTH_INPUT_CLASS} pr-10`}
        />
        <button
          type="button"
          onClick={() => setIsVisible((prev) => !prev)}
          aria-label={isVisible ? "Hide password" : "Show password"}
          className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-ink-muted transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          {isVisible ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
        </button>
      </div>
      {helperText && <p className="mt-1 text-xs text-ink-muted">{helperText}</p>}
    </div>
  );
}
