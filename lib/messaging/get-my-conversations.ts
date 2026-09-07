import { createClient } from "@/lib/supabase/server";
import { getListingImageUrl } from "@/lib/marketplace/listing-image-url";

export type ConversationType = "listing_inquiry" | "general_shop";
export type ViewerRole = "initiator" | "seller";

/**
 * Row shape exactly matching public.get_my_conversations' RETURNS TABLE
 * (0046_messaging_read_rpcs.sql).
 */
export type GetMyConversationsRow = {
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
  listing_cover_image_storage_path: string | null;
  other_party_display_name: string | null;
  other_party_avatar_storage_path: string | null;
  last_message_at: string;
  last_message_preview: string | null;
  last_message_is_mine: boolean;
  is_unread: boolean;
  is_archived: boolean;
  is_muted: boolean;
};

export type ConversationSummary = {
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
  listingImageUrl: string | undefined;
  /** Only populated when viewerRole is "seller" (the buyer's own name) --
   * for "initiator", the shop itself IS the other party, so use shopName. */
  otherPartyDisplayName: string | null;
  otherPartyAvatarUrl: string | undefined;
  lastMessageAt: string;
  lastMessagePreview: string | null;
  lastMessageIsMine: boolean;
  isUnread: boolean;
  isArchived: boolean;
  isMuted: boolean;
};

export type ConversationsCursor = {
  lastMessageAt: string;
  id: string;
};

export type GetMyConversationsResult = {
  conversations: ConversationSummary[];
  hadError: boolean;
  nextCursor: ConversationsCursor | null;
};

function mapRow(row: GetMyConversationsRow): ConversationSummary {
  return {
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
    listingImageUrl: getListingImageUrl(row.listing_cover_image_storage_path),
    otherPartyDisplayName: row.other_party_display_name,
    otherPartyAvatarUrl: getListingImageUrl(row.other_party_avatar_storage_path),
    lastMessageAt: row.last_message_at,
    lastMessagePreview: row.last_message_preview,
    lastMessageIsMine: row.last_message_is_mine,
    isUnread: row.is_unread,
    isArchived: row.is_archived,
    isMuted: row.is_muted,
  };
}

/**
 * Union of "conversations I started" and "conversations sent to my shop" --
 * one inbox, per PRD 25 (an account may act as both buyer and seller).
 * archived=false (default) is the main inbox view; archived=true is the
 * separate archived list (PRD 25.8: archive hides from the main inbox but
 * preserves history/access).
 */
export async function getMyConversations(
  limit: number,
  cursor?: ConversationsCursor,
  archived = false,
): Promise<GetMyConversationsResult> {
  const supabase = await createClient();

  let data: unknown;
  let error: { message: string } | null;

  try {
    ({ data, error } = await supabase.rpc("get_my_conversations", {
      p_limit: limit,
      p_before_last_message_at: cursor?.lastMessageAt ?? null,
      p_before_id: cursor?.id ?? null,
      p_archived: archived,
    }));
  } catch (err) {
    console.error("get_my_conversations RPC threw:", err instanceof Error ? err.message : err);
    return { conversations: [], hadError: true, nextCursor: null };
  }

  if (error) {
    console.error("get_my_conversations RPC failed:", error.message);
    return { conversations: [], hadError: true, nextCursor: null };
  }

  const rows = (data ?? []) as GetMyConversationsRow[];
  const conversations = rows.map(mapRow);
  const nextCursor =
    rows.length === limit
      ? { lastMessageAt: rows[rows.length - 1].last_message_at, id: rows[rows.length - 1].conversation_id }
      : null;

  return { conversations, hadError: false, nextCursor };
}
