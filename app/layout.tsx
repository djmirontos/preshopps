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
  // getAuthUser is React cache()-memoized, so getMyFavoriteListingIds' and
  // getMyCartQuantities' internal calls to it reuse the same in-flight
  // request rather than extra getUser() round trips; getMyCartQuantities'
  // own get_my_cart() RPC call is itself cache()-shared with the /cart
  // page (see lib/cart/get-my-cart.ts).
  const [user, favoritedIds, cartLines] = await Promise.all([
    getAuthUser(),
    getMyFavoriteListingIds(),
    getMyCartQuantities(),
  ]);

  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col bg-canvas font-sans text-ink">
        <AuthStatusProvider isAuthenticated={Boolean(user)}>
          <FavoritesProvider favoritedIds={favoritedIds}>
            <CartProvider initialLines={cartLines} isAuthenticated={Boolean(user)}>
              <AppHeader user={user} />
              <main className="flex-1">{children}</main>
              <Footer />
              <MobileBottomNav user={user} />
            </CartProvider>
          </FavoritesProvider>
        </AuthStatusProvider>
      </body>
    </html>
  );
}
