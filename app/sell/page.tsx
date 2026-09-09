import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth/session";
import { getMyShopProfile } from "@/lib/seller/get-my-shop-profile";
import { getCategories, getProvinces, getCitiesForProvince, getBarangaysForCity, type LocationRef } from "@/lib/marketplace/reference-data";
import { ListingForm } from "@/components/seller/ListingForm";

export const metadata = { title: "Sell | Preshopps" };

/**
 * Create-listing entry point -- a shop is required first (a listing always
 * belongs to a shop), so an account with no shop yet is sent to
 * /seller/shop rather than shown a broken/half-usable form. Mirrors
 * app/seller/shop/page.tsx's own reference-data-loading shape exactly: the
 * two Server Actions below are plain pass-throughs to the already-existing,
 * guest-safe reference-data reads, closing over nothing shop-specific.
 *
 * Location is prefilled from the seller's own shop (province/city/
 * barangay) -- PRD/CLAUDE.md's "Listing location defaults to shop location
 * but may be changed per listing" -- the seller can still change every
 * field before Save Draft.
 */
export default async function SellPage() {
  const user = await getAuthUser();

  if (!user) {
    redirect(`/sign-in?next=${encodeURIComponent("/sell")}`);
  }

  const shop = await getMyShopProfile();

  if (!shop) {
    redirect("/seller/shop");
  }

  const [categories, provinces, initialCities, initialBarangays] = await Promise.all([
    getCategories(),
    getProvinces(),
    getCitiesForProvince(shop.provinceId),
    shop.barangayId !== null ? getBarangaysForCity(shop.cityId) : Promise.resolve([] as LocationRef[]),
  ]);

  async function loadCitiesAction(provinceId: number): Promise<LocationRef[]> {
    "use server";
    return getCitiesForProvince(provinceId);
  }

  async function loadBarangaysAction(cityId: number): Promise<LocationRef[]> {
    "use server";
    return getBarangaysForCity(cityId);
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:px-6 lg:px-8">
      <h1 className="text-xl font-bold text-ink lg:text-2xl">Sell an item</h1>
      <p className="mt-1 text-sm text-ink-secondary">Only a title is required to save a Draft -- fill in the rest whenever you&rsquo;re ready.</p>

      <div className="mt-6">
        <ListingForm
          mode="create"
          categories={categories}
          provinces={provinces}
          initialCities={initialCities}
          initialBarangays={initialBarangays}
          loadCities={loadCitiesAction}
          loadBarangays={loadBarangaysAction}
          initialLocation={{ provinceId: shop.provinceId, cityId: shop.cityId, barangayId: shop.barangayId }}
        />
      </div>
    </div>
  );
}
