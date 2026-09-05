type Props = {
  description: string | null;
};

/**
 * Same plain-text safety principle as ListingDescription: React text-node
 * escaping only, no dangerouslySetInnerHTML, no auto-linking, no markdown
 * -- a URL-looking substring in a shop's About text stays inert. Omitted
 * entirely when there's no description.
 */
export function ShopDescription({ description }: Props) {
  if (!description || !description.trim()) return null;

  return (
    <div>
      <h2 className="text-lg font-semibold text-ink">About</h2>
      <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-ink-secondary">{description}</p>
    </div>
  );
}
