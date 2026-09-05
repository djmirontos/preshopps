type Props = {
  categoryName: string;
  postedLabel: string;
  publicCode: string;
};

/** Deliberately small: category, posted date, and the public listing
 * code (a support-friendly reference, never the internal UUID). Type/
 * condition/location are already shown in the header above and are not
 * repeated here. */
export function ListingMeta({ categoryName, postedLabel, publicCode }: Props) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
      <div>
        <dt className="text-ink-muted">Category</dt>
        <dd className="text-ink-secondary">{categoryName}</dd>
      </div>
      <div>
        <dt className="text-ink-muted">Posted</dt>
        <dd className="text-ink-secondary">{postedLabel}</dd>
      </div>
      <div>
        <dt className="text-ink-muted">Listing ID</dt>
        <dd className="text-ink-secondary">{publicCode}</dd>
      </div>
    </dl>
  );
}
