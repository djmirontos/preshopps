/** Client-safe (no framework/server imports) so it can be used from both
 * the server-rendered order detail page and the client-side orders list. */
export function formatOrderDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" });
}
