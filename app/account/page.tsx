import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronRight, Heart, List, Package, Store } from "lucide-react";
import { getAuthUser } from "@/lib/auth/session";
import { signOutAction } from "@/lib/auth/actions";
import { getMyProfile } from "@/lib/account/get-my-profile";
import { getProvinces, getCitiesForProvince, getBarangaysForCity, type LocationRef } from "@/lib/marketplace/reference-data";
import { AccountProfileForm } from "@/components/account/AccountProfileForm";
import { SecuritySection } from "@/components/account/SecuritySection";

export const metadata = { title: "Account | Preshopps" };

/**
 * Responsive Account/Profile page built on the 0092 backend
 * (get_my_profile/update_my_profile/avatar-images) -- still the single
 * /account route, still the only path mobile's bottom-nav Account tab
 * reaches (MobileBottomNav.tsx is untouched). Guarded server-side exactly
 * like before: getAuthUser() runs before anything renders, so no account
 * data is ever sent to an unauthenticated request.
 *
 * Sections, in order: Profile/Location/Contact (inside AccountProfileForm,
 * the one stateful piece with its own single "Save Changes" action),
 * Security (SecuritySection -- Change Email/Change Password/Sign out
 * other devices, entirely Supabase Auth-native, fully independent of
 * AccountProfileForm's own get_my_profile/update_my_profile save flow),
 * then Marketplace and Account (Sign out, Request account deletion),
 * server-rendered links/forms needing no client state.
 *
 * "My Orders" = orders this account placed as a buyer (/orders).
 * "Customer Orders" = orders customers placed with this account's own
 * shop/listings (/seller/orders). Labels only -- routes/ownership/
 * permissions are unchanged.
 */
export default async function AccountPage() {
  const user = await getAuthUser();

  if (!user) {
    // Matches the encodeURIComponent(...) convention used everywhere else
    // a next= param is built (AccountEntry, MobileBottomNav, AuthGate).
    redirect(`/sign-in?next=${encodeURIComponent("/account")}`);
  }

  const [profileResult, provinces] = await Promise.all([getMyProfile(), getProvinces()]);

  async function loadCitiesAction(provinceId: number): Promise<LocationRef[]> {
    "use server";
    return getCitiesForProvince(provinceId);
  }

  async function loadBarangaysAction(cityId: number): Promise<LocationRef[]> {
    "use server";
    return getBarangaysForCity(cityId);
  }

  if (profileResult.hadError) {
    return (
      <div className="mx-auto max-w-sm px-4 py-10 sm:py-16">
        <div className="rounded-[14px] border border-border bg-surface p-6 text-center sm:p-8">
          <h1 className="text-xl font-bold text-ink">Account</h1>
          <p className="mt-4 text-sm text-ink-secondary">We couldn&rsquo;t load your account details. Please try again.</p>
          <Link
            href="/account"
            className="mt-4 inline-flex h-11 items-center justify-center rounded-[10px] border border-border px-4 text-sm font-semibold text-ink hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            Try again
          </Link>
        </div>
      </div>
    );
  }

  const { profile } = profileResult;

  const [initialCities, initialBarangays] = await Promise.all([
    profile.provinceId !== null ? getCitiesForProvince(profile.provinceId) : Promise.resolve([] as LocationRef[]),
    profile.cityId !== null ? getBarangaysForCity(profile.cityId) : Promise.resolve([] as LocationRef[]),
  ]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 lg:px-8 lg:py-10">
      <h1 className="text-xl font-bold text-ink lg:text-2xl">Account</h1>
      <p className="mt-1 text-sm text-ink-secondary">Manage your profile, location, and contact details.</p>

      <div className="mt-6">
        <AccountProfileForm
          userId={user.id}
          email={user.email ?? ""}
          initialProfile={profile}
          provinces={provinces}
          initialCities={initialCities}
          initialBarangays={initialBarangays}
          loadCities={loadCitiesAction}
          loadBarangays={loadBarangaysAction}
        />
      </div>

      <div className="mt-8">
        <SecuritySection />
      </div>

      <section className="mt-10">
        <h2 className="text-sm font-semibold text-ink">Marketplace</h2>
        <div className="mt-3 space-y-3">
          <Link
            href="/orders"
            className="flex h-11 items-center justify-between rounded-[10px] border border-border px-3 text-sm font-semibold text-ink hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <span className="flex items-center gap-2">
              <Package className="h-4 w-4 text-ink-secondary" aria-hidden="true" />
              My Orders
            </span>
            <ChevronRight className="h-4 w-4 text-ink-secondary" aria-hidden="true" />
          </Link>

          <Link
            href="/seller/orders"
            className="flex h-11 items-center justify-between rounded-[10px] border border-border px-3 text-sm font-semibold text-ink hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <span className="flex items-center gap-2">
              <Store className="h-4 w-4 text-ink-secondary" aria-hidden="true" />
              Customer Orders
            </span>
            <ChevronRight className="h-4 w-4 text-ink-secondary" aria-hidden="true" />
          </Link>

          <Link
            href="/seller/shop"
            className="flex h-11 items-center justify-between rounded-[10px] border border-border px-3 text-sm font-semibold text-ink hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <span className="flex items-center gap-2">
              <Store className="h-4 w-4 text-ink-secondary" aria-hidden="true" />
              My Shop
            </span>
            <ChevronRight className="h-4 w-4 text-ink-secondary" aria-hidden="true" />
          </Link>

          <Link
            href="/seller/listings"
            className="flex h-11 items-center justify-between rounded-[10px] border border-border px-3 text-sm font-semibold text-ink hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <span className="flex items-center gap-2">
              <List className="h-4 w-4 text-ink-secondary" aria-hidden="true" />
              My Listings
            </span>
            <ChevronRight className="h-4 w-4 text-ink-secondary" aria-hidden="true" />
          </Link>

          <Link
            href="/favorites"
            className="flex h-11 items-center justify-between rounded-[10px] border border-border px-3 text-sm font-semibold text-ink hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <span className="flex items-center gap-2">
              <Heart className="h-4 w-4 text-ink-secondary" aria-hidden="true" />
              Favorites
            </span>
            <ChevronRight className="h-4 w-4 text-ink-secondary" aria-hidden="true" />
          </Link>
        </div>
      </section>

      <section className="mt-10">
        <h2 className="text-sm font-semibold text-ink">Account</h2>
        <div className="mt-3 space-y-3">
          <form action={signOutAction}>
            <button
              type="submit"
              className="h-11 w-full rounded-[10px] border border-border text-sm font-semibold text-ink hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              Sign out
            </button>
          </form>

          <div className="rounded-[10px] border border-border p-3">
            <p className="text-sm font-medium text-ink">Request account deletion</p>
            <p className="mt-1 text-xs text-ink-secondary">
              Account deletion is handled through a support request, not an automatic action. Choose &ldquo;Account issue&rdquo; when you submit it.
            </p>
            <Link
              href="/support"
              className="mt-2 inline-block rounded text-sm font-medium text-brand-link hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              Go to Support →
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
