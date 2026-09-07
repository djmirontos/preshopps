import { redirect } from "next/navigation";
import Link from "next/link";
import { getAuthUser } from "@/lib/auth/session";
import { getMyShopProfile } from "@/lib/seller/get-my-shop-profile";
import { getProvinces, getCitiesForProvince, getBarangaysForCity, type LocationRef } from "@/lib/marketplace/reference-data";
import { ShopForm } from "@/components/seller/ShopForm";

export const metadata = { title: "My Shop | Preshopps" };

/**
 * Single seller entry point for shop setup + management -- not a
 * dashboard. No existing shop -> setup form (create_shop); existing shop
 * -> management form prefilled with the current values (update_shop). The
 * two Server Actions below are the only way ShopLocationFields ever
 * fetches dependent city/barangay options -- both are plain pass-throughs
 * to the already-existing, guest-safe reference-data reads (0035's public
 * reference RLS), closing over nothing shop-specific.
 */
export default async function SellerShopPage() {
  const user = await getAuthUser();

  if (!user) {
    redirect(`/sign-in?next=${encodeURIComponent("/seller/shop")}`);
  }

  const [shop, provinces] = await Promise.all([getMyShopProfile(), getProvinces()]);

  async function loadCitiesAction(provinceId: number): Promise<LocationRef[]> {
    "use server";
    return getCitiesForProvince(provinceId);
  }

  async function loadBarangaysAction(cityId: number): Promise<LocationRef[]> {
    "use server";
    return getBarangaysForCity(cityId);
  }

  const [initialCities, initialBarangays] = shop
    ? await Promise.all([
        getCitiesForProvince(shop.provinceId),
        shop.barangayId !== null ? getBarangaysForCity(shop.cityId) : Promise.resolve([] as LocationRef[]),
      ])
    : [[] as LocationRef[], [] as LocationRef[]];

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:px-6 lg:px-8">
      <Link href="/account" className="text-sm text-ink-secondary hover:text-ink">
        ← Back to Account
      </Link>

      <h1 className="mt-3 text-xl font-bold text-ink lg:text-2xl">{shop ? "My Shop" : "Set up your shop"}</h1>
      <p className="mt-1 text-sm text-ink-secondary">
        {shop ? "Manage your shop's profile and availability." : "A few details to start selling on Preshopps."}
      </p>

      <div className="mt-6">
        {shop ? (
          <ShopForm
            mode="edit"
            ownerId={user.id}
            provinces={provinces}
            initialCities={initialCities}
            initialBarangays={initialBarangays}
            loadCities={loadCitiesAction}
            loadBarangays={loadBarangaysAction}
            initialName={shop.name}
            initialDescription={shop.description}
            initialLocation={{ provinceId: shop.provinceId, cityId: shop.cityId, barangayId: shop.barangayId }}
            initialMessengerLink={shop.messengerLink}
            initialLogoPath={shop.logoStoragePath}
            initialLogoUrl={shop.logoUrl}
            initialStatus={shop.status}
            currentSlug={shop.slug}
          />
        ) : (
          <ShopForm
            mode="create"
            ownerId={user.id}
            provinces={provinces}
            initialCities={initialCities}
            initialBarangays={initialBarangays}
            loadCities={loadCitiesAction}
            loadBarangays={loadBarangaysAction}
          />
        )}
      </div>
    </div>
  );
}
