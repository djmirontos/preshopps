import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AppHeader } from "@/components/layout/AppHeader";
import { MobileBottomNav } from "@/components/layout/MobileBottomNav";
import { Footer } from "@/components/layout/Footer";
import { getAuthUser } from "@/lib/auth/session";
import { AuthStatusProvider } from "@/components/auth/AuthStatusProvider";
import { FavoritesProvider } from "@/components/favorites/FavoritesProvider";
import { getMyFavoriteListingIds } from "@/lib/favorites/get-my-favorite-ids";
import { CartProvider } from "@/components/cart/CartProvider";
import { getMyCartQuantities } from "@/lib/cart/get-my-cart";
import { NotificationsProvider } from "@/components/notifications/NotificationsProvider";
import { getMyNotificationUnreadCount } from "@/lib/notifications/get-my-notification-unread-count";
import { getMyShop } from "@/lib/seller/get-my-shop";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Preshopps",
  description: "Buy and sell pre-loved and brand-new items.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // getAuthUser is React cache()-memoized, so getMyFavoriteListingIds',
  // getMyCartQuantities', getMyNotificationUnreadCount's, and getMyShop's
  // internal calls to it reuse the same in-flight request rather than
  // extra getUser() round trips; getMyCartQuantities' own get_my_cart()
  // RPC call is itself cache()-shared with the /cart page (see
  // lib/cart/get-my-cart.ts). getMyNotificationUnreadCount is the one
  // root-level unread-count query this task's own instruction explicitly
  // allows ("a single root-level unread-count query is acceptable if
  // already supported cleanly") -- exactly one extra scalar RPC call per
  // request, never per-notification, never polled. getMyShop is the same
  // narrow {id, slug, name} read already used elsewhere (lib/seller/
  // get-my-shop.ts) for exactly this "does this account have a shop"
  // question -- reused here, not a new query, so SellGate (via AppHeader/
  // MobileBottomNav) can route an authenticated seller to /sell vs
  // /seller/shop without a page-level round trip of its own.
  const [user, favoritedIds, cartLines, unreadNotificationCount, myShop] = await Promise.all([
    getAuthUser(),
    getMyFavoriteListingIds(),
    getMyCartQuantities(),
    getMyNotificationUnreadCount(),
    getMyShop(),
  ]);

  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col bg-canvas font-sans text-ink">
        <AuthStatusProvider isAuthenticated={Boolean(user)}>
          <FavoritesProvider favoritedIds={favoritedIds}>
            <CartProvider initialLines={cartLines} isAuthenticated={Boolean(user)}>
              <NotificationsProvider
                isAuthenticated={Boolean(user)}
                userId={user?.id ?? null}
                initialUnreadCount={unreadNotificationCount}
              >
                <AppHeader user={user} hasShop={Boolean(myShop)} />
                <main className="flex-1">{children}</main>
                <Footer />
                <MobileBottomNav user={user} hasShop={Boolean(myShop)} />
              </NotificationsProvider>
            </CartProvider>
          </FavoritesProvider>
        </AuthStatusProvider>
      </body>
    </html>
  );
}
