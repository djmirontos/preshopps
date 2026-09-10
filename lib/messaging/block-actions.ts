import { createClient } from "@/lib/supabase/client";

/**
 * Thin client wrappers around block_user/unblock_user (0072) -- the RPC-
 * mediated write path this task requires instead of a direct
 * .from("user_blocks") call, even though user_blocks itself also carries
 * its own insert_own/delete_own RLS policies (0031). Identity is always
 * derived server-side from auth.uid(); these wrappers never send a
 * blocker id, and the target (the other conversation participant's own
 * profile id) is resolved server-side by get_conversation_block_state,
 * never typed or guessed client-side.
 */

type ErrorMap<Code extends string> = Record<Code | "UNKNOWN", string>;

function toErrorCode<Code extends string>(detail: string | undefined, known: ReadonlySet<string>): Code | "UNKNOWN" {
  return detail && known.has(detail) ? (detail as Code) : "UNKNOWN";
}

export type BlockUserErrorCode = "NOT_AUTHENTICATED" | "INTERACTION_BLOCKED" | "CANNOT_BLOCK_SELF" | "USER_NOT_FOUND";

const BLOCK_USER_ERROR_CODES: ReadonlySet<string> = new Set<BlockUserErrorCode>([
  "NOT_AUTHENTICATED",
  "INTERACTION_BLOCKED",
  "CANNOT_BLOCK_SELF",
  "USER_NOT_FOUND",
]);

export const BLOCK_USER_ERROR_MESSAGES: ErrorMap<BlockUserErrorCode> = {
  NOT_AUTHENTICATED: "Please sign in and try again.",
  INTERACTION_BLOCKED: "Your account cannot do this right now.",
  CANNOT_BLOCK_SELF: "You cannot block yourself.",
  USER_NOT_FOUND: "We couldn't find this user. Please refresh and try again.",
  UNKNOWN: "Something went wrong. Please try again.",
};

export type BlockUserResult = { ok: true; blockedId: string; createdAt: string } | { ok: false; code: BlockUserErrorCode | "UNKNOWN" };

type BlockUserRpcRow = { blocked_id: string; created_at: string };

export async function blockUser(blockedId: string): Promise<BlockUserResult> {
  const supabase = createClient();

  try {
    const { data, error } = await supabase.rpc("block_user", { p_blocked_id: blockedId });

    if (error) {
      console.error("block_user RPC failed:", error.message);
      return { ok: false, code: toErrorCode<BlockUserErrorCode>((error as { details?: string }).details, BLOCK_USER_ERROR_CODES) };
    }

    const row = ((data ?? []) as BlockUserRpcRow[])[0];
    if (!row) {
      return { ok: false, code: "UNKNOWN" };
    }

    return { ok: true, blockedId: row.blocked_id, createdAt: row.created_at };
  } catch (err) {
    console.error("block_user RPC threw:", err instanceof Error ? err.message : err);
    return { ok: false, code: "UNKNOWN" };
  }
}

export type UnblockUserErrorCode = "NOT_AUTHENTICATED" | "INTERACTION_BLOCKED";

const UNBLOCK_USER_ERROR_CODES: ReadonlySet<string> = new Set<UnblockUserErrorCode>(["NOT_AUTHENTICATED", "INTERACTION_BLOCKED"]);

export const UNBLOCK_USER_ERROR_MESSAGES: ErrorMap<UnblockUserErrorCode> = {
  NOT_AUTHENTICATED: "Please sign in and try again.",
  INTERACTION_BLOCKED: "Your account cannot do this right now.",
  UNKNOWN: "Something went wrong. Please try again.",
};

export type UnblockUserResult = { ok: true } | { ok: false; code: UnblockUserErrorCode | "UNKNOWN" };

export async function unblockUser(blockedId: string): Promise<UnblockUserResult> {
  const supabase = createClient();

  try {
    const { error } = await supabase.rpc("unblock_user", { p_blocked_id: blockedId });

    if (error) {
      console.error("unblock_user RPC failed:", error.message);
      return { ok: false, code: toErrorCode<UnblockUserErrorCode>((error as { details?: string }).details, UNBLOCK_USER_ERROR_CODES) };
    }

    return { ok: true };
  } catch (err) {
    console.error("unblock_user RPC threw:", err instanceof Error ? err.message : err);
    return { ok: false, code: "UNKNOWN" };
  }
}
