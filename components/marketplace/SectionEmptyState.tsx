/**
 * Compact, intentional-looking placeholder -- not a large dashed rectangle
 * that exaggerates an empty marketplace. Shared by Fresh Finds/Pre-loved/
 * Brand New (zero listings or RPC failure) and the shop/search "load
 * failed" fallbacks.
 */
export function SectionEmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-[14px] border border-border bg-canvas px-4 py-5 text-center">
      <p className="text-sm text-ink-muted">{message}</p>
    </div>
  );
}
