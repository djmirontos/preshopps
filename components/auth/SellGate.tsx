"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AuthGate } from "@/components/auth/AuthGate";

type Props = {
  isAuthenticated: boolean;
  /** Whether the caller's account already has a shop -- sourced from the
   * same root-layout-level getMyShop() call the header/nav already use for
   * other auth-aware state, never a new query of its own. Ignored for a
   * guest (irrelevant until they sign in). */
  hasShop: boolean;
  className: string;
  children: React.ReactNode;
};

/**
 * Shared behavior for every Sell entry point (header, hero, mobile nav
 * tab). A guest sees the existing auth gate. An authenticated account
 * without a shop yet is sent to /seller/shop first -- a listing always
 * belongs to a shop, so /sell itself would otherwise redirect there
 * anyway; going straight there avoids an extra hop. An authenticated
 * account that already has a shop goes straight to /sell.
 */
export function SellGate({ isAuthenticated, hasShop, className, children }: Props) {
  const pathname = usePathname();
  const [isGateOpen, setIsGateOpen] = useState(false);

  if (isAuthenticated) {
    return (
      <Link href={hasShop ? "/sell" : "/seller/shop"} className={className}>
        {children}
      </Link>
    );
  }

  return (
    <>
      <button type="button" onClick={() => setIsGateOpen(true)} className={className}>
        {children}
      </button>
      {isGateOpen && (
        <AuthGate
          title="Sign in to start selling"
          reason="Create a free account to list items for sale on Preshopps."
          next={pathname || "/"}
          onClose={() => setIsGateOpen(false)}
        />
      )}
    </>
  );
}
