import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

type Props = {
  categoryName: string;
  title: string;
};

/**
 * Mobile: a plain back link. Desktop: a light Home / Category / Title
 * breadcrumb. Category is shown as plain text, not a link -- get_listing_
 * detail returns category_name but no category_slug, and fabricating one
 * from the name would risk pointing at the wrong /search?category= filter.
 */
export function ListingBreadcrumb({ categoryName, title }: Props) {
  return (
    <div className="mb-4">
      <Link
        href="/search"
        className="inline-flex h-11 items-center gap-1 rounded text-sm font-medium text-ink-secondary hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand lg:hidden"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        Back
      </Link>

      <nav aria-label="Breadcrumb" className="hidden lg:block">
        <ol className="flex items-center gap-1.5 text-sm text-ink-secondary">
          <li>
            <Link
              href="/"
              className="rounded hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              Home
            </Link>
          </li>
          <li aria-hidden="true">
            <ChevronRight className="h-3.5 w-3.5" />
          </li>
          <li>{categoryName}</li>
          <li aria-hidden="true">
            <ChevronRight className="h-3.5 w-3.5" />
          </li>
          <li className="max-w-xs truncate text-ink" aria-current="page">
            {title}
          </li>
        </ol>
      </nav>
    </div>
  );
}
