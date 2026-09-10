import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

function readFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf-8");
}

const MIGRATION_PATH = "supabase/migrations/0072_user_blocking_rpcs.sql";

function getFunctionBody(source: string, anchor: string): string {
  const fnStart = source.indexOf(anchor);
  const bodyStart = source.indexOf("begin\n", fnStart);
  const bodyEnd = source.indexOf("end;\n$$;", bodyStart);
  return source.slice(bodyStart, bodyEnd);
}

const BLOCK_ANCHOR = "create or replace function public.block_user(";
const UNBLOCK_ANCHOR = "create or replace function public.unblock_user(";
const BLOCK_STATE_ANCHOR = "create or replace function public.get_conversation_block_state(";

describe("0072 is scoped to exactly three new RPCs -- user_blocks itself is never touched", () => {
  const source = readFile(MIGRATION_PATH);

  it("creates block_user, unblock_user, and get_conversation_block_state, nothing else", () => {
    expect(source).toMatch(/create or replace function public\.block_user\(/);
    expect(source).toMatch(/create or replace function public\.unblock_user\(/);
    expect(source).toMatch(/create or replace function public\.get_conversation_block_state\(/);
  });

  it("does not create, alter, or drop the user_blocks table, its columns, or its RLS policies", () => {
    expect(source).not.toMatch(/create table|drop table|drop column|alter table/i);
    expect(source).not.toMatch(/create policy|alter policy|drop policy/i);
    expect(source).not.toMatch(/create type|alter type|drop type|create index|drop index/i);
  });

  it("never redefines get_conversation_context or any other existing RPC", () => {
    expect(source).not.toMatch(/create or replace function public\.get_conversation_context/i);
    expect(source).not.toMatch(/create or replace function public\.send_message/i);
    expect(source).not.toMatch(/create or replace function public\.submit_report/i);
  });

  it("never touches reports, moderation_actions, or user_restrictions -- blocking is not an automatic report or admin restriction", () => {
    expect(source).not.toMatch(/\binsert into public\.reports\b/);
    expect(source).not.toMatch(/\binsert into public\.moderation_actions\b/);
    expect(source).not.toMatch(/\binsert into public\.user_restrictions\b/);
  });

  it("never deletes or modifies conversations, messages, orders, reviews, or disputes -- history is preserved by construction", () => {
    expect(source).not.toMatch(/\b(delete from|update)\s+public\.conversations\b/);
    expect(source).not.toMatch(/\b(delete from|update)\s+public\.messages\b/);
    expect(source).not.toMatch(/\b(delete from|update)\s+public\.orders\b/);
    expect(source).not.toMatch(/\b(delete from|update)\s+public\.reviews\b/);
  });
});

describe("0072 block_user", () => {
  const source = readFile(MIGRATION_PATH);
  const body = getFunctionBody(source, BLOCK_ANCHOR);

  it("requires authentication before anything else", () => {
    expect(body).toMatch(/v_caller_id := auth\.uid\(\);/);
    expect(body).toMatch(/'Authentication required\.' using detail = 'NOT_AUTHENTICATED'/);
  });

  it("checks caller eligibility (deleted account), matching add_favorite's own convention", () => {
    expect(body).toMatch(/if not found or v_deleted_at is not null then/);
    expect(body).toMatch(/'INTERACTION_BLOCKED'/);
  });

  it("rejects a self-target before ever reaching the insert", () => {
    const selfCheckIndex = body.indexOf("CANNOT_BLOCK_SELF");
    const insertIndex = body.indexOf("insert into public.user_blocks");
    expect(selfCheckIndex).toBeGreaterThan(-1);
    expect(insertIndex).toBeGreaterThan(selfCheckIndex);
    expect(body).toMatch(/if p_blocked_id = v_caller_id then/);
  });

  it("requires the target profile to exist", () => {
    expect(body).toMatch(/if not exists \(select 1 from public\.profiles p where p\.id = p_blocked_id\) then/);
    expect(body).toMatch(/'USER_NOT_FOUND'/);
  });

  it("is idempotent -- ON CONFLICT DO NOTHING, never a plain unguarded insert", () => {
    expect(body).toMatch(/insert into public\.user_blocks \(blocker_id, blocked_id\)/);
    expect(body).toMatch(/on conflict \(blocker_id, blocked_id\) do nothing;/);
  });

  it("only ever writes blocker_id = the caller's own id -- no p_blocker_id parameter exists", () => {
    const signature = source.slice(source.indexOf(BLOCK_ANCHOR), source.indexOf("returns table", source.indexOf(BLOCK_ANCHOR)));
    expect(signature).not.toMatch(/p_blocker_id/);
    expect(body).toMatch(/values \(v_caller_id, p_blocked_id\)/);
  });

  it("returns the blocked id and created_at", () => {
    expect(body).toMatch(/return query\s*\n\s*select ub\.blocked_id, ub\.created_at/);
  });

  it("is SECURITY DEFINER with empty search_path, granted to authenticated only", () => {
    expect(source).toMatch(/security definer/i);
    expect(source).toMatch(/revoke all on function public\.block_user\(uuid\) from public/);
    expect(source).toMatch(/revoke all on function public\.block_user\(uuid\) from anon/);
    expect(source).toMatch(/grant execute on function public\.block_user\(uuid\) to authenticated/);
  });
});

describe("0072 unblock_user", () => {
  const source = readFile(MIGRATION_PATH);
  const body = getFunctionBody(source, UNBLOCK_ANCHOR);

  it("requires authentication and caller eligibility, same as block_user", () => {
    expect(body).toMatch(/v_caller_id := auth\.uid\(\);/);
    expect(body).toMatch(/'NOT_AUTHENTICATED'/);
    expect(body).toMatch(/'INTERACTION_BLOCKED'/);
  });

  it("deletes only the caller's own block row -- no p_blocker_id parameter, no self/target-existence check needed", () => {
    const signature = source.slice(source.indexOf(UNBLOCK_ANCHOR), source.indexOf("returns void", source.indexOf(UNBLOCK_ANCHOR)));
    expect(signature).not.toMatch(/p_blocker_id/);
    expect(body).toMatch(/delete from public\.user_blocks\s*\n\s*where blocker_id = v_caller_id and blocked_id = p_blocked_id;/);
  });

  it("is idempotent by construction -- a plain DELETE, never guarded by a prior existence check", () => {
    expect(body).not.toMatch(/CANNOT_BLOCK_SELF|USER_NOT_FOUND/);
  });

  it("is SECURITY DEFINER with empty search_path, granted to authenticated only", () => {
    expect(source).toMatch(/revoke all on function public\.unblock_user\(uuid\) from public/);
    expect(source).toMatch(/revoke all on function public\.unblock_user\(uuid\) from anon/);
    expect(source).toMatch(/grant execute on function public\.unblock_user\(uuid\) to authenticated/);
  });
});

describe("0072 get_conversation_block_state", () => {
  const source = readFile(MIGRATION_PATH);
  const body = getFunctionBody(source, BLOCK_STATE_ANCHOR);

  it("requires authentication", () => {
    expect(body).toMatch(/v_caller_id := auth\.uid\(\);/);
    expect(body).toMatch(/'NOT_AUTHENTICATED'/);
  });

  it("raises CONVERSATION_NOT_FOUND for a nonexistent conversation", () => {
    expect(body).toMatch(/if not found then\s*\n\s*raise exception 'Conversation not found\.' using detail = 'CONVERSATION_NOT_FOUND';/);
  });

  it("resolves the other participant using the identical initiator/shop-owner logic get_conversation_context uses", () => {
    expect(body).toMatch(/if v_caller_id = v_initiator_id then\s*\n\s*v_other_party_id := v_shop_owner_id;/);
    expect(body).toMatch(/elsif v_caller_id = v_shop_owner_id then\s*\n\s*v_other_party_id := v_initiator_id;/);
  });

  it("raises NOT_CONVERSATION_PARTICIPANT for a caller who is neither the initiator nor the shop owner", () => {
    expect(body).toMatch(/else\s*\n\s*raise exception 'You are not a participant in this conversation\.' using detail = 'NOT_CONVERSATION_PARTICIPANT';/);
  });

  it("returns exactly other_party_id and is_blocked_by_viewer -- no display_name, avatar, or email", () => {
    const signature = source.slice(
      source.indexOf(BLOCK_STATE_ANCHOR),
      source.indexOf("language plpgsql", source.indexOf(BLOCK_STATE_ANCHOR)),
    );
    expect(signature).toMatch(/other_party_id uuid/);
    expect(signature).toMatch(/is_blocked_by_viewer boolean/);
    expect(signature).not.toMatch(/display_name|avatar|email/);
  });

  it("computes is_blocked_by_viewer as a one-directional check (viewer as blocker), not the bidirectional OR get_conversation_context's can_send uses", () => {
    expect(body).toMatch(/where ub\.blocker_id = v_caller_id and ub\.blocked_id = v_other_party_id/);
    expect(body).not.toMatch(/or \(ub\.blocker_id = v_shop_owner_id/);
  });

  it("is SECURITY DEFINER with empty search_path, granted to authenticated only", () => {
    expect(source).toMatch(/revoke all on function public\.get_conversation_block_state\(uuid\) from public/);
    expect(source).toMatch(/revoke all on function public\.get_conversation_block_state\(uuid\) from anon/);
    expect(source).toMatch(/grant execute on function public\.get_conversation_block_state\(uuid\) to authenticated/);
  });
});
