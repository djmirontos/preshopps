"use client";

import Link from "next/link";
import { ShoppingBag } from "lucide-react";
import { useCart } from "@/components/cart/CartProvider";
import { Tooltip } from "@/components/ui/Tooltip";

/**
 * Real destination (was href="#") plus the PRD S20.3-required item-count
 * badge, sourced from CartProvider's shared quantity map -- the same map
 * seeded once per request at the root layout, so this never issues its
 * own fetch and adds no N+1 (no request beyond what the layout already
 * makes for auth/favorites/cart).
 */
export function CartIconLink() {
  const { itemCount } = useCart();

  return (
    <Tooltip label="Cart">
      <Link
        href="/cart"
        aria-label={itemCount > 0 ? `Cart, ${itemCount} item${itemCount === 1 ? "" : "s"}` : "Cart"}
        className="relative inline-flex h-11 w-11 items-center justify-center rounded-full text-ink-secondary transition-colors duration-150 hover:bg-canvas hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
      >
        <ShoppingBag className="h-5 w-5" aria-hidden="true" />
        {itemCount > 0 && (
          <span
            aria-hidden="true"
            className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-action px-1 text-[10px] font-semibold leading-none text-brand-action-text"
          >
            {itemCount > 99 ? "99+" : itemCount}
          </span>
        )}
      </Link>
    </Tooltip>
  );
}
