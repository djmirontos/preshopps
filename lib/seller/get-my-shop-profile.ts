import { createClient } from "@/lib/supabase/server";
import { getListingImageUrl } from "@/lib/marketplace/listing-image-url";

export type ShopStatus = "active" | "away";

export type MyShopProfile = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  logoStoragePath: string | null;
  logoUrl: string | undefined;
  provinceId: number;
  cityId: number;
  barangayId: number | null;
  messengerLink: string | null;
  status: ShopStatus;
  featuredListingId: string | null;
};

/**
 * The seller's own full, editable shop row -- a sibling to
 * lib/seller/get-my-shop.ts's narrow {id, slug, name} shape (kept
 * unchanged, since ShopMessageAction/ShopPage's ownership check don't need
 * anything more and shouldn't be made to fetch columns they don't use).
 * This one exists specifically for the shop setup/edit form, which needs
 * the raw location ids (not get_shop_detail's public display names) to
 * prefill the province/city/barangay selects.
 *
 * Reuses the same shops_select_owner RLS policy (0031_messaging_rls_and_
 * rpcs.sql: SELECT, `to authenticated`, `using (auth.uid() = owner_id)`)
 * via a plain direct-table read -- RLS is row-level, not column-level, so
 * the owner can already read every column of their own row; no new
 * migration/RPC is needed just to widen which columns this read selects.
 * A guest or a user with no shop both simply see zero rows (RLS
 * default-deny for an unauthenticated caller; a real "no shop yet" case
 * for an authenticated one) -- this function does not distinguish them,
 * returning null either way; callers gate on authentication separately.
 */
export async function getMyShopProfile(): Promise<MyShopProfile | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("shops")
    .select(
      "id, slug, name, description, logo_storage_path, province_id, city_id, barangay_id, messenger_link, status, featured_listing_id",
    )
    .maybeSingle();

  if (error) {
    console.error("Failed to load my shop profile:", error.message);
    return null;
  }

  if (!data) return null;

  return {
    id: data.id,
    slug: data.slug,
    name: data.name,
    description: data.description,
    logoStoragePath: data.logo_storage_path,
    logoUrl: getListingImageUrl(data.logo_storage_path),
    provinceId: data.province_id,
    cityId: data.city_id,
    barangayId: data.barangay_id,
    messengerLink: data.messenger_link,
    status: data.status,
    featuredListingId: data.featured_listing_id,
  };
}
