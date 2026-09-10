import { createClient } from "@/lib/supabase/client";

type ErrorMap<Code extends string> = Record<Code | "UNKNOWN", string>;

function toErrorCode<Code extends string>(detail: string | undefined, known: ReadonlySet<string>): Code | "UNKNOWN" {
  return detail && known.has(detail) ? (detail as Code) : "UNKNOWN";
}

// ============================================================
// anonymize_user_account
// ============================================================
export type AnonymizeUserAccountErrorCode =
  | "NOT_AUTHENTICATED"
  | "NOT_ADMIN"
  | "REASON_REQUIRED"
  | "REASON_TOO_LONG"
  | "USER_NOT_FOUND"
  | "SUPER_ADMIN_REQUIRED_FOR_ADMIN_TARGET"
  | "LAST_SUPER_ADMIN";

const ANONYMIZE_ERROR_CODES: ReadonlySet<string> = new Set<AnonymizeUserAccountErrorCode>([
  "NOT_AUTHENTICATED",
  "NOT_ADMIN",
  "REASON_REQUIRED",
  "REASON_TOO_LONG",
  "USER_NOT_FOUND",
  "SUPER_ADMIN_REQUIRED_FOR_ADMIN_TARGET",
  "LAST_SUPER_ADMIN",
]);

export const ANONYMIZE_USER_ACCOUNT_ERROR_MESSAGES: ErrorMap<AnonymizeUserAccountErrorCode> = {
  NOT_AUTHENTICATED: "Please sign in and try again.",
  NOT_ADMIN: "Admin access is required.",
  REASON_REQUIRED: "Please enter a reason.",
  REASON_TOO_LONG: "Please shorten the reason.",
  USER_NOT_FOUND: "We couldn't find this user. Please refresh and try again.",
  SUPER_ADMIN_REQUIRED_FOR_ADMIN_TARGET: "Only a super admin can anonymize an account that holds an admin role.",
  LAST_SUPER_ADMIN: "You can't anonymize the last remaining super admin.",
  UNKNOWN: "Something went wrong. Please try again.",
};

export type AnonymizeUserAccountResult =
  | { ok: true; userId: string; wasAlreadyAnonymized: boolean; anonymizedAt: string }
  | { ok: false; code: AnonymizeUserAccountErrorCode | "UNKNOWN" };

/**
 * Wraps anonymize_user_account (0081) -- the sole write path for MVP
 * account deletion fulfillment (PRD 5.4). Admin-invoked only, from the
 * support-ticket detail page; there is no client-side self-service delete
 * path. was_already_anonymized distinguishes a fresh anonymization from a
 * safe no-op repeat, so the calling UI can render the correct state
 * without a second read round trip.
 */
export async function anonymizeUserAccount(userId: string, reason: string): Promise<AnonymizeUserAccountResult> {
  const supabase = createClient();
  try {
    const { data, error } = await supabase.rpc("anonymize_user_account", { p_user_id: userId, p_reason: reason });
    if (error) {
      console.error("anonymize_user_account RPC failed:", error.message);
      return { ok: false, code: toErrorCode<AnonymizeUserAccountErrorCode>((error as { details?: string }).details, ANONYMIZE_ERROR_CODES) };
    }
    const row = ((data ?? []) as { user_id: string; was_already_anonymized: boolean; anonymized_at: string }[])[0];
    if (!row) return { ok: false, code: "UNKNOWN" };
    return { ok: true, userId: row.user_id, wasAlreadyAnonymized: row.was_already_anonymized, anonymizedAt: row.anonymized_at };
  } catch (err) {
    console.error("anonymize_user_account RPC threw:", err instanceof Error ? err.message : err);
    return { ok: false, code: "UNKNOWN" };
  }
}
