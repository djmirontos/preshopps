"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { UserCircle } from "lucide-react";
import { signOutAction } from "@/lib/auth/actions";
import { Tooltip } from "@/components/ui/Tooltip";

type Props = {
  email: string | null;
};

/** Small authenticated-account menu: Account + Sign out only, per the
 * approved scope -- no Orders/Dashboard/Favorites/Messages entries until
 * those routes actually exist. Closes on Escape and on outside click,
 * returns focus to the trigger on close. */
export function AccountMenu({ email }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    }

    function onPointerDown(event: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [isOpen]);

  return (
    <div ref={containerRef} className="relative">
      <Tooltip label="Account">
        <button
          ref={triggerRef}
          type="button"
          aria-label="Account"
          aria-haspopup="menu"
          aria-expanded={isOpen}
          onClick={() => setIsOpen((value) => !value)}
          className="inline-flex h-11 w-11 items-center justify-center rounded-full text-ink-secondary transition-colors duration-150 hover:bg-canvas hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          <UserCircle className="h-5 w-5" aria-hidden="true" />
        </button>
      </Tooltip>

      {isOpen && (
        <div
          role="menu"
          aria-label="Account menu"
          className="absolute right-0 top-full z-40 mt-2 w-56 rounded-[14px] border border-border bg-surface p-2 shadow-lg"
        >
          {email && <p className="truncate px-3 py-2 text-xs text-ink-muted">{email}</p>}
          <Link
            role="menuitem"
            href="/account"
            onClick={() => setIsOpen(false)}
            className="flex h-11 items-center rounded-[10px] px-3 text-sm text-ink hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            Account
          </Link>
          <form action={signOutAction}>
            <button
              type="submit"
              role="menuitem"
              className="flex h-11 w-full items-center rounded-[10px] px-3 text-left text-sm text-ink hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
