import { createClient } from "@/lib/supabase/client";
import { getListingImageUrl } from "@/lib/marketplace/listing-image-url";
import type { GuestCartLine } from "@/lib/cart/guest-cart-storage";

export type HydratedGuestCartLine = {
  listingId: string;
  publicCode: string;
  quantity: number;
  /** false when get_listing_detail returned nothing for this public_code --
   * a nonexistent, draft, paused, or suspended-shop listing all collapse
   * to this same signal (privacy rule, per 0036's own design), so this
   * never distinguishes "deleted" from "temporarily hidden". */
  found: boolean;
  title: string | null;
  imageUrl: string | undefined;
  priceCents: number | null;
  availableQuantity: number | null;
  isInquiryOnly: boolean;
  status: "available" | "reserved" | "sold" | "archived" | null;
  shopId: string | null;
  shopName: string | null;
};

type GetListingDetailRpcRow = {
  listing_id: string;
  title: string;
  price_cents: number;
  status: "available" | "reserved" | "sold" | "archived";
  available_quantity: number;
  is_inquiry_only: boolean;
  image_paths: string[];
  shop_id: string;
  shop_name: string;
};

function notFoundLine(line: GuestCartLine): HydratedGuestCartLine {
  return {
    listingId: line.listingId,
    publicCode: line.publicCode,
    quantity: line.quantity,
    found: false,
    title: null,
    imageUrl: undefined,
    priceCents: null,
    availableQuantity: null,
    isInquiryOnly: false,
    status: null,
    shopId: null,
    shopName: null,
  };
}

/**
 * Hydrates each guest cart line's display data via the same public
 * get_listing_detail RPC the listing detail page itself uses (anon-
 * grantable, confirmed live in 0036_public_marketplace_read_rpcs.sql) --
 * guest cart storage only ever holds {listingId, publicCode, quantity}
 * (lib/cart/guest-cart-storage.ts), never trusting stale cached title/
 * price/image captured whenever the item was originally added.
 *
 * Called once per distinct guest cart line, in parallel via Promise.all --
 * bounded by how many distinct listings a guest has actually added to
 * their own cart, not by marketplace catalog size, so this is not the
 * per-card-in-a-grid N+1 pattern the rest of the marketplace deliberately
 * avoids (ListingCard/browse feeds never do this). No batch-by-listing-ids
 * read path exists in the current backend to do better than this: browse_
 * listings has no id-array filter, and there is no public SELECT policy on
 * the listings table itself (browsing is RPC-only) -- see the Cart module
 * report for this documented, accepted limitation rather than a silently
 * invented batch RPC.
 */
export async function hydrateGuestCartLines(lines: GuestCartLine[]): Promise<HydratedGuestCartLine[]> {
  const supabase = createClient();

  return Promise.all(
    lines.map(async (line): Promise<HydratedGuestCartLine> => {
      try {
        const { data, error } = await supabase.rpc("get_listing_detail", { p_public_code: line.publicCode });
        const rows = (data ?? []) as GetListingDetailRpcRow[];

        if (error || rows.length === 0) {
          return notFoundLine(line);
        }

        const row = rows[0];
        return {
          listingId: line.listingId,
          publicCode: line.publicCode,
          quantity: line.quantity,
          found: true,
          title: row.title,
          imageUrl: getListingImageUrl(row.image_paths?.[0] ?? null),
          priceCents: row.price_cents,
          availableQuantity: row.available_quantity,
          isInquiryOnly: row.is_inquiry_only,
          status: row.status,
          shopId: row.shop_id,
          shopName: row.shop_name,
        };
      } catch (err) {
        console.error("get_listing_detail RPC threw during guest cart hydration:", err instanceof Error ? err.message : err);
        return notFoundLine(line);
      }
    }),
  );
}
