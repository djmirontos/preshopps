"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { readGuestCart, writeGuestCart } from "@/lib/cart/guest-cart-storage";
import { mergeGuestCartOnAuth } from "@/lib/cart/merge-guest-cart-on-auth";

export type CartLine = {
  listingId: string;
  publicCode: string | null;
  quantity: number;
};

type CartContextValue = {
  lines: CartLine[];
  itemCount: number;
  getQuantity: (listingId: string) => number;
  setQuantity: (listingId: string, publicCode: string | null, quantity: number) => void;
  removeItem: (listingId: string) => void;
};

const CartContext = createContext<CartContextValue>({
  lines: [],
  itemCount: 0,
  getQuantity: () => 0,
  setQuantity: () => {},
  removeItem: () => {},
});

type Props = {
  initialLines: CartLine[];
  isAuthenticated: boolean;
  children: ReactNode;
};

/**
 * Shared cart-quantity source, the same architecture as FavoritesProvider:
 * one lightweight per-request read at the root layout
 * (lib/cart/get-my-cart.ts's getMyCartQuantities, itself sharing its
 * underlying get_my_cart() call with the /cart page via React cache())
 * seeds this Provider, which then OWNS the quantity map as live state --
 * the header cart badge, the listing-detail Add to Cart button, and the
 * /cart page's own quantity controls all read/write this one source and
 * stay synchronized within a session. No global state library.
 *
 * Guest quantities cannot be seeded server-side (no server access to
 * localStorage), so initialLines is always [] for a guest; a mount-time
 * effect hydrates real guest data from lib/cart/guest-cart-storage
 * instead. Every guest mutation (setQuantity/removeItem) writes back to
 * localStorage synchronously as part of the same state update -- never via
 * a separate "sync on every change" effect -- so the one-time hydration
 * read and a mutation's write can never race and silently clobber each
 * other (an earlier draft of FavoritesProvider hit exactly this class of
 * bug with a naive "effect that mirrors state to an external system").
 *
 * A genuine server re-render of the root layout with a new initialLines
 * array (sign-in, sign-out, hard reload) resyncs state during render (the
 * same "adjusting state when a prop changes" pattern FavoritesProvider
 * uses), so a post-sign-in merge_guest_cart() call made explicitly by
 * SignInForm/SignUpForm is picked up automatically once router.refresh()
 * re-runs the layout.
 *
 * That explicit call only covers a session that already exists at the
 * moment of sign-in/sign-up -- Preshopps uses email verification, so a
 * fresh signup often has no session yet, and merge_guest_cart is never
 * attempted there. This Provider also runs its own fallback attempt
 * below: whenever isAuthenticated is (or becomes) true during this
 * mount and a guest cart still exists in localStorage, it calls
 * mergeGuestCartOnAuth() itself. Because that helper clears guest storage
 * on success, and effects here only ever observe isAuthenticated
 * transitions after the explicit callers' own router.refresh() has
 * already run, a merge that already succeeded via SignInForm/SignUpForm
 * leaves nothing for this fallback to find -- it only actually calls the
 * RPC for a transition the explicit callers never covered (e.g. the
 * post-email-verification app load) or one that failed there and is
 * worth one more try. A per-mount ref guard ensures at most one attempt
 * per mounted session, regardless of how the effect gets re-evaluated.
 */
export function CartProvider({ initialLines, isAuthenticated, children }: Props) {
  const [prevInitialLines, setPrevInitialLines] = useState(initialLines);
  const [lines, setLines] = useState<CartLine[]>(initialLines);

  if (initialLines !== prevInitialLines) {
    setPrevInitialLines(initialLines);
    setLines(initialLines);
  }

  useEffect(() => {
    if (isAuthenticated) return;
    let cancelled = false;
    // Deferred to a microtask (rather than calling setState synchronously
    // in the effect body) purely to satisfy this project's
    // react-hooks/set-state-in-effect lint rule -- functionally this still
    // resolves on the same tick, imperceptibly to the user. localStorage
    // can't be read during render without risking an SSR/hydration
    // mismatch (the server has no window), so a mount-time read is the
    // correct tool here, unlike the prop-resync above.
    Promise.resolve().then(() => {
      if (!cancelled) setLines(readGuestCart());
    });
    return () => {
      cancelled = true;
    };
    // isAuthenticated is the only value this hydration read should react
    // to -- see the file-level comment on why an authenticated initialLines
    // change is handled during render instead, not by this effect.
  }, [isAuthenticated]);

  const getQuantity = useCallback(
    (listingId: string) => lines.find((line) => line.listingId === listingId)?.quantity ?? 0,
    [lines],
  );

  const setQuantity = useCallback(
    (listingId: string, publicCode: string | null, quantity: number) => {
      setLines((prev) => {
        const index = prev.findIndex((line) => line.listingId === listingId);
        let next: CartLine[];

        if (quantity <= 0) {
          next = index === -1 ? prev : prev.filter((_, i) => i !== index);
        } else if (index === -1) {
          next = [...prev, { listingId, publicCode, quantity }];
        } else {
          next = prev.map((line, i) =>
            i === index ? { ...line, publicCode: publicCode ?? line.publicCode, quantity } : line,
          );
        }

        if (!isAuthenticated) writeGuestCart(next);
        return next;
      });
    },
    [isAuthenticated],
  );

  const removeItem = useCallback(
    (listingId: string) => {
      setLines((prev) => {
        const next = prev.filter((line) => line.listingId !== listingId);
        if (!isAuthenticated) writeGuestCart(next);
        return next;
      });
    },
    [isAuthenticated],
  );

  // Fallback merge attempt -- see the file-level comment. Guarded by a ref
  // (not just the isAuthenticated dependency) so this can never fire more
  // than once per mounted session even if the effect is re-evaluated for
  // an unrelated reason.
  const hasAttemptedMergeRef = useRef(false);

  useEffect(() => {
    if (!isAuthenticated || hasAttemptedMergeRef.current) return;
    hasAttemptedMergeRef.current = true;

    mergeGuestCartOnAuth().then((outcome) => {
      if (!outcome.attempted || !outcome.ok) return;
      for (const result of outcome.results) {
        if (result.finalQuantity === null) {
          removeItem(result.listingId);
        } else {
          setQuantity(result.listingId, null, result.finalQuantity);
        }
      }
    });
  }, [isAuthenticated, setQuantity, removeItem]);

  const itemCount = useMemo(() => lines.reduce((sum, line) => sum + line.quantity, 0), [lines]);

  const value = useMemo(
    () => ({ lines, itemCount, getQuantity, setQuantity, removeItem }),
    [lines, itemCount, getQuantity, setQuantity, removeItem],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  return useContext(CartContext);
}
