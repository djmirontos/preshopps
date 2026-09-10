import { createClient } from "@/lib/supabase/server";

/** dispute-images is a private bucket (0073) -- evidence is never served
 * through a public URL. Signed URLs are generated server-side, after the
 * caller has already passed get_dispute_detail/get_admin_dispute_detail's
 * own participant-or-admin authorization, and are themselves still
 * subject to the dispute_images_select_participants_or_admin storage
 * policy (0073) -- a caller who isn't entitled gets no signed URL at all,
 * not just a slower path to one. */
const SIGNED_URL_EXPIRY_SECONDS = 3600;

export async function getDisputeImageSignedUrl(storagePath: string): Promise<string | null> {
  const [bucket, ...rest] = storagePath.split("/");
  const path = rest.join("/");
  if (!bucket || !path) return null;

  const supabase = await createClient();

  try {
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, SIGNED_URL_EXPIRY_SECONDS);
    if (error || !data) {
      console.error(`createSignedUrl for ${bucket} failed:`, error?.message);
      return null;
    }
    return data.signedUrl;
  } catch (err) {
    console.error(`createSignedUrl for ${bucket} threw:`, err instanceof Error ? err.message : err);
    return null;
  }
}

export async function getDisputeImageSignedUrls(storagePaths: string[]): Promise<string[]> {
  const urls = await Promise.all(storagePaths.map(getDisputeImageSignedUrl));
  return urls.filter((url): url is string => Boolean(url));
}
