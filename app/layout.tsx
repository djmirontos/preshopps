import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AppHeader } from "@/components/layout/AppHeader";
import { MobileBottomNav } from "@/components/layout/MobileBottomNav";
import { Footer } from "@/components/layout/Footer";
import { getAuthUser } from "@/lib/auth/session";
import { AuthStatusProvider } from "@/components/auth/AuthStatusProvider";

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
  const user = await getAuthUser();

  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col bg-canvas font-sans text-ink">
        <AuthStatusProvider isAuthenticated={Boolean(user)}>
          <AppHeader user={user} />
          <main className="flex-1">{children}</main>
          <Footer />
          <MobileBottomNav user={user} />
        </AuthStatusProvider>
      </body>
    </html>
  );
}
