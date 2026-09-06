"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { AuthGate } from "@/components/auth/AuthGate";
import { cn } from "@/lib/cn";

type Props = {
  isAuthenticated: boolean;
  className: string;
  children: React.ReactNode;
};

/**
 * Shared behavior for every Sell entry point (header, hero, mobile nav
 * tab) -- there is no sell route yet, so this never navigates anywhere:
 * a guest sees the auth gate, and an authenticated user sees an honest
 * disabled state (matching the same "don't pretend it works yet" pattern
 * already established on ListingActions) rather than a dead link.
 */
export function SellGate({ isAuthenticated, className, children }: Props) {
  const pathname = usePathname();
  const [isGateOpen, setIsGateOpen] = useState(false);

  if (isAuthenticated) {
    return (
      <button type="button" disabled aria-disabled="true" className={cn(className, "opacity-60 cursor-not-allowed")}>
        {children}
      </button>
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
