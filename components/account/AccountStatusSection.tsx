import { AlertTriangle } from "lucide-react";
import { formatOrderDate } from "@/lib/orders/format-order-date";
import { getRestrictionTitle, getRestrictionSupportingCopy } from "@/lib/moderation/restriction-copy";
import type { MyActiveRestriction } from "@/lib/moderation/get-my-active-restrictions";

type Props = {
  restrictions: MyActiveRestriction[];
};

/**
 * Self-facing active-restriction display (A2.1) -- sourced exclusively
 * from get_my_active_restrictions() via lib/moderation/get-my-active-
 * restrictions.ts, never get_admin_user_restrictions or
 * moderation_actions. Renders nothing at all when the caller has zero
 * active restrictions, preserving the rest of the Account page exactly as
 * it was before this section existed. Multiple simultaneous restrictions
 * each render as their own independent card -- never merged or
 * summarized. Deliberately never shows an expiry/remaining-duration date
 * (get_my_active_restrictions has no such field -- this schema has no
 * time-based restriction expiry at all, only admin-driven lifting),
 * moderator identity, or a severity score -- none of that is returned by
 * the self-facing RPC, and none of it belongs on a self-facing surface.
 */
export function AccountStatusSection({ restrictions }: Props) {
  if (restrictions.length === 0) return null;

  return (
    <section id="account-status" className="mt-8 scroll-mt-20">
      <h2 className="text-sm font-semibold text-ink">Account status</h2>
      <div className="mt-3 space-y-3">
        {restrictions.map((restriction) => (
          <div key={restriction.restrictionId} className="rounded-[10px] border border-warning bg-surface p-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink">{getRestrictionTitle(restriction.restrictionType)}</p>
                <p className="mt-1 text-sm text-ink-secondary">{getRestrictionSupportingCopy(restriction.restrictionType)}</p>
                <p className="mt-2 text-sm text-ink">
                  <span className="font-medium">Reason: </span>
                  {restriction.reason}
                </p>
                <p className="mt-1 text-xs text-ink-muted">Applied {formatOrderDate(restriction.createdAt)}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
