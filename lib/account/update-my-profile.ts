import { createClient } from "@/lib/supabase/client";

/**
 * Thin client wrapper around update_my_profile
 * (0092_account_profile_management.sql) -- the only write path for the
 * caller's own profile. No user id is ever sent; the RPC derives the
 * caller from auth.uid() itself. Client-side field validation in
 * AccountProfileForm mirrors these rules for UX only -- this RPC (and
 * its own DB CHECK constraints) remain the authoritative enforcement.
 */

type ErrorMap<Code extends string> = Record<Code | "UNKNOWN", string>;

function toErrorCode<Code extends string>(detail: string | undefined, known: ReadonlySet<string>): Code | "UNKNOWN" {
  return detail && known.has(detail) ? (detail as Code) : "UNKNOWN";
}

export type UpdateMyProfileInput = {
  displayName: string;
  avatarStoragePath: string | null;
  firstName: string | null;
  lastName: string | null;
  bio: string | null;
  mobileNumber: string | null;
  provinceId: number | null;
  cityId: number | null;
  barangayId: number | null;
};

export type UpdateMyProfileErrorCode =
  | "NOT_AUTHENTICATED"
  | "INTERACTION_BLOCKED"
  | "DISPLAY_NAME_REQUIRED"
  | "DISPLAY_NAME_TOO_LONG"
  | "FIRST_NAME_TOO_LONG"
  | "LAST_NAME_TOO_LONG"
  | "BIO_TOO_LONG"
  | "MOBILE_NUMBER_INVALID"
  | "INVALID_AVATAR_PATH"
  | "PROVINCE_REQUIRED"
  | "CITY_REQUIRED"
  | "INVALID_CITY_FOR_PROVINCE"
  | "INVALID_BARANGAY_FOR_CITY"
  | "PUBLIC_PROFILE_LOCKED";

const UPDATE_MY_PROFILE_ERROR_CODES: ReadonlySet<string> = new Set<UpdateMyProfileErrorCode>([
  "NOT_AUTHENTICATED",
  "INTERACTION_BLOCKED",
  "DISPLAY_NAME_REQUIRED",
  "DISPLAY_NAME_TOO_LONG",
  "FIRST_NAME_TOO_LONG",
  "LAST_NAME_TOO_LONG",
  "BIO_TOO_LONG",
  "MOBILE_NUMBER_INVALID",
  "INVALID_AVATAR_PATH",
  "PROVINCE_REQUIRED",
  "CITY_REQUIRED",
  "INVALID_CITY_FOR_PROVINCE",
  "INVALID_BARANGAY_FOR_CITY",
  "PUBLIC_PROFILE_LOCKED",
]);

export const UPDATE_MY_PROFILE_ERROR_MESSAGES: ErrorMap<UpdateMyProfileErrorCode> = {
  NOT_AUTHENTICATED: "Please sign in and try again.",
  INTERACTION_BLOCKED: "Your account isn't available right now.",
  DISPLAY_NAME_REQUIRED: "Enter a display name.",
  DISPLAY_NAME_TOO_LONG: "Display name must be 50 characters or fewer.",
  FIRST_NAME_TOO_LONG: "First name must be 50 characters or fewer.",
  LAST_NAME_TOO_LONG: "Last name must be 50 characters or fewer.",
  BIO_TOO_LONG: "Bio must be 300 characters or fewer.",
  MOBILE_NUMBER_INVALID: "Enter a valid mobile number.",
  INVALID_AVATAR_PATH: "We couldn't upload your photo. Please try again.",
  PROVINCE_REQUIRED: "Please choose a province.",
  CITY_REQUIRED: "Please choose a city or municipality.",
  INVALID_CITY_FOR_PROVINCE: "That city doesn't belong to the selected province. Please choose again.",
  INVALID_BARANGAY_FOR_CITY: "That barangay doesn't belong to the selected city. Please choose again.",
  PUBLIC_PROFILE_LOCKED: "Your public profile details can't be changed while your account is under review.",
  UNKNOWN: "We couldn't save your changes. Please try again.",
};

export type UpdateMyProfileResult = { ok: true; updatedAt: string } | { ok: false; code: UpdateMyProfileErrorCode | "UNKNOWN" };

type UpdateMyProfileRpcRow = { updated_at: string };

export async function updateMyProfile(input: UpdateMyProfileInput): Promise<UpdateMyProfileResult> {
  const supabase = createClient();

  try {
    const { data, error } = await supabase.rpc("update_my_profile", {
      p_display_name: input.displayName,
      p_avatar_storage_path: input.avatarStoragePath,
      p_first_name: input.firstName,
      p_last_name: input.lastName,
      p_bio: input.bio,
      p_mobile_number: input.mobileNumber,
      p_province_id: input.provinceId,
      p_city_id: input.cityId,
      p_barangay_id: input.barangayId,
    });

    if (error) {
      console.error("update_my_profile RPC failed:", error.message);
      return { ok: false, code: toErrorCode<UpdateMyProfileErrorCode>((error as { details?: string }).details, UPDATE_MY_PROFILE_ERROR_CODES) };
    }

    const row = ((data ?? []) as UpdateMyProfileRpcRow[])[0];
    if (!row) {
      return { ok: false, code: "UNKNOWN" };
    }

    return { ok: true, updatedAt: row.updated_at };
  } catch (err) {
    console.error("update_my_profile RPC threw:", err instanceof Error ? err.message : err);
    return { ok: false, code: "UNKNOWN" };
  }
}
