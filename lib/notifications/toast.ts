import { toast } from "sonner";

/** Routine success acknowledgment, rendered by the single root <Toaster />
 * in app/layout.tsx. Centralized here so every call site shares the same
 * duration/variant instead of repeating options inline. */
export function notifySuccess(message: string) {
  toast.success(message, { duration: 4000 });
}

/** Truthful failure acknowledgment -- used only when an action genuinely
 * did not succeed (e.g. a clipboard write that rejected), never as a
 * softer substitute for notifySuccess. Same duration/centralization
 * convention as notifySuccess above. */
export function notifyError(message: string) {
  toast.error(message, { duration: 4000 });
}
