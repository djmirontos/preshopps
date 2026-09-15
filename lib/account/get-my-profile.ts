import { createClient } from "@/lib/supabase/server";
import { getListingImageUrl } from "@/lib/marketplace/listing-image-url";

/**
 * The caller's own private profile, read exclusively through the
 * get_my_profile() RPC (0092_account_profile_management.sql) -- never a
 * direct `.from("profiles")` select. Email is deliberately absent here:
 * it lives in Supabase Auth, not in this RPC's return shape, and callers
 * must source it from the authenticated session (getAuthUser()) instead.
 */
export type MyProfile = {
  id: string;
  displayName: string;
  avatarStoragePath: string | null;
  avatarUrl: string | undefined;
  firstName: string | null;
  lastName: string | null;
  bio: string | null;
  mobileNumber: string | null;
  provinceId: number | null;
  cityId: number | null;
  barangayId: number | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type GetMyProfileRpcRow = {
  id: string;
  display_name: string;
  avatar_storage_path: string | null;
  first_name: string | null;
  last_name: string | null;
  bio: string | null;
  mobile_number: string | null;
  province_id: number | null;
  city_id: number | null;
  barangay_id: number | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
};

export type GetMyProfileResult = { profile: MyProfile; hadError: false } | { profile: null; hadError: true };

export async function getMyProfile(): Promise<GetMyProfileResult> {
  const supabase = await createClient();

  let data: unknown;
  let error: { message: string } | null;

  try {
    ({ data, error } = await supabase.rpc("get_my_profile"));
  } catch (err) {
    console.error("get_my_profile RPC threw:", err instanceof Error ? err.message : err);
    return { profile: null, hadError: true };
  }

  if (error) {
    console.error("get_my_profile RPC failed:", error.message);
    return { profile: null, hadError: true };
  }

  const row = ((data ?? []) as GetMyProfileRpcRow[])[0];
  if (!row) {
    return { profile: null, hadError: true };
  }

  return {
    profile: {
      id: row.id,
      displayName: row.display_name,
      avatarStoragePath: row.avatar_storage_path,
      avatarUrl: getListingImageUrl(row.avatar_storage_path),
      firstName: row.first_name,
      lastName: row.last_name,
      bio: row.bio,
      mobileNumber: row.mobile_number,
      provinceId: row.province_id,
      cityId: row.city_id,
      barangayId: row.barangay_id,
      deletedAt: row.deleted_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    },
    hadError: false,
  };
}
