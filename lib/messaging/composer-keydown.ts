import type { KeyboardEvent } from "react";
import { isDesktopViewport } from "@/lib/ui/viewport";

/**
 * Shared Enter-to-send / Shift+Enter-newline keydown handler for every
 * desktop chat composer in the app (the conversation thread's own
 * textarea, and the "Message Seller"/"Message Shop" compose dialog's
 * first-message textarea) -- desktop (`lg` and up) only. Below that
 * width, this is a no-op: Enter remains a plain newline and the
 * composer's own explicit Send button is the only way to send, matching
 * normal Android/iOS keyboard expectations.
 *
 * Evaluated at keydown time (an interactive event, not render time), so
 * there is no SSR/hydration mismatch risk the way deciding this during
 * render would have -- see lib/ui/viewport.ts.
 *
 * `onSend` is called as-is with no additional validation here: every
 * caller's own `onSend` already no-ops on an empty/whitespace-only draft
 * (the same guard the Send button's own `disabled` state already
 * enforces), so this never introduces a new way to send a blank message.
 * Message validation and the RPC call itself are both untouched.
 */
export function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>, onSend: () => void): void {
  if (event.key !== "Enter" || event.shiftKey) return;
  // IME composition (e.g. typing Japanese/Korean/Chinese) uses Enter to
  // confirm a candidate, not to submit -- never intercept while a
  // composition session is active.
  if (event.nativeEvent.isComposing) return;
  if (!isDesktopViewport()) return;

  event.preventDefault();
  onSend();
}
