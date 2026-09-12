import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

const BUBBLE_BASE =
  "pointer-events-none absolute left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded-md bg-ink px-2 py-1 text-xs font-medium text-canvas opacity-0 invisible transition-opacity duration-150 lg:group-hover:visible lg:group-hover:opacity-100 lg:group-focus:visible lg:group-focus:opacity-100 lg:group-focus-within:visible lg:group-focus-within:opacity-100";

/**
 * The bare floating-text element, for the rare control that is already
 * its own positioned `group` (e.g. an absolutely-positioned icon button
 * inside a shared relative container, like ListingLightbox's Previous/
 * Next arrows) and would have its own positioning broken by the extra
 * wrapping element <Tooltip> below introduces. For that case, add
 * `group` directly to the control's own className and render this as a
 * plain sibling/child instead of using <Tooltip>. Every other icon-only
 * control should use <Tooltip> instead of this directly.
 */
export function TooltipBubble({ label, side = "top" }: { label: string; side?: "top" | "bottom" }) {
  return (
    <span role="tooltip" className={cn(BUBBLE_BASE, side === "top" ? "-top-9" : "-bottom-9")}>
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
 * this never renders below `lg` regardless.
 *
 * The wrapped control must already carry its own aria-label -- this is a
 * supplementary visible hint for sighted mouse/keyboard desktop users
 * only, never the accessible name itself, and screen readers are
 * unaffected by it either way.
 */
export function Tooltip({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <span className={cn("group relative inline-flex", className)}>
      {children}
      <TooltipBubble label={label} />
    </span>
  );
}
