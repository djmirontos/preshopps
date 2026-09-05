type Props = {
  q: string | null;
  categoryName: string | null;
  locationLabel: string | null;
};

/** browse_listings never returns a total row count, so this deliberately
 * never renders a "N results" figure -- only contextual labels the RPC
 * response actually supports. */
export function ResultsHeader({ q, categoryName, locationLabel }: Props) {
  const title = q ? `Search results for "${q}"` : (categoryName ?? "Marketplace");

  return (
    <div>
      <h1 className="text-xl font-semibold text-ink lg:text-2xl">{title}</h1>
      {locationLabel && <p className="mt-0.5 text-sm text-ink-muted">in {locationLabel}</p>}
    </div>
  );
}
