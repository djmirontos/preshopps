"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

type FavoritesContextValue = {
  isFavorited: (listingId: string) => boolean;
  addFavoriteId: (listingId: string) => void;
  removeFavoriteId: (listingId: string) => void;
};

const FavoritesContext = createContext<FavoritesContextValue>({
  isFavorited: () => false,
  addFavoriteId: () => {},
  removeFavoriteId: () => {},
});

type Props = {
  favoritedIds: string[];
  children: ReactNode;
};

/**
 * Shared, mutable favorite-state source (not initial-state-only): the root
 * layout still resolves the signed-in user's favorited listing ids once per
 * request (lib/favorites/get-my-favorite-ids.ts -- a single lightweight
 * query, not one per card), but this Provider now OWNS that Set as React
 * state for the lifetime of the session, not just as a one-time seed.
 *
 * Because this Provider lives in the root layout, and Next.js layouts
 * persist across client-side navigations (they don't remount per route),
 * a successful add_favorite/remove_favorite call updates this ONE shared
 * Set via addFavoriteId/removeFavoriteId, and every FavoriteButton for
 * that same listing -- on the current page or any page navigated to next
 * within the same session -- reads the updated value. No global state
 * library: this is the same plain Context pattern as AuthStatusProvider,
 * just with setState instead of a pure passthrough value.
 *
 * The one case that needs an explicit resync is a genuine server-side
 * re-render of the root layout with a NEW favoritedIds array (sign-in,
 * sign-out, or a hard reload -- each produces a fresh, differently-
 * referenced prop). Rather than an effect (which would setState after an
 * extra commit), that resync happens synchronously during render -- React's
 * documented "adjusting state when a prop changes" pattern -- by comparing
 * against the last-seen favoritedIds reference. A same-session client
 * navigation never re-runs the layout, so favoritedIds keeps the same
 * reference and this branch never fires; the mutated Set is left exactly
 * as the user last changed it.
 */
export function FavoritesProvider({ favoritedIds, children }: Props) {
  const [prevFavoritedIds, setPrevFavoritedIds] = useState(favoritedIds);
  const [ids, setIds] = useState<ReadonlySet<string>>(() => new Set(favoritedIds));

  if (favoritedIds !== prevFavoritedIds) {
    setPrevFavoritedIds(favoritedIds);
    setIds(new Set(favoritedIds));
  }

  const isFavorited = useCallback((listingId: string) => ids.has(listingId), [ids]);

  const addFavoriteId = useCallback((listingId: string) => {
    setIds((prev) => {
      if (prev.has(listingId)) return prev;
      const next = new Set(prev);
      next.add(listingId);
      return next;
    });
  }, []);

  const removeFavoriteId = useCallback((listingId: string) => {
    setIds((prev) => {
      if (!prev.has(listingId)) return prev;
      const next = new Set(prev);
      next.delete(listingId);
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({ isFavorited, addFavoriteId, removeFavoriteId }),
    [isFavorited, addFavoriteId, removeFavoriteId],
  );

  return <FavoritesContext.Provider value={value}>{children}</FavoritesContext.Provider>;
}

export function useFavorites(): FavoritesContextValue {
  return useContext(FavoritesContext);
}
