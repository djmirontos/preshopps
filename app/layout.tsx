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
import { getMyUnreadConversationCountServer } from "@/lib/messaging/get-my-unread-conversation-count-server";
import { getMyGeneralNotificationUnreadCount } from "@/lib/notifications/get-my-general-notification-unread-count";
import { getMyShop } from "@/lib/seller/get-my-shop";
import { FloatingMessengerProvider } from "@/components/messaging/FloatingMessengerProvider";
import { FloatingChatPanel } from "@/components/messaging/FloatingChatPanel";

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
  // getAuthUser is React cache()-memoized, so every other call below that
  // also needs the caller (directly or via its own internal getUser())
  // reuses this same in-flight request rather than an extra round trip.
  // getMyCartQuantities' own get_my_cart() RPC call is itself
  // cache()-shared with the /cart page (see lib/cart/get-my-cart.ts).
  // getMyUnreadConversationCountServer/getMyGeneralNotificationUnreadCount
  // (0088) are exact scalar RPCs, each internally guarding on
  // getAuthUser() first (same convention as getMyFavoriteListingIds/
  // getMyCartQuantities/getMyShop) -- a guest pageview never issues a
  // doomed-to-fail authenticated RPC call. The Messages badge counts
  // UNREAD CONVERSATIONS (get_my_unread_conversation_count's own
  // is_unread semantics, identical to get_my_conversations' per-row
  // flag) -- a conversation with five new messages still counts once.
  // The Bell counts every notification type EXCEPT new_message --
  // get_my_notification_unread_count (all types together) is
  // deliberately not used for either badge anymore, since it would
  // double-count new_message into the Bell. getMyShop is the same narrow
  // {id, slug, name} read already used elsewhere for exactly this "does
  // this account have a shop" question.
  const [user, favoritedIds, cartLines, initialUnreadMessageCount, initialUnreadNotificationCount, myShop] = await Promise.all([
    getAuthUser(),
    getMyFavoriteListingIds(),
    getMyCartQuantities(),
    getMyUnreadConversationCountServer(),
    getMyGeneralNotificationUnreadCount(),
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
                initialUnreadMessageCount={initialUnreadMessageCount}
                initialUnreadNotificationCount={initialUnreadNotificationCount}
              >
                {/* Root-level so the floating desktop chat panel survives
                    normal marketplace navigation (the layout itself never
                    unmounts on a route change) -- see
                    FloatingMessengerProvider's own file comment. Renders
                    nothing on its own; FloatingChatPanel below is the only
                    consumer that actually shows anything, and only once a
                    conversation has been opened. */}
                <FloatingMessengerProvider>
                  <AppHeader user={user} hasShop={Boolean(myShop)} />
                  <main className="flex-1">{children}</main>
                  <Footer />
                  <MobileBottomNav user={user} hasShop={Boolean(myShop)} />
                  <FloatingChatPanel />
                </FloatingMessengerProvider>
              </NotificationsProvider>
            </CartProvider>
          </FavoritesProvider>
        </AuthStatusProvider>
      </body>
    </html>
  );
}
