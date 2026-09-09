"use client";

import Link from "next/link";
import Image from "next/image";
import { useState, useTransition } from "react";
import { Package } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { ConfirmDialog } from "@/components/seller/ConfirmDialog";
import { formatPriceFromCents } from "@/components/marketplace/ListingCard";
import { formatOrderDate } from "@/lib/orders/format-order-date";
import { getListingImageUrl } from "@/lib/marketplace/listing-image-url";
import { CONDITION_LABELS } from "@/lib/marketplace/search-params";
import {
  updateListingStatus,
  UPDATE_LISTING_STATUS_ERROR_MESSAGES,
  type SellerListingStatus,
} from "@/lib/seller/listing-actions";
import type { MyShopListingSummary, MyShopListingsCursor } from "@/lib/seller/get-my-shop-listings";
import type { MyListingStatus } from "@/lib/seller/get-my-listing";
import type { CategoryRef } from "@/lib/marketplace/reference-data";

type LoadMoreResult = {
  listings: MyShopListingSummary[];
  hadError: boolean;
  nextCursor: MyShopListingsCursor | null;
};

type Props = {
  initialListings: MyShopListingSummary[];
  initialHadError: boolean;
  initialCursor: MyShopListingsCursor | null;
  loadMore: (cursor: MyShopListingsCursor) => Promise<LoadMoreResult>;
  categories: CategoryRef[];
  /** The status tab currently selected (null = "All") -- used only to
   * tailor the empty-state copy and to decide whether a row should drop
   * out of view immediately after a successful status change (it stays
   * visible under "All," but a Pause action removes the row from an
   * "Available"-filtered view, since it no longer matches). */
  activeStatus: MyListingStatus | null;
};

const STATUS_LABELS: Record<MyListingStatus, string> = {
  draft: "Draft",
  available: "Available",
  reserved: "Reserved",
  paused: "Paused",
  sold: "Sold",
  archived: "Archived",
};

type ActionKind = "pause" | "resume" | "mark_sold" | "archive";

const ACTION_TARGET: Record<ActionKind, SellerListingStatus> = {
  pause: "paused",
  resume: "available",
  mark_sold: "sold",
  archive: "archived",
};

const ACTION_LABEL: Record<ActionKind, string> = {
  pause: "Pause",
  resume: "Resume",
  mark_sold: "Mark Sold",
  archive: "Archive",
};

/** Every transition this list can ever offer -- must stay a subset of what
 * update_listing_status (0064) actually allows: draft/sold -> archived,
 * available <-> paused, available/paused -> sold. Reserved never offers
 * any action (system-controlled only); Archived is terminal. */
function actionsForStatus(status: MyListingStatus): ActionKind[] {
  switch (status) {
    case "draft":
      return ["archive"];
    case "available":
      return ["pause", "mark_sold", "archive"];
    case "paused":
      return ["resume", "mark_sold", "archive"];
    case "sold":
      return ["archive"];
    case "reserved":
    case "archived":
      return [];
  }
}

/** Matches get_listing_detail's own visibility (0036): Available/Reserved/
 * Sold/Archived remain reachable by direct URL; Draft/Paused do not. */
function canViewPublicly(status: MyListingStatus): boolean {
  return status === "available" || status === "reserved" || status === "sold" || status === "archived";
}

const CONFIRM_COPY: Record<"mark_sold" | "archive", { title: string; description: string }> = {
  mark_sold: {
    title: "Mark as Sold?",
    description: "This hides the listing from the marketplace. You can still Archive it afterward, but it can't be relisted as Available again.",
  },
  archive: {
    title: "Archive this listing?",
    description: "Archived listings are hidden from the marketplace and can't be brought back to Available, Paused, or Sold.",
  },
};

export function SellerListingsListClient({ initialListings, initialHadError, initialCursor, loadMore, categories, activeStatus }: Props) {
  const [listings, setListings] = useState(initialListings);
  const [cursor, setCursor] = useState(initialCursor);
  const [loadMoreFailed, setLoadMoreFailed] = useState(false);
  const [isPending, startTransition] = useTransition();

  const [pendingListingId, setPendingListingId] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [confirmState, setConfirmState] = useState<{ listingId: string; action: "mark_sold" | "archive" } | null>(null);

  if (initialHadError) {
    return <p className="text-sm text-ink-secondary">Unable to load your listings right now.</p>;
  }

  if (listings.length === 0) {
    return (
      <div className="rounded-[14px] border border-border bg-canvas px-4 py-10 text-center">
        <p className="text-sm font-medium text-ink">
          {activeStatus ? `No ${STATUS_LABELS[activeStatus].toLowerCase()} listings.` : "No listings yet."}
        </p>
        <p className="mt-1 text-sm text-ink-muted">
          {activeStatus ? "Listings will appear here once they match this filter." : "Listings you create will appear here."}
        </p>
      </div>
    );
  }

  function handleLoadMore() {
    if (!cursor) return;
    setLoadMoreFailed(false);
    startTransition(async () => {
      const result = await loadMore(cursor);
      if (result.hadError) {
        setLoadMoreFailed(true);
        return;
      }
      setListings((prev) => [...prev, ...result.listings]);
      setCursor(result.nextCursor);
    });
  }

  async function applyStatusChange(listingId: string, action: ActionKind): Promise<boolean> {
    setPendingListingId(listingId);
    setRowErrors((prev) => ({ ...prev, [listingId]: "" }));

    const result = await updateListingStatus(listingId, ACTION_TARGET[action]);
    setPendingListingId(null);

    if (!result.ok) {
      setRowErrors((prev) => ({ ...prev, [listingId]: UPDATE_LISTING_STATUS_ERROR_MESSAGES[result.code] }));
      return false;
    }

    if (activeStatus !== null && activeStatus !== result.status) {
      setListings((prev) => prev.filter((listing) => listing.listingId !== listingId));
      return true;
    }

    setListings((prev) =>
      prev.map((listing) => (listing.listingId === listingId ? { ...listing, status: result.status, updatedAt: result.updatedAt } : listing)),
    );
    return true;
  }

  function handleActionClick(listingId: string, action: ActionKind) {
    if (action === "mark_sold" || action === "archive") {
      setConfirmState({ listingId, action });
      return;
    }
    void applyStatusChange(listingId, action);
  }

  async function handleConfirmAction() {
    if (!confirmState) return;
    const success = await applyStatusChange(confirmState.listingId, confirmState.action);
    if (success) setConfirmState(null);
  }

  return (
    <div>
      <ul className="space-y-3">
        {listings.map((listing) => {
          const imageUrl = getListingImageUrl(listing.coverImagePath);
          const categoryName = listing.categoryId !== null ? (categories.find((c) => c.id === listing.categoryId)?.name ?? null) : null;
          const typeLabel =
            listing.listingType === "brand_new"
              ? "Brand New"
              : listing.listingType === "preloved"
                ? listing.condition && listing.condition !== "brand_new"
                  ? `Pre-loved · ${CONDITION_LABELS[listing.condition]}`
                  : "Pre-loved"
                : null;
          const actions = actionsForStatus(listing.status);
          const rowError = rowErrors[listing.listingId];
          const rowIsPending = pendingListingId === listing.listingId;

          return (
            <li key={listing.listingId} className="rounded-[14px] border border-border bg-surface p-3 sm:p-4">
              <div className="flex gap-3">
                <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-[10px] bg-divider">
                  {imageUrl ? (
                    <Image src={imageUrl} alt="" fill sizes="64px" className="object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <Package className="h-5 w-5 text-ink-muted/60" aria-hidden="true" />
                    </div>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="line-clamp-2 text-sm font-semibold text-ink">{listing.title}</h3>
                    <Badge tone={listing.status === "available" ? "brand" : "neutral"} className="shrink-0">
                      {STATUS_LABELS[listing.status]}
                    </Badge>
                  </div>

                  {typeLabel && <p className="mt-0.5 text-xs text-ink-secondary">{typeLabel}</p>}
                  {categoryName && <p className="text-xs text-ink-muted">{categoryName}</p>}

                  <p className="mt-1 text-sm font-semibold text-ink">
                    {listing.priceCents !== null ? formatPriceFromCents(listing.priceCents) : "No price set"}
                  </p>

                  <p className="text-xs text-ink-muted">
                    Stock {listing.stockQuantity}
                    {listing.reservedQuantity > 0 ? ` · ${listing.reservedQuantity} reserved` : ""}
                  </p>

                  <p className="text-xs text-ink-muted">Updated {formatOrderDate(listing.updatedAt)}</p>
                </div>
              </div>

              {listing.status === "reserved" && (
                <p className="mt-2 text-xs text-ink-muted">Reserved by an active order -- no status actions available.</p>
              )}

              {rowError && <p className="mt-2 text-xs text-danger">{rowError}</p>}

              <div className="mt-3 flex flex-wrap gap-2">
                {listing.status === "draft" && (
                  <Link
                    href={`/sell/${listing.listingId}/edit`}
                    className="flex h-8 items-center rounded-[8px] border border-border px-3 text-xs font-semibold text-ink hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                  >
                    Edit
                  </Link>
                )}

                {canViewPublicly(listing.status) && (
                  <Link
                    href={`/item/${listing.publicCode}`}
                    className="flex h-8 items-center rounded-[8px] border border-border px-3 text-xs font-semibold text-ink hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                  >
                    View listing
                  </Link>
                )}

                {actions.map((action) => (
                  <button
                    key={action}
                    type="button"
                    onClick={() => handleActionClick(listing.listingId, action)}
                    disabled={rowIsPending}
                    className="flex h-8 items-center rounded-[8px] border border-border px-3 text-xs font-semibold text-ink hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-60"
                  >
                    {rowIsPending ? "Please wait…" : ACTION_LABEL[action]}
                  </button>
                ))}
              </div>
            </li>
          );
        })}
      </ul>

      {cursor && (
        <div className="mt-6 flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={handleLoadMore}
            disabled={isPending}
            className="rounded-[10px] border border-border bg-surface px-5 py-2.5 text-sm font-semibold text-ink hover:border-brand-link hover:text-brand-link disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            {isPending ? "Loading…" : "Load more"}
          </button>
          {loadMoreFailed && <p className="text-xs text-danger">Unable to load more listings right now.</p>}
        </div>
      )}

      {confirmState && (
        <ConfirmDialog
          title={CONFIRM_COPY[confirmState.action].title}
          description={CONFIRM_COPY[confirmState.action].description}
          confirmLabel={ACTION_LABEL[confirmState.action]}
          isPending={pendingListingId === confirmState.listingId}
          errorMessage={rowErrors[confirmState.listingId] || null}
          onConfirm={() => void handleConfirmAction()}
          onClose={() => setConfirmState(null)}
        />
      )}
    </div>
  );
}
