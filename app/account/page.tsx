import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronRight, Heart } from "lucide-react";
import { getAuthUser } from "@/lib/auth/session";
import { signOutAction } from "@/lib/auth/actions";

export const metadata = { title: "Account | Preshopps" };

/**
 * Minimal account page: signed-in email, a Favorites entry, and Sign out,
 * per the approved MVP scope -- no profile editing yet. Guarded server-side
 * (getAuthUser() runs before anything renders), not by a hidden client
 * check, so no account data is ever sent to an unauthenticated request.
 *
 * Favorites is reachable here rather than as a sixth bottom-nav tab --
 * the canonical mobile bottom nav stays Home/Search/Sell/Messages/Account
 * (see MobileBottomNav.tsx) -- so this single link is mobile's only path
 * to /favorites (desktop also has the header heart icon in AppHeader.tsx).
 */
export default async function AccountPage() {
  const user = await getAuthUser();

  if (!user) {
    // Matches the encodeURIComponent(...) convention used everywhere else
    // a next= param is built (AccountEntry, MobileBottomNav, AuthGate).
    redirect(`/sign-in?next=${encodeURIComponent("/account")}`);
  }

  return (
    <div className="mx-auto max-w-sm px-4 py-10 sm:py-16">
      <div className="rounded-[14px] border border-border bg-surface p-6 sm:p-8">
        <h1 className="text-xl font-bold text-ink">Account</h1>
        <p className="mt-4 text-sm text-ink-secondary">Signed in as</p>
        <p className="text-sm font-medium text-ink">{user.email}</p>

        <Link
          href="/favorites"
          className="mt-6 flex h-11 items-center justify-between rounded-[10px] border border-border px-3 text-sm font-semibold text-ink hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          <span className="flex items-center gap-2">
            <Heart className="h-4 w-4 text-ink-secondary" aria-hidden="true" />
            Favorites
          </span>
          <ChevronRight className="h-4 w-4 text-ink-secondary" aria-hidden="true" />
        </Link>

        <form action={signOutAction} className="mt-3">
          <button
            type="submit"
            className="h-11 w-full rounded-[10px] border border-border text-sm font-semibold text-ink hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
