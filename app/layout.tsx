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
  // getAuthUser is React cache()-memoized, so getMyFavoriteListingIds'
  // internal call to it (see lib/favorites/get-my-favorite-ids.ts) reuses
  // the same in-flight request rather than a second getUser() round trip.
  const [user, favoritedIds] = await Promise.all([getAuthUser(), getMyFavoriteListingIds()]);

  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col bg-canvas font-sans text-ink">
        <AuthStatusProvider isAuthenticated={Boolean(user)}>
          <FavoritesProvider favoritedIds={favoritedIds}>
            <AppHeader user={user} />
            <main className="flex-1">{children}</main>
            <Footer />
            <MobileBottomNav user={user} />
          </FavoritesProvider>
        </AuthStatusProvider>
      </body>
    </html>
  );
}
