/**
 * Tailwind's `lg` breakpoint (1024px) -- the same threshold this app
 * already uses everywhere via CSS (`lg:` utility classes) to switch
 * between the mobile and desktop layouts. This constant exists only for
 * the handful of places that need the equivalent decision inside a JS
 * event handler (a click or keydown), never during render -- render-time
 * layout differences stay entirely CSS-driven (`hidden lg:block`, etc.),
 * so there is no server/client markup mismatch and therefore no
 * hydration risk from this helper.
 */
export const DESKTOP_BREAKPOINT_PX = 1024;

/**
 * Reads the viewport width at the moment it's called -- intended for use
 * inside interactive handlers (onClick/onKeyDown), where evaluating it
 * fresh each time is correct and cheap. Never call this during render:
 * `window` does not exist during SSR, and even on the client, the first
 * client render must match the server-rendered markup exactly, so a
 * render-time viewport check would risk a hydration mismatch.
 */
export function isDesktopViewport(): boolean {
  return typeof window !== "undefined" && window.innerWidth >= DESKTOP_BREAKPOINT_PX;
}
