import { createClient } from "@/lib/supabase/server";
import { getListingImageUrl } from "@/lib/marketplace/listing-image-url";
import type { ConversationType, ViewerRole } from "@/lib/messaging/get-my-conversations";
import type { ListingStatus } from "@/lib/marketplace/listing-detail";

export type GetConversationContextRow = {
  conversation_id: string;
  conversation_type: ConversationType;
  viewer_role: ViewerRole;
  shop_id: string;
  shop_slug: string;
  shop_name: string;
  shop_logo_storage_path: string | null;
  listing_id: string | null;
  listing_public_code: string | null;
  listing_title: string | null;
  listing_status: ListingStatus | null;
  listing_cover_image_storage_path: string | null;
  other_party_display_name: string | null;
  other_party_avatar_storage_path: string | null;
  is_archived: boolean;
  is_muted: boolean;
  can_send: boolean;
};

export type ConversationContext = {
  conversationId: string;
  conversationType: ConversationType;
  viewerRole: ViewerRole;
  shopId: string;
  shopSlug: string;
  shopName: string;
  shopLogoUrl: string | undefined;
  listingId: string | null;
  listingPublicCode: string | null;
  listingTitle: string | null;
  listingStatus: ListingStatus | null;
  listingImageUrl: string | undefined;
  otherPartyDisplayName: string | null;
  otherPartyAvatarUrl: string | undefined;
  isArchived: boolean;
  isMuted: boolean;
  canSend: boolean;
};

export type ConversationContextResult = { status: "found"; context: ConversationContext } | { status: "not_found" } | { status: "error" };

/**
 * A conversation the caller does not participate in, or a nonexistent id,
 * both resolve to zero rows from get_conversation_context -- mapped
 * identically to "not_found" -> Next's notFound(), exactly mirroring
 * get_my_order_detail's established privacy pattern.
 */
export async function getConversationContext(conversationId: string): Promise<ConversationContextResult> {
  const supabase = await createClient();

  let data: unknown;
  let error: { message: string } | null;

  try {
    ({ data, error } = await supabase.rpc("get_conversation_context", { p_conversation_id: conversationId }));
  } catch (err) {
    console.error("get_conversation_context RPC threw:", err instanceof Error ? err.message : err);
    return { status: "error" };
  }

  if (error) {
    console.error("get_conversation_context RPC failed:", error.message);
    return { status: "error" };
  }

  const rows = (data ?? []) as GetConversationContextRow[];
  if (rows.length === 0) {
    return { status: "not_found" };
  }

  const row = rows[0];

  return {
    status: "found",
    context: {
      conversationId: row.conversation_id,
      conversationType: row.conversation_type,
      viewerRole: row.viewer_role,
      shopId: row.shop_id,
      shopSlug: row.shop_slug,
      shopName: row.shop_name,
      shopLogoUrl: getListingImageUrl(row.shop_logo_storage_path),
      listingId: row.listing_id,
      listingPublicCode: row.listing_public_code,
      listingTitle: row.listing_title,
      listingStatus: row.listing_status,
      listingImageUrl: getListingImageUrl(row.listing_cover_image_storage_path),
      otherPartyDisplayName: row.other_party_display_name,
      otherPartyAvatarUrl: getListingImageUrl(row.other_party_avatar_storage_path),
      isArchived: row.is_archived,
      isMuted: row.is_muted,
      canSend: row.can_send,
    },
  };
}
