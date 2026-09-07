/** Client-safe (no framework/server imports), mirroring
 * lib/orders/format-order-date.ts's shape for this module. */
export function formatMessageTimestamp(iso: string): string {
  return new Date(iso).toLocaleString("en-PH", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
