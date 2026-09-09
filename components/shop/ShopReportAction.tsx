"use client";

import { ReportButton } from "@/components/moderation/ReportButton";

type Props = {
  shopId: string;
  shopSlug: string;
  isAuthenticated: boolean;
  isOwnShop: boolean;
};

/**
 * Restrained "Report" affordance for the shop page, same placement
 * convention as ShopMessageAction (its own sibling component) -- hidden
 * entirely for the shop's own owner.
 */
export function ShopReportAction({ shopId, shopSlug, isAuthenticated, isOwnShop }: Props) {
  return (
    <ReportButton
      targetType="shop"
      targetId={shopId}
      targetLabel="shop"
      isAuthenticated={isAuthenticated}
      hidden={isOwnShop}
      next={`/shop/${shopSlug}`}
      className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-ink-muted hover:text-ink-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
    />
  );
}
