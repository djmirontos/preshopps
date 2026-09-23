"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { notifySuccess } from "@/lib/notifications/toast";
import { useIsAuthenticated } from "@/lib/auth/use-is-authenticated";

/** Reads the one-time `signedOut=1` marker signOutAction's own successful
 * redirect appends to the homepage URL, shows the "You've signed out"
 * confirmation toast exactly once, then immediately strips just that
 * marker from the URL via router.replace (preserving any other query
 * params the homepage URL happened to carry) -- so it survives the
 * server-action redirect but never reappears on a manual refresh.
 * Mounted only on the homepage (app/page.tsx), inside a Suspense boundary
 * (useSearchParams requires one). Renders nothing itself.
 *
 * Guarded on the existing shared AuthStatusProvider state
 * (useIsAuthenticated -- server-resolved once per request in the root
 * layout, so it reflects the post-sign-out session immediately after the
 * real redirect): a still-authenticated visitor landing on this exact URL
 * (a stale bookmark, a copied/shared link, or a signed-in-elsewhere tab)
 * never sees a false "You've signed out" toast, even though the marker is
 * present. The marker is still stripped either way, so it never lingers
 * or gets re-evaluated on a later refresh. */
export function SignedOutNotice() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const isAuthenticated = useIsAuthenticated();
  const hasRun = useRef(false);

  useEffect(() => {
    if (hasRun.current) return;
    if (searchParams.get("signedOut") !== "1") return;

    hasRun.current = true;

    if (!isAuthenticated) {
      notifySuccess("You've signed out");
    }

    const remaining = new URLSearchParams(searchParams);
    remaining.delete("signedOut");
    const query = remaining.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [searchParams, router, pathname, isAuthenticated]);

  return null;
}
