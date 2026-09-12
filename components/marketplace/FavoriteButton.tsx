"use client";

import { useState } from "react";
import { Heart } from "lucide-react";
import { cn } from "@/lib/cn";
import { createClient } from "@/lib/supabase/client";
import { useIsAuthenticated } from "@/lib/auth/use-is-authenticated";
import { useFavorites } from "@/components/favorites/FavoritesProvider";
import { AuthGate } from "@/components/auth/AuthGate";
import { Tooltip } from "@/components/ui/Tooltip";

type Props = {
  listingId: string;
  /** Item display name, used only to build a per-item aria-label (e.g.
   * "Add Uniqlo Airism T-Shirt to favorites") -- a grid renders many of
   * these buttons at once, so a generic "Add to favorites" label on every
   * one would be indistinguishable for screen-reader users. */
  label: string;
  /** Safe internal path to return to after sign-in (see
   * lib/auth/safe-redirect.ts -- this is already an internal app route,
   * e.g. listing.href, so it's safe as-is). */
  next: string;
};

/**
 * Real favorite toggle backed by the existing add_favorite/remove_favorite
 * RPCs (0037_favorites_cart_rls_and_rpcs.sql) -- called directly from the
 * browser client, the same way useIsAuthenticated already does, rather
 * than through a Server Action, so the optimistic UI update and any
 * rollback happen with no navigation/page refresh.
 *
 * Favorited state is read directly from the shared FavoritesProvider
 * (isFavorited(listingId)) rather than copied into local state -- this is
 * what keeps two FavoriteButtons for the same listing (e.g. a card on the
 * homepage and the same listing's detail-page heart) synchronized: a
 * successful mutation calls addFavoriteId/removeFavoriteId on the shared
 * Set, and every button reading that same listingId re-renders from the
 * one source of truth. A guest still gets the auth gate; nothing is
 * written/guessed locally for a guest.
 */
export function FavoriteButton({ listingId, label, next }: Props) {
  const isAuthenticated = useIsAuthenticated();
  const { isFavorited: checkIsFavorited, addFavoriteId, removeFavoriteId } = useFavorites();
  const isFavorited = checkIsFavorited(listingId);
  const [isPending, setIsPending] = useState(false);
  const [isGateOpen, setIsGateOpen] = useState(false);

  async function handleClick(event: React.MouseEvent) {
    event.preventDefault();

    if (!isAuthenticated) {
      setIsGateOpen(true);
      return;
    }

    // Duplicate-click guard: a second click while a mutation is already in
    // flight is ignored outright, rather than queued or raced, so repeated
    // clicks can never create duplicate favorite rows or send add/remove
    // out of order.
    if (isPending) return;

    const nextFavorited = !isFavorited;
    // Optimistic: update the shared Set immediately, before the RPC
    // resolves, so every button for this listing reflects the change at
    // once.
    if (nextFavorited) {
      addFavoriteId(listingId);
    } else {
      removeFavoriteId(listingId);
    }
    setIsPending(true);

    const supabase = createClient();
    const { error } = nextFavorited
      ? await supabase.rpc("add_favorite", { p_listing_id: listingId })
      : await supabase.rpc("remove_favorite", { p_listing_id: listingId });

    if (error) {
      // Roll back the shared Set to the pre-click state -- covers every
      // failure case uniformly (listing no longer favoritable, session
      // expired, a transient network/RPC failure) without showing a raw
      // Supabase error to the user; there is no toast system in this
      // codebase to route a message through, so the visible correction is
      // every button for this listing reverting together.
      console.error("Favorite mutation failed:", error.message);
      if (nextFavorited) {
        removeFavoriteId(listingId);
      } else {
        addFavoriteId(listingId);
      }
    }

    setIsPending(false);
  }

  const ariaLabel = isFavorited ? `Remove ${label} from favorites` : `Add ${label} to favorites`;

  return (
    <>
      <Tooltip label={isFavorited ? "Remove from favorites" : "Add to favorites"}>
        <button
          type="button"
          aria-label={ariaLabel}
          aria-pressed={isFavorited}
          onClick={handleClick}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-white/85 text-ink-secondary shadow-sm backdrop-blur-sm transition-colors duration-150 hover:text-brand-link focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          <Heart
            className={cn("h-4 w-4", isFavorited && "fill-brand-link text-brand-link")}
            aria-hidden="true"
          />
        </button>
      </Tooltip>

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
