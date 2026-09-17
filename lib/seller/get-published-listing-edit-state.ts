import { createClient } from "@/lib/supabase/server";
import { mapGetPublishedListingEditStateResponse, type GetPublishedListingEditStateResult } from "@/lib/seller/published-listing-edit-state";

export type { GetPublishedListingEditStateResult, PublishedListingEditState } from "@/lib/seller/published-listing-edit-state";

/**
 * Server-safe counterpart to published-listing-actions.ts's own
 * getPublishedListingEditState -- for Server Component callers only (today,
 * exactly one: app/sell/[listingId]/edit/page.tsx's own initial render).
 *
 * Uses @/lib/supabase/server (the cookie-aware createServerClient, same as
 * lib/seller/get-my-listing.ts), never @/lib/supabase/client. That
 * distinction is the entire reason this file exists: a browser Supabase
 * client constructed during SSR has no cookies to read and silently carries
 * no session, so every RPC call it makes executes as `anon` -- which
 * get_published_listing_edit_state correctly rejects (anon has no EXECUTE
 * grant on it), surfacing as "permission denied for function
 * get_published_listing_edit_state" despite `authenticated` already having
 * that exact grant. Routing this Server Component's call through the
 * cookie-aware client instead (as getMyListing already does) resolves that
 * without touching any grant.
 *
 * Shares its exact result/error mapping with the browser wrapper via
 * mapGetPublishedListingEditStateResponse (published-listing-edit-state.ts)
 * -- only the Supabase client construction differs between the two files.
 * PublishedListingEditor's own "Reload latest" action keeps calling the
 * browser version in published-listing-actions.ts; it runs in a real
 * browser with a real session, so it was never affected by this bug.
 */
export async function getPublishedListingEditState(listingId: string): Promise<GetPublishedListingEditStateResult> {
  const supabase = await createClient();

  let data: unknown;
  let error: { message: string; details?: string } | null;

  try {
    ({ data, error } = await supabase.rpc("get_published_listing_edit_state", { p_listing_id: listingId }));
  } catch (err) {
    console.error("get_published_listing_edit_state RPC threw:", err instanceof Error ? err.message : err);
    return { status: "error" };
  }

  return mapGetPublishedListingEditStateResponse(data, error);
}
