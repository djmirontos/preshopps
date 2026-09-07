const STORAGE_KEY = "preshopps:guest-cart:v1";

/**
 * Minimal guest cart line: only what's needed to identify the listing and
 * how many the guest wants (per task instruction) -- publicCode is stored
 * alongside listingId (rather than instead of it) because both are needed
 * downstream for different reasons: listingId is what set_cart_item_quantity/
 * merge_guest_cart accept once the guest signs in, and publicCode is what
 * get_listing_detail (the only anon-safe read path) accepts to hydrate
 * fresh display data on /cart. No title/price/image is ever cached here --
 * that is always re-fetched from a safe public read path at render time
 * (see lib/cart/hydrate-guest-cart-client.ts), never trusted stale.
 */
export type GuestCartLine = {
  listingId: string;
  publicCode: string;
  quantity: number;
};

function isValidLine(value: unknown): value is GuestCartLine {
  if (!value || typeof value !== "object") return false;
  const line = value as Record<string, unknown>;
  return (
    typeof line.listingId === "string" &&
    line.listingId.length > 0 &&
    typeof line.publicCode === "string" &&
    line.publicCode.length > 0 &&
    typeof line.quantity === "number" &&
    Number.isInteger(line.quantity) &&
    line.quantity > 0
  );
}

/**
 * Safe parse with fallback: a corrupted/malformed value (bad JSON, wrong
 * shape, non-array, individual rows missing fields) never throws and never
 * surfaces to the caller -- it silently degrades to an empty cart rather
 * than crashing the page. Returns [] outside the browser (SSR) since
 * localStorage doesn't exist there.
 */
export function readGuestCart(): GuestCartLine[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidLine);
  } catch {
    return [];
  }
}

export function writeGuestCart(lines: ReadonlyArray<{ listingId: string; publicCode: string | null; quantity: number }>): void {
  if (typeof window === "undefined") return;
  try {
    const valid = lines.filter(
      (line): line is GuestCartLine => typeof line.publicCode === "string" && line.publicCode.length > 0 && line.quantity > 0,
    );
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(valid));
  } catch (err) {
    console.error("Failed to persist guest cart:", err instanceof Error ? err.message : err);
  }
}

export function clearGuestCart(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Best-effort cleanup only -- a failure here must never block sign-in.
  }
}
