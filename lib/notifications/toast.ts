import { toast } from "sonner";

/** Routine success acknowledgment, rendered by the single root <Toaster />
 * in app/layout.tsx. Centralized here so every call site shares the same
 * duration/variant instead of repeating options inline. */
export function notifySuccess(message: string) {
  toast.success(message, { duration: 4000 });
}
