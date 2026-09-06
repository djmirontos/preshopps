import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth/session";
import { signOutAction } from "@/lib/auth/actions";

export const metadata = { title: "Account | Preshopps" };

/**
 * Minimal account page: signed-in email + Sign out only, per the
 * approved MVP scope -- no profile editing yet. Guarded server-side
 * (getAuthUser() runs before anything renders), not by a hidden client
 * check, so no account data is ever sent to an unauthenticated request.
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

        <form action={signOutAction} className="mt-6">
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
