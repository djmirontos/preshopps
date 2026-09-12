import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type TooltipSide = "top" | "bottom";

const BUBBLE_BASE =
  "pointer-events-none absolute left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded-md bg-ink px-2 py-1 text-xs font-medium text-canvas opacity-0 invisible transition-opacity duration-150 lg:group-hover:visible lg:group-hover:opacity-100 lg:group-focus:visible lg:group-focus:opacity-100 lg:group-focus-within:visible lg:group-focus-within:opacity-100";

/**
 * `top-full`/`bottom-full` + a small margin (rather than a fixed
 * `-top-9`/`-bottom-9` offset) so the gap stays correct regardless of the
 * trigger's own size -- this one component backs icon buttons ranging
 * from h-8 (floating panel Minimize/Close) to h-11 (header icons,
 * lightbox controls), and a fixed pixel offset tuned for one size would
 * sit wrong (too tight or floating away) on the others.
 */
const SIDE_CLASS: Record<TooltipSide, string> = {
  top: "bottom-full mb-2",
  bottom: "top-full mt-2",
};

/**
 * The bare floating-text element, for the rare control that is already
 * its own positioned `group` (e.g. an absolutely-positioned icon button
 * inside a shared relative container, like ListingLightbox's Previous/
 * Next arrows) and would have its own positioning broken by the extra
 * wrapping element <Tooltip> below introduces. For that case, add
 * `group` directly to the control's own className and render this as a
 * plain sibling/child instead of using <Tooltip>. Every other icon-only
 * control should use <Tooltip> instead of this directly.
 *
 * `side` defaults to "top" (unchanged behavior for controls that already
 * have clear room above them, e.g. ListingLightbox's Previous/Next and
 * CategoryStrip's scroll arrows, both well below the very top of the
 * viewport) -- pass side="bottom" for any control sitting at/near the top
 * of the viewport (the sticky site header's own icons), where a
 * top-placed bubble would be pushed above y=0 and clipped by the browser
 * viewport itself, not by any CSS overflow.
 */
export function TooltipBubble({ label, side = "top" }: { label: string; side?: TooltipSide }) {
  return (
    <span role="tooltip" className={cn(BUBBLE_BASE, SIDE_CLASS[side])}>
      {label}
    </span>
  );
}

/**
 * Desktop/web-only hover + keyboard-focus tooltip wrapper for icon-only
 * controls (a button or link whose only accessible name is its
 * aria-label, with no visible text alongside it). Pure CSS
 * (group-hover/group-focus/group-focus-within, every one of them gated
 * behind the `lg:` breakpoint) -- there is no JS viewport check and
 * therefore no hydration risk, and no lingering "stuck open" tooltip on
 * touch devices, since mobile has no meaningful persistent `:hover` and
 * this never renders below `lg` regardless. Keyboard focus
 * (group-focus-within) reveals the bubble at the exact same `side` as
 * hover -- there is only ever one placement per control, not a
 * hover-vs-focus split.
 *
 * The wrapped control must already carry its own aria-label -- this is a
 * supplementary visible hint for sighted mouse/keyboard desktop users
 * only, never the accessible name itself, and screen readers are
 * unaffected by it either way.
 *
 * `side` defaults to "top" (this component's original, unchanged
 * behavior) -- the site header's own icon controls (Favorites, Messages,
 * Notifications, Cart, Account) explicitly pass side="bottom" instead,
 * since they sit at the very top of the viewport and have no room above
 * them for a top-placed bubble.
 */
export function Tooltip({ label, children, className, side = "top" }: { label: string; children: ReactNode; className?: string; side?: TooltipSide }) {
  return (
    <span className={cn("group relative inline-flex", className)}>
      {children}
      <TooltipBubble label={label} side={side} />
    </span>
  );
}
