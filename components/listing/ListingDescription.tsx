type Props = {
  description: string;
  knownFlaws: string | null;
};

/**
 * Renders as plain text only. Canon requires external URLs in listing
 * descriptions to be neutralized: React's default text-node escaping
 * already prevents markup injection, and rendering into a <p> (never
 * dangerouslySetInnerHTML, never an auto-linker) means a URL-looking
 * substring is just inert text -- it can never become a clickable
 * anchor. `whitespace-pre-wrap` preserves the seller's line breaks
 * without any markdown/HTML parsing.
 */
export function ListingDescription({ description, knownFlaws }: Props) {
  return (
    <div>
      <h2 className="text-lg font-semibold text-ink">Description</h2>
      <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-ink-secondary">{description}</p>

      {knownFlaws && (
        <div className="mt-4">
          <h3 className="text-sm font-semibold text-ink">Known flaws</h3>
          <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-ink-secondary">{knownFlaws}</p>
        </div>
      )}
    </div>
  );
}
