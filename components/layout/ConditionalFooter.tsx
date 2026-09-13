"use client";

import { usePathname } from "next/navigation";
import { Footer } from "@/components/layout/Footer";

/** Matches exactly `/messages/<id>` (the conversation-detail screen) --
 * never the list route `/messages` itself, and never a deeper path (none
 * currently exists under this route). */
const MOBILE_FULLSCREEN_CHAT_ROUTE = /^\/messages\/[^/]+$/;

/**
 * Root-layout wrapper deciding whether the normal site Footer renders on
 * the current route -- every route gets it exactly as before except one:
 * below `lg`, the conversation-detail screen (`/messages/[conversationId]`)
 * is a fixed, full-viewport chat panel (see ConversationDetailClient's own
 * comment) with nothing sensible for a site footer to render underneath.
 *
 * Deliberately still renders <Footer /> unconditionally in the DOM for
 * that route too -- just wrapped in `hidden lg:block` -- rather than
 * branching on `usePathname()` to skip it outright, so desktop's own
 * conversation-detail treatment (unaffected by this fix, already
 * approved and unchanged) keeps showing the footer exactly as before,
 * below the in-page conversation box, after scrolling down. Only the
 * `<lg` case is different, and that difference is expressed in CSS, not
 * by conditionally mounting/unmounting the component.
 *
 * usePathname() is a stable, request-time value (identical on the server-
 * rendered HTML and the client hydration pass for a given URL), unlike a
 * viewport check -- so branching render output on it here carries none of
 * the hydration-mismatch risk a window.innerWidth-based decision would.
 */
export function ConditionalFooter() {
  const pathname = usePathname();
  const isMobileFullscreenChatRoute = MOBILE_FULLSCREEN_CHAT_ROUTE.test(pathname ?? "");

  if (isMobileFullscreenChatRoute) {
    return (
      <div className="hidden lg:block">
        <Footer />
      </div>
    );
  }

  return <Footer />;
}
