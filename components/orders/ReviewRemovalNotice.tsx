type Props = {
  publicMessage: string | null;
};

/**
 * Buyer-facing notice shown when the buyer's own review was removed by
 * moderation. publicMessage is the user-facing reason only. React escapes
 * the text content. The private admin note is never passed to this component.
 */
export function ReviewRemovalNotice({ publicMessage }: Props) {
  return (
    <div role="status" className="mt-4 rounded-[14px] border border-border bg-surface p-4">
      <p className="text-sm font-semibold text-ink">This review was removed after a moderation review.</p>
      {publicMessage && <p className="mt-2 text-sm text-ink-secondary">Reason: {publicMessage}</p>}
      <p className="mt-2 text-xs text-ink-muted">It is no longer shown publicly and can&rsquo;t be edited.</p>
    </div>
  );
}

/**
 * Neutral notice for an unconfirmed visibility state (reader error or a
 * malformed response). It never claims the review is visible or removed. Edit
 * and reply protections are enforced server-side regardless of this notice.
 */
export function ReviewVisibilityUnknownNotice() {
  return (
    <div role="status" className="mt-4 rounded-[14px] border border-border bg-surface p-4">
      <p className="text-sm font-semibold text-ink">Review visibility could not be confirmed.</p>
      <p className="mt-2 text-xs text-ink-muted">Reload this page to check again.</p>
    </div>
  );
}
