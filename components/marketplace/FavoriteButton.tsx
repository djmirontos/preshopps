"use client";

import { useState } from "react";
import { Heart } from "lucide-react";
import { cn } from "@/lib/cn";
import { useIsAuthenticated } from "@/lib/auth/use-is-authenticated";
import { AuthGate } from "@/components/auth/AuthGate";

type Props = {
  label: string;
  /** Safe internal path to return to after sign-in (see
   * lib/auth/safe-redirect.ts -- this is already an internal app route,
   * e.g. listing.href, so it's safe as-is). */
  next: string;
};

/**
 * Visual-only favorite toggle for an authenticated user -- purely local/
 * presentational state, no persistence yet. A guest instead gets the
 * auth gate; the local "favorited" state is never reachable by a guest,
 * so there's nothing to lose/fake when they later sign in.
 */
export function FavoriteButton({ label, next }: Props) {
  const isAuthenticated = useIsAuthenticated();
  const [isFavorited, setIsFavorited] = useState(false);
  const [isGateOpen, setIsGateOpen] = useState(false);

  function handleClick(event: React.MouseEvent) {
    event.preventDefault();
    if (isAuthenticated === false) {
      setIsGateOpen(true);
      return;
    }
    setIsFavorited((value) => !value);
  }

  return (
    <>
      <button
        type="button"
        aria-label={label}
        aria-pressed={isFavorited}
        onClick={handleClick}
        className="flex h-11 w-11 items-center justify-center rounded-full bg-white/85 text-ink-secondary shadow-sm backdrop-blur-sm transition-colors duration-150 hover:text-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
      >
        <Heart
          className={cn("h-4 w-4", isFavorited && "fill-brand-hover text-brand-hover")}
          aria-hidden="true"
        />
      </button>

      {isGateOpen && (
        <AuthGate
          title="Sign in to save items"
          reason="Create a free account to keep track of items you love."
          next={next}
          onClose={() => setIsGateOpen(false)}
        />
      )}
    </>
  );
}
