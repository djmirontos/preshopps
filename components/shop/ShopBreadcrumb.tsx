import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

type Props = {
  shopName: string;
};

/** Mobile: a plain back link. Desktop: a light Home / Shop Name
 * breadcrumb -- mirrors ListingBreadcrumb's shape, no complex system. */
export function ShopBreadcrumb({ shopName }: Props) {
  return (
    <div className="mb-4">
      <Link
        href="/search"
        className="inline-flex h-11 items-center gap-1 rounded text-sm font-medium text-ink-secondary hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand lg:hidden"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        Back to marketplace
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
          <li className="max-w-xs truncate text-ink" aria-current="page">
            {shopName}
          </li>
        </ol>
      </nav>
    </div>
  );
}
