import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth/session";
import { getMyShop } from "@/lib/seller/get-my-shop";
import { getMyShopListings, type MyShopListingsCursor } from "@/lib/seller/get-my-shop-listings";
import { getCategories } from "@/lib/marketplace/reference-data";
import { SellerListingsListClient } from "@/components/seller/SellerListingsListClient";
import type { MyListingStatus } from "@/lib/seller/get-my-listing";

export const metadata = { title: "My Listings | Preshopps" };

const LISTINGS_LIMIT = 20;

const STATUS_VALUES: ReadonlySet<string> = new Set<MyListingStatus>([
  "draft",
  "available",
  "reserved",
  "paused",
  "sold",
  "archived",
]);

const STATUS_TABS: { value: MyListingStatus | null; label: string }[] = [
  { value: null, label: "All" },
  { value: "draft", label: "Draft" },
  { value: "available", label: "Available" },
  { value: "reserved", label: "Reserved" },
  { value: "paused", label: "Paused" },
  { value: "sold", label: "Sold" },
  { value: "archived", label: "Archived" },
];

function parseStatus(raw: string | undefined): MyListingStatus | null {
  return raw && STATUS_VALUES.has(raw) ? (raw as MyListingStatus) : null;
}

type PageProps = {
  searchParams: Promise<{ status?: string }>;
};

/**
 * Authenticated-only, same shape as /seller/orders: getAuthUser() runs
 * before any shop/listing data is fetched, and a caller with no shop yet
 * sees a simple explanatory state rather than an error (getMyShop() reuses
 * the existing shops_select_owner RLS policy, no new migration).
 *
 * The status filter lives entirely in the URL (?status=paused, etc.), per
 * this project's own "search/filter state must remain in the URL" rule --
 * changing tabs is a normal navigation, not client state, so the filtered
 * first page is always server-rendered and shareable/bookmarkable.
 */
export default async function SellerListingsPage({ searchParams }: PageProps) {
  const user = await getAuthUser();

  if (!user) {
    redirect(`/sign-in?next=${encodeURIComponent("/seller/listings")}`);
  }

  const shop = await getMyShop();

  if (!shop) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 lg:px-8">
        <h1 className="text-xl font-bold text-ink lg:text-2xl">My Listings</h1>
        <div className="mt-6 rounded-[14px] border border-border bg-canvas px-4 py-10 text-center">
          <p className="text-sm font-medium text-ink">You don&apos;t have a shop yet.</p>
          <p className="mt-1 text-sm text-ink-muted">Your listings will appear here once you start selling.</p>
        </div>
      </div>
    );
  }

  const { status: rawStatus } = await searchParams;
  const status = parseStatus(rawStatus);

  const [result, categories] = await Promise.all([getMyShopListings(LISTINGS_LIMIT, status), getCategories()]);

  async function loadMoreAction(cursor: MyShopListingsCursor) {
    "use server";
    return getMyShopListings(LISTINGS_LIMIT, status, cursor);
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-ink lg:text-2xl">My Listings</h1>
        <Link
          href="/sell"
          className="flex h-9 shrink-0 items-center rounded-[10px] bg-brand-action px-4 text-sm font-semibold text-brand-action-text hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          Sell
        </Link>
      </div>
      <p className="mt-1 text-sm text-ink-secondary">Manage your listings, newest first.</p>

      <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
        {STATUS_TABS.map((tab) => {
          const isActive = tab.value === status;
          const href = tab.value === null ? "/seller/listings" : `/seller/listings?status=${tab.value}`;
          return (
            <Link
              key={tab.label}
              href={href}
              aria-current={isActive ? "page" : undefined}
              className={
                isActive
                  ? "flex h-8 shrink-0 items-center rounded-full bg-brand-action px-3 text-xs font-semibold text-brand-action-text"
                  : "flex h-8 shrink-0 items-center rounded-full border border-border bg-surface px-3 text-xs font-medium text-ink-secondary hover:border-brand-link hover:text-brand-link"
              }
            >
              {tab.label}
            </Link>
          );
        })}
      </div>

      <div className="mt-6">
        <SellerListingsListClient
          initialListings={result.listings}
          initialHadError={result.hadError}
          initialCursor={result.nextCursor}
          loadMore={loadMoreAction}
          categories={categories}
          activeStatus={status}
        />
      </div>
    </div>
  );
}
