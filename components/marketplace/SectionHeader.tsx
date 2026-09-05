import Link from "next/link";

type SectionHeaderProps = {
  id?: string;
  title: string;
  eyebrow?: string;
  viewAllHref?: string;
};

export function SectionHeader({ id, title, eyebrow, viewAllHref }: SectionHeaderProps) {
  return (
    <div className="mb-3 flex items-end justify-between gap-4">
      <div>
        {eyebrow && (
          <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">{eyebrow}</p>
        )}
        <h2 id={id} className="text-lg font-semibold text-ink lg:text-xl">
          {title}
        </h2>
      </div>
      {viewAllHref && (
        <Link
          href={viewAllHref}
          className="shrink-0 rounded text-sm font-medium text-brand-hover hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          View all →
        </Link>
      )}
    </div>
  );
}
