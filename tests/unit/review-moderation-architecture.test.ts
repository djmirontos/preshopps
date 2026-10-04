import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * SOURCE CHECKS. These assert properties of migration and function source
 * text. They do not prove runtime behavior: no database is available in this
 * environment, so idempotency, locking, RLS, and trigger behavior are verified
 * by these source checks only. Runtime verification is a separate step.
 */

function readFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf-8").replace(/\r\n/g, "\n");
}

/** Strips SQL line comments so assertions cannot match explanatory prose. */
function stripSqlComments(source: string): string {
  return source.replace(/--.*$/gm, "");
}

/** Extracts one `create or replace function` body from a migration. */
function functionBody(source: string, name: string): string {
  const start = source.indexOf(`create or replace function public.${name}(`);
  if (start < 0) throw new Error(`function ${name} not found`);
  const end = source.indexOf("\n$$;", start);
  if (end < 0) throw new Error(`function ${name} has no terminator`);
  return source.slice(start, end);
}

const M = {
  enums: "supabase/migrations/0113_review_moderation_enum_values.sql",
  state: "supabase/migrations/0114_review_moderation_state_and_audit.sql",
  rpcs: "supabase/migrations/0115_review_moderation_rpcs.sql",
  readers: "supabase/migrations/0116_review_moderation_public_read_filters.sql",
  guards: "supabase/migrations/0117_review_moderation_edit_guards.sql",
};

describe("Review moderation source checks -- migration order and enum separation", () => {
  it("the five migrations exist in order after 0112", () => {
    for (const file of Object.values(M)) {
      expect(readFileSync(path.join(process.cwd(), file), "utf-8").length).toBeGreaterThan(0);
    }
    const names = Object.values(M).map((f) => path.basename(f));
    expect(names).toEqual([...names].sort());
    expect(names[0].startsWith("0113_")).toBe(true);
  });

  it("0113 contains only ALTER TYPE statements (enum values are unusable in the transaction that adds them)", () => {
    const statements = stripSqlComments(readFile(M.enums))
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    expect(statements.length).toBe(4);
    for (const statement of statements) {
      expect(statement.startsWith("alter type public.")).toBe(true);
    }
  });

  it("0113 adds review_removed and review_restored to both the notification and email enums", () => {
    const source = stripSqlComments(readFile(M.enums));
    expect(source).toMatch(/alter type public\.notification_type_enum add value if not exists 'review_removed'/);
    expect(source).toMatch(/alter type public\.notification_type_enum add value if not exists 'review_restored'/);
    expect(source).toMatch(/alter type public\.email_event_type_enum add value if not exists 'review_removed'/);
    expect(source).toMatch(/alter type public\.email_event_type_enum add value if not exists 'review_restored'/);
  });

  it("no migration that uses the new enum values is in the same file as their ADD VALUE", () => {
    for (const file of [M.state, M.rpcs, M.readers, M.guards]) {
      expect(stripSqlComments(readFile(file))).not.toMatch(/add value/i);
    }
  });
});

describe("Review moderation source checks -- 0114 schema, audit, and immutability", () => {
  const source = stripSqlComments(readFile(M.state));

  it("adds a nullable removed_at to reviews and creates no client-facing policy", () => {
    expect(source).toMatch(/alter table public\.reviews\s+add column if not exists removed_at timestamptz null/);
    expect(source).not.toMatch(/create policy/i);
  });

  it("enables RLS and revokes every client privilege on the audit table", () => {
    expect(source).toMatch(/alter table public\.review_moderation_actions enable row level security/);
    expect(source).toMatch(/revoke all on public\.review_moderation_actions from public/);
    expect(source).toMatch(/revoke all on public\.review_moderation_actions from anon/);
    expect(source).toMatch(/revoke all on public\.review_moderation_actions from authenticated/);
  });

  it("the immutability trigger rejects UPDATE, DELETE, and TRUNCATE", () => {
    expect(source).toMatch(/before update or delete on public\.review_moderation_actions/);
    expect(source).toMatch(/before truncate on public\.review_moderation_actions/);
    expect(source).toMatch(/raise exception 'Review moderation audit records are immutable\.'/);
  });

  it("records previous and new state, and only the two legal transitions", () => {
    expect(source).toMatch(/previous_state text not null/);
    expect(source).toMatch(/new_state text not null/);
    expect(source).toMatch(/review_moderation_actions_transition_check/);
    expect(source).toMatch(/action_type = 'review_removed' and previous_state = 'visible' and new_state = 'removed'/);
    expect(source).toMatch(/action_type = 'review_restored' and previous_state = 'removed' and new_state = 'visible'/);
  });

  it("requires a user-facing message for removal and caps both free-text fields at 1000 characters", () => {
    expect(source).toMatch(/review_moderation_actions_removal_reason_required_check/);
    expect(source).toMatch(/char_length\(public_message\) <= 1000/);
    expect(source).toMatch(/char_length\(private_note\) <= 1000/);
  });
});

describe("Review moderation source checks -- 0115 RPC authorization, locking, and idempotency", () => {
  const source = stripSqlComments(readFile(M.rpcs));
  const rpcNames = ["get_admin_review_state", "remove_review", "restore_review", "get_order_review_removal"];

  it.each(rpcNames)("%s is SECURITY DEFINER with an empty search_path and server-side auth", (name) => {
    const body = functionBody(source, name);
    expect(body).toMatch(/security definer/);
    expect(body).toMatch(/set search_path = ''/);
    expect(body).toMatch(/auth\.uid\(\)/);
    expect(body).toMatch(/raise exception 'Authentication required\.' using detail = 'NOT_AUTHENTICATED'/);
    expect(source).toMatch(new RegExp(`revoke all on function public\\.${name}\\([^)]*\\) from anon`));
  });

  it.each(["get_admin_review_state", "get_order_review_removal"])("%s (read-only) is granted to authenticated in 0115", (name) => {
    expect(source).toMatch(new RegExp(`grant execute on function public\\.${name}\\([^)]*\\) to authenticated`));
  });

  it.each(["remove_review", "restore_review"])("%s is revoked from every client role in 0115 and never granted there (deployment gating)", (name) => {
    expect(source).toMatch(new RegExp(`revoke all on function public\\.${name}\\([^)]*\\) from public`));
    expect(source).toMatch(new RegExp(`revoke all on function public\\.${name}\\([^)]*\\) from anon`));
    expect(source).toMatch(new RegExp(`revoke all on function public\\.${name}\\([^)]*\\) from authenticated`));
    expect(source).not.toMatch(new RegExp(`grant execute on function public\\.${name}\\(`));
  });

  it("0117 issues the authenticated grants for remove_review and restore_review as its final statements", () => {
    const guards = stripSqlComments(readFile(M.guards));
    const removeGrant = guards.indexOf("grant execute on function public.remove_review(uuid, text, text) to authenticated");
    const restoreGrant = guards.indexOf("grant execute on function public.restore_review(uuid, text, text) to authenticated");
    expect(removeGrant).toBeGreaterThan(-1);
    expect(restoreGrant).toBeGreaterThan(removeGrant);
    // Nothing that installs a filter or guard comes after the grants.
    expect(guards.indexOf("update_review")).toBeLessThan(removeGrant);
    expect(guards.indexOf("upsert_review_reply")).toBeLessThan(removeGrant);
    expect(guards.indexOf("get_order_review(")).toBeLessThan(removeGrant);
    const readers = stripSqlComments(readFile(M.readers));
    expect(readers).not.toMatch(/grant execute on function public\.(remove_review|restore_review)/);
  });

  it("the deployment-gating comment and the per-migration transaction requirement are documented in 0115 and 0117", () => {
    expect(readFile(M.rpcs)).toMatch(/DEPLOYMENT GATING/);
    expect(readFile(M.rpcs)).toMatch(/TRANSACTION BOUNDARY \(requirement, not verified here\)/);
    expect(readFile(M.guards)).toMatch(/FINAL GRANTS/);
  });

  it.each(["get_admin_review_state", "remove_review", "restore_review"])("%s enforces the admin role server-side", (name) => {
    expect(functionBody(source, name)).toMatch(/from public\.user_roles ur where ur\.user_id = v_caller/);
  });

  it.each(["remove_review", "restore_review"])("%s locks the review row before recalculating trusted-seller state (consistent lock order)", (name) => {
    const body = functionBody(source, name);
    const lock = body.indexOf("for update");
    const recalc = body.indexOf("recalculate_trusted_seller");
    expect(lock).toBeGreaterThan(-1);
    expect(recalc).toBeGreaterThan(lock);
  });

  it.each([
    ["remove_review", "if v_existing_removed_at is not null then"],
    ["restore_review", "if v_existing_removed_at is null then"],
  ])("%s returns early on an idempotent repeat before any write, audit, outbox, or notification", (name, guard) => {
    const body = functionBody(source, name);
    const earlyReturn = body.indexOf(guard);
    expect(earlyReturn).toBeGreaterThan(-1);
    for (const write of ["update public.reviews", "insert into public.review_moderation_actions", "enqueue_email", "insert into public.notifications"]) {
      expect(body.indexOf(write)).toBeGreaterThan(earlyReturn);
    }
  });

  it.each(["remove_review", "restore_review"])("%s keys outbox and notification dedupe to the audit row, not to the review", (name) => {
    const body = functionBody(source, name);
    expect(body).toMatch(/v_audit_id::text \|\| ':(removed|restored)'/);
    expect(body).toMatch(/enqueue_email\(\s*'review_(removed|restored)'::public\.email_event_type_enum,\s*v_buyer_id,\s*v_audit_id/);
  });

  it.each(["remove_review", "restore_review"])("%s never places the private note in an outbox payload", (name) => {
    const body = functionBody(source, name);
    const start = body.indexOf("perform public.enqueue_email(");
    const end = body.indexOf(");", start);
    const payload = body.slice(start, end);
    expect(payload).toMatch(/public_message/);
    expect(payload).not.toMatch(/private_note|v_note/);
  });

  it.each(["remove_review", "restore_review"])("%s writes notifications with a NULL actor, so the admin is not disclosed", (name) => {
    const body = functionBody(source, name);
    expect(body).toMatch(/select v_buyer_id, 'review_(removed|restored)', null, v_order_id, p_review_id/);
    expect(body).toMatch(/on conflict on constraint notifications_recipient_type_dedupe_key do nothing/);
  });

  it("get_order_review_removal never returns the private note and returns the message only to the buyer", () => {
    const body = functionBody(source, "get_order_review_removal");
    expect(body).not.toMatch(/private_note/);
    expect(body).toMatch(/if v_removed_at is not null and v_caller = v_buyer_id then/);
    expect(body).toMatch(/if v_caller is distinct from v_buyer_id and v_caller is distinct from v_shop_owner_id then/);
  });

  it("get_admin_review_state reads the private note only after the admin check", () => {
    const body = functionBody(source, "get_admin_review_state");
    const adminCheck = body.indexOf("NOT_ADMIN");
    const privateRead = body.indexOf("a.private_note");
    expect(adminCheck).toBeGreaterThan(-1);
    expect(privateRead).toBeGreaterThan(adminCheck);
  });
});

describe("Review moderation source checks -- 0116 public readers and trusted-seller calculation", () => {
  const source = stripSqlComments(readFile(M.readers));

  it.each([
    "get_shop_reviews",
    "get_shop_review_summary",
    "get_shop_detail",
    "get_listing_detail",
    "recalculate_trusted_seller",
  ])("%s excludes removed reviews", (name) => {
    expect(functionBody(source, name)).toMatch(/r\.removed_at is null/);
  });

  it("the readers keep their signatures (CREATE OR REPLACE with an unchanged argument list)", () => {
    expect(source).toMatch(/create or replace function public\.get_shop_reviews\(\s*p_shop_id uuid,\s*p_limit integer default 20,/);
    expect(source).toMatch(/create or replace function public\.recalculate_trusted_seller\(\s*p_shop_id uuid\s*\)/);
  });
});

describe("Review moderation source checks -- 0117 edit and reply guards, and buyer/seller flags", () => {
  const source = stripSqlComments(readFile(M.guards));

  it("update_review rejects a removed review after the authorship check and before the edit window", () => {
    const body = functionBody(source, "update_review");
    const author = body.indexOf("NOT_REVIEW_AUTHOR");
    const removed = body.indexOf("REVIEW_REMOVED");
    const window = body.indexOf("REVIEW_EDIT_WINDOW_CLOSED");
    expect(author).toBeGreaterThan(-1);
    expect(removed).toBeGreaterThan(author);
    expect(window).toBeGreaterThan(removed);
    expect(body).toMatch(/r\.removed_at[\s\S]*for update/);
  });

  it("upsert_review_reply rejects a removed review after the seller check, for first replies and edits alike", () => {
    const body = functionBody(source, "upsert_review_reply");
    const seller = body.indexOf("NOT_REVIEW_SELLER");
    const removed = body.indexOf("REVIEW_REMOVED");
    // Anchor on the peer-block message: the deleted-account check earlier in
    // the function also raises INTERACTION_BLOCKED.
    const peerBlock = body.indexOf("You cannot reply to this review.");
    expect(removed).toBeGreaterThan(seller);
    expect(removed).toBeLessThan(peerBlock);
    expect(body).toMatch(/r\.reply_created_at, r\.removed_at/);
  });

  it("get_order_review closes can_edit_review and can_write_reply while removed", () => {
    const body = functionBody(source, "get_order_review");
    expect(body.match(/v_review_removed_at is null/g)?.length).toBe(2);
  });

  it("the edit window is still anchored to created_at and the reply window to reply_created_at (unchanged)", () => {
    const body = functionBody(source, "update_review");
    expect(body).toMatch(/now\(\) >= v_review_created_at \+ interval '7 days'/);
    const replyBody = functionBody(source, "upsert_review_reply");
    expect(replyBody).toMatch(/v_now >= v_existing_reply_created_at \+ interval '7 days'/);
  });
});

describe("Review moderation source checks -- outbox template and privacy of client-facing code", () => {
  const processor = readFile("supabase/functions/process-email-outbox/index.ts");

  it("process-email-outbox renders both review events through the shared template helper", () => {
    expect(processor).toMatch(/case "review_removed": \{/);
    expect(processor).toMatch(/case "review_restored": \{/);
    expect(processor).toMatch(/"review_removed"\s*\|\s*"review_restored"|\| "review_removed"\s*\n\s*\| "review_restored"/);
  });

  it("the HTML path escapes every line through wrapHtml/escapeHtml", () => {
    expect(processor).toMatch(/function wrapHtml\(bodyLines: string\[\], linkHref: string, linkLabel: string\): string \{\s*const paragraphs = bodyLines\.map\(\(line\) => `<p style="margin:0 0 12px;">\$\{escapeHtml\(line\)\}<\/p>`\)/);
  });

  it("the email templates never reference the private note", () => {
    expect(processor).not.toMatch(/private_note|privateNote/);
  });

  it("the buyer-facing wrapper and component never reference the private note", () => {
    for (const file of ["lib/reviews/get-order-review-removal.ts", "components/orders/ReviewRemovalNotice.tsx"]) {
      expect(readFile(file)).not.toMatch(/private_?[Nn]ote/);
    }
  });

  it("the admin wrapper sends no role or admin flag in any RPC call", () => {
    const wrapper = readFile("lib/admin/review-moderation-actions.ts");
    expect(wrapper).not.toMatch(/is_admin|role:|isAdmin/);
  });
});

// SOURCE CHECKS (not runtime proof): the notification contract for the
// user-facing moderation message, and its privacy boundary.
describe("Review moderation source checks -- notification contract (user-facing message only)", () => {
  const state = stripSqlComments(readFile(M.state));
  const rpcs = stripSqlComments(readFile(M.rpcs));
  const readers = stripSqlComments(readFile(M.readers));

  it("0114 adds a bounded, nullable public_message column to notifications", () => {
    expect(state).toMatch(/alter table public\.notifications\s+add column if not exists public_message text null/);
    expect(state).toMatch(/char_length\(public_message\) <= 1000/);
  });

  it.each([
    ["remove_review", "review_removed", "v_message"],
    ["restore_review", "review_restored", "v_message"],
  ])("%s writes the user-facing message (and never the private note) into its notification row", (name, type, field) => {
    const body = functionBody(rpcs, name);
    const start = body.indexOf("insert into public.notifications");
    const end = body.indexOf(";", start);
    const statement = body.slice(start, end);
    expect(statement).toMatch(new RegExp(`'${type}'`));
    // The message column is listed before the value, and the value is the local v_message.
    expect(statement.indexOf("public_message")).toBeGreaterThan(-1);
    expect(statement.indexOf(field, statement.indexOf("public_message"))).toBeGreaterThan(statement.indexOf("public_message"));
    expect(statement).not.toMatch(/v_note|private_note/);
  });

  it("0116 drops and recreates get_my_notifications with public_message, keeping recipient scoping and authenticated-only access", () => {
    expect(readers).toMatch(/drop function if exists public\.get_my_notifications\(integer, timestamptz, uuid\);/);
    const body = functionBody(readers, "get_my_notifications");
    expect(body).toMatch(/public_message text/);
    expect(body).toMatch(/n\.public_message/);
    expect(body).toMatch(/where n\.recipient_id = v_caller/);
    expect(readers).toMatch(/revoke all on function public\.get_my_notifications\(integer, timestamptz, uuid\) from anon;/);
    expect(readers).toMatch(/grant execute on function public\.get_my_notifications\(integer, timestamptz, uuid\) to authenticated;/);
    expect(readers).not.toMatch(/private_note/);
  });

  it("the notification feed never projects the private note", () => {
    expect(readers).not.toMatch(/private_note/);
  });
});
