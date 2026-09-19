import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import type { RestrictionType } from "@/lib/moderation/get-my-active-restrictions";

type Props = {
  restrictions: { restrictionType: RestrictionType }[];
};

/**
 * Global, persistent notice for a full `account_suspended` restriction --
 * deliberately narrower than AccountStatusSection, which shows every
 * active restriction type. `seller_suspended`/`buyer_restricted` alone
 * never render this banner; they remain visible only through the Account
 * status section (and, later, restriction-aware action error copy),
 * matching this task's own explicit product decision that a scoped
 * restriction shouldn't interrupt every authenticated surface.
 *
 * Intentionally has no dismiss/close control at all -- a full-account
 * suspension is a persistent account state, not a one-time alert, and
 * must not be able to disappear for the rest of the session.
 */
export function AccountSuspendedBanner({ restrictions }: Props) {
  const isAccountSuspended = restrictions.some((restriction) => restriction.restrictionType === "account_suspended");
  if (!isAccountSuspended) return null;

  return (
    <div role="alert" className="flex items-center justify-center gap-2 bg-warning px-4 py-2 text-center text-sm font-medium text-white">
      <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span>Your account is suspended. View your account status for details.</span>
      <Link href="/account#account-status" className="shrink-0 font-semibold underline underline-offset-2 hover:no-underline">
        View details
      </Link>
    </div>
  );
}
