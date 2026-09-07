import { createClient } from "@/lib/supabase/client";
import type { ShopStatus } from "@/lib/seller/get-my-shop-profile";

/**
 * Thin client wrappers around create_shop/update_shop
 * (0049_shop_create_update_rpcs.sql). No direct table write anywhere --
 * shops/shop_slugs both carry zero client write policies by design, so
 * every mutation goes through these two RPCs. Owner identity is always
 * derived by the RPC from auth.uid(); no owner/user id is ever sent from
 * the client, and neither RPC accepts is_trusted_seller or any admin-only
 * field, so a seller cannot self-mark Trusted Seller or touch suspension
 * state through this module no matter what a client sends.
 *
 * createShop's optional requestedSlug lets the seller customize their
 * shop's URL at creation time only (PRD 6.3) -- update_shop has no
 * equivalent parameter, since ongoing slug editing after creation is a
 * separate, not-yet-approved surface. Format and uniqueness (current AND
 * historical, against shop_slugs' single global namespace) are both
 * re-validated server-side regardless of what the client sends.
 */

type ErrorMap<Code extends string> = Record<Code | "UNKNOWN", string>;

function toErrorCode<Code extends string>(detail: string | undefined, known: ReadonlySet<string>): Code | "UNKNOWN" {
  return detail && known.has(detail) ? (detail as Code) : "UNKNOWN";
}

export type ShopFormInput = {
  name: string;
  description: string | null;
  provinceId: number | null;
  cityId: number | null;
  barangayId: number | null;
  messengerLink: string | null;
  logoStoragePath: string | null;
};

// ============================================================
// createShop (create_shop)
// ============================================================

export type CreateShopErrorCode =
  | "NOT_AUTHENTICATED"
  | "SHOP_ALREADY_EXISTS"
  | "NAME_REQUIRED"
  | "NAME_TOO_LONG"
  | "DESCRIPTION_TOO_LONG"
  | "PROVINCE_REQUIRED"
  | "CITY_REQUIRED"
  | "INVALID_CITY_FOR_PROVINCE"
  | "INVALID_BARANGAY_FOR_CITY"
  | "MESSENGER_LINK_TOO_LONG"
  | "INVALID_MESSENGER_LINK"
  | "INVALID_LOGO_PATH"
  | "SLUG_INVALID"
  | "SLUG_UNAVAILABLE";

const CREATE_SHOP_ERROR_CODES: ReadonlySet<string> = new Set<CreateShopErrorCode>([
  "NOT_AUTHENTICATED",
  "SHOP_ALREADY_EXISTS",
  "NAME_REQUIRED",
  "NAME_TOO_LONG",
  "DESCRIPTION_TOO_LONG",
  "PROVINCE_REQUIRED",
  "CITY_REQUIRED",
  "INVALID_CITY_FOR_PROVINCE",
  "INVALID_BARANGAY_FOR_CITY",
  "MESSENGER_LINK_TOO_LONG",
  "INVALID_MESSENGER_LINK",
  "INVALID_LOGO_PATH",
  "SLUG_INVALID",
  "SLUG_UNAVAILABLE",
]);

export const CREATE_SHOP_ERROR_MESSAGES: ErrorMap<CreateShopErrorCode> = {
  NOT_AUTHENTICATED: "Please sign in and try again.",
  SHOP_ALREADY_EXISTS: "You already have a shop.",
  NAME_REQUIRED: "Please enter a shop name.",
  NAME_TOO_LONG: "Shop name is too long. Please shorten it to 80 characters or fewer.",
  DESCRIPTION_TOO_LONG: "Description is too long. Please shorten it to 1000 characters or fewer.",
  PROVINCE_REQUIRED: "Please choose a province.",
  CITY_REQUIRED: "Please choose a city or municipality.",
  INVALID_CITY_FOR_PROVINCE: "That city doesn't belong to the selected province. Please choose again.",
  INVALID_BARANGAY_FOR_CITY: "That barangay doesn't belong to the selected city. Please choose again.",
  MESSENGER_LINK_TOO_LONG: "Messenger link is too long.",
  INVALID_MESSENGER_LINK: "Please enter a valid web address for your Messenger link.",
  INVALID_LOGO_PATH: "There was a problem with your logo image. Please try uploading it again.",
  SLUG_INVALID: "Shop URL must be lowercase letters, numbers, and hyphens only.",
  SLUG_UNAVAILABLE: "That shop URL is already taken. Try another one.",
  UNKNOWN: "Something went wrong. Please try again.",
};

export type CreateShopResult =
  | { ok: true; shopId: string; slug: string; createdAt: string }
  | { ok: false; code: CreateShopErrorCode | "UNKNOWN" };

type CreateShopRpcRow = { shop_id: string; slug: string; created_at: string };

/**
 * `requestedSlug` is optional (PRD 6.3: seller may edit the slug during
 * setup) -- omitted/null preserves the original server-generated-from-name
 * behavior untouched. The backend remains authoritative for both format
 * and uniqueness (0049_shop_create_update_rpcs.sql) regardless of what is
 * sent here.
 */
export async function createShop(input: ShopFormInput, requestedSlug?: string | null): Promise<CreateShopResult> {
  const supabase = createClient();

  try {
    const { data, error } = await supabase.rpc("create_shop", {
      p_name: input.name,
      p_description: input.description,
      p_province_id: input.provinceId,
      p_city_id: input.cityId,
      p_barangay_id: input.barangayId,
      p_messenger_link: input.messengerLink,
      p_logo_storage_path: input.logoStoragePath,
      p_slug: requestedSlug ?? null,
    });

    if (error) {
      console.error("create_shop RPC failed:", error.message);
      return { ok: false, code: toErrorCode<CreateShopErrorCode>((error as { details?: string }).details, CREATE_SHOP_ERROR_CODES) };
    }

    const row = ((data ?? []) as CreateShopRpcRow[])[0];
    if (!row) {
      return { ok: false, code: "UNKNOWN" };
    }

    return { ok: true, shopId: row.shop_id, slug: row.slug, createdAt: row.created_at };
  } catch (err) {
    console.error("create_shop RPC threw:", err instanceof Error ? err.message : err);
    return { ok: false, code: "UNKNOWN" };
  }
}

// ============================================================
// updateShop (update_shop)
// ============================================================

export type UpdateShopErrorCode =
  | "NOT_AUTHENTICATED"
  | "SHOP_NOT_FOUND"
  | "NAME_REQUIRED"
  | "NAME_TOO_LONG"
  | "DESCRIPTION_TOO_LONG"
  | "PROVINCE_REQUIRED"
  | "CITY_REQUIRED"
  | "INVALID_CITY_FOR_PROVINCE"
  | "INVALID_BARANGAY_FOR_CITY"
  | "MESSENGER_LINK_TOO_LONG"
  | "INVALID_MESSENGER_LINK"
  | "INVALID_LOGO_PATH";

const UPDATE_SHOP_ERROR_CODES: ReadonlySet<string> = new Set<UpdateShopErrorCode>([
  "NOT_AUTHENTICATED",
  "SHOP_NOT_FOUND",
  "NAME_REQUIRED",
  "NAME_TOO_LONG",
  "DESCRIPTION_TOO_LONG",
  "PROVINCE_REQUIRED",
  "CITY_REQUIRED",
  "INVALID_CITY_FOR_PROVINCE",
  "INVALID_BARANGAY_FOR_CITY",
  "MESSENGER_LINK_TOO_LONG",
  "INVALID_MESSENGER_LINK",
  "INVALID_LOGO_PATH",
]);

export const UPDATE_SHOP_ERROR_MESSAGES: ErrorMap<UpdateShopErrorCode> = {
  NOT_AUTHENTICATED: "Please sign in and try again.",
  SHOP_NOT_FOUND: "We couldn't find your shop. Please refresh and try again.",
  NAME_REQUIRED: "Please enter a shop name.",
  NAME_TOO_LONG: "Shop name is too long. Please shorten it to 80 characters or fewer.",
  DESCRIPTION_TOO_LONG: "Description is too long. Please shorten it to 1000 characters or fewer.",
  PROVINCE_REQUIRED: "Please choose a province.",
  CITY_REQUIRED: "Please choose a city or municipality.",
  INVALID_CITY_FOR_PROVINCE: "That city doesn't belong to the selected province. Please choose again.",
  INVALID_BARANGAY_FOR_CITY: "That barangay doesn't belong to the selected city. Please choose again.",
  MESSENGER_LINK_TOO_LONG: "Messenger link is too long.",
  INVALID_MESSENGER_LINK: "Please enter a valid web address for your Messenger link.",
  INVALID_LOGO_PATH: "There was a problem with your logo image. Please try uploading it again.",
  UNKNOWN: "Something went wrong. Please try again.",
};

export type UpdateShopResult =
  | { ok: true; shopId: string; slug: string; updatedAt: string }
  | { ok: false; code: UpdateShopErrorCode | "UNKNOWN" };

type UpdateShopRpcRow = { shop_id: string; slug: string; updated_at: string };

export async function updateShop(input: ShopFormInput, status: ShopStatus): Promise<UpdateShopResult> {
  const supabase = createClient();

  try {
    const { data, error } = await supabase.rpc("update_shop", {
      p_name: input.name,
      p_description: input.description,
      p_province_id: input.provinceId,
      p_city_id: input.cityId,
      p_barangay_id: input.barangayId,
      p_messenger_link: input.messengerLink,
      p_logo_storage_path: input.logoStoragePath,
      p_status: status,
    });

    if (error) {
      console.error("update_shop RPC failed:", error.message);
      return { ok: false, code: toErrorCode<UpdateShopErrorCode>((error as { details?: string }).details, UPDATE_SHOP_ERROR_CODES) };
    }

    const row = ((data ?? []) as UpdateShopRpcRow[])[0];
    if (!row) {
      return { ok: false, code: "UNKNOWN" };
    }

    return { ok: true, shopId: row.shop_id, slug: row.slug, updatedAt: row.updated_at };
  } catch (err) {
    console.error("update_shop RPC threw:", err instanceof Error ? err.message : err);
    return { ok: false, code: "UNKNOWN" };
  }
}
