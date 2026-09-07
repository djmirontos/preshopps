import { getListingImageUrl } from "@/lib/marketplace/listing-image-url";
import type { FulfillmentMethod } from "@/lib/marketplace/search-params";

/**
 * Row shape exactly matching public.get_my_cart's RETURNS TABLE
 * (0037_favorites_cart_rls_and_rpcs.sql; cart_item_id and
 * fulfillment_methods added by 0041_get_my_cart_projection_fix.sql). Kept
 * in its own client-safe module (no server-only import) so both the
 * server read path (lib/cart/get-my-cart.ts) and the client-side refresh
 * path (lib/cart/refresh-my-cart-client.ts, needed after an order-
 * submission attempt so the cart can update without a full page reload)
 * share one mapping implementation and can never drift.
 */
export type GetMyCartRow = {
  cart_item_id: string;
  listing_id: string;
  public_code: string | null;
  slug: string | null;
  title: string | null;
  cover_image_storage_path: string | null;
  price_cents: number | null;
  price_cents_snapshot: number;
  price_changed: boolean | null;
  status: string;
  is_inquiry_only: boolean | null;
  requested_quantity: number;
  current_available_quantity: number | null;
  is_submittable: boolean;
  unavailable_reason: string | null;
  shop_id: string | null;
  shop_slug: string | null;
  shop_name: string | null;
  /** Null for a hidden (paused/draft/suspended-shop) row -- the same
   * is_hidden gate applied to public_code/slug/title/price_cents/etc. A
   * visible row with no configured methods gets [], never null. */
  fulfillment_methods: FulfillmentMethod[] | null;
  added_at: string;
};

export type CartLineDisplay = {
  cartItemId: string;
  listingId: string;
  publicCode: string | null;
  title: string | null;
  imageUrl: string | undefined;
  priceCents: number | null;
  priceCentsSnapshot: number;
  priceChanged: boolean;
  status: string;
  isInquiryOnly: boolean;
  quantity: number;
  availableQuantity: number | null;
  isSubmittable: boolean;
  unavailableReason: string | null;
  shopId: string | null;
  shopSlug: string | null;
  shopName: string | null;
  /** [] for a hidden/unavailable row (nothing to offer) or a visible
   * listing with no configured methods -- never used to guess a method,
   * only to narrow what's offered. */
  fulfillmentMethods: FulfillmentMethod[];
  addedAt: string;
};

export function mapCartRowToDisplay(row: GetMyCartRow): CartLineDisplay {
  return {
    cartItemId: row.cart_item_id,
    listingId: row.listing_id,
    publicCode: row.public_code,
    title: row.title,
    imageUrl: getListingImageUrl(row.cover_image_storage_path),
    priceCents: row.price_cents,
    priceCentsSnapshot: row.price_cents_snapshot,
    priceChanged: row.price_changed ?? false,
    status: row.status,
    isInquiryOnly: row.is_inquiry_only ?? false,
    quantity: row.requested_quantity,
    availableQuantity: row.current_available_quantity,
    isSubmittable: row.is_submittable,
    unavailableReason: row.unavailable_reason,
    shopId: row.shop_id,
    shopSlug: row.shop_slug,
    shopName: row.shop_name,
    fulfillmentMethods: row.fulfillment_methods ?? [],
    addedAt: row.added_at,
  };
}
