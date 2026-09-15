import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

function readFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf-8");
}

const MIGRATION_PATH = "supabase/migrations/0093_seller_order_messaging.sql";

function getFunctionBody(source: string, anchor: string): string {
  const fnStart = source.indexOf(anchor);
  const bodyStart = source.indexOf("begin\n", fnStart);
  const bodyEnd = source.indexOf("\nend;\n$$;", bodyStart);
  return source.slice(bodyStart, bodyEnd);
}

function getFunctionSignature(source: string, anchor: string): string {
  const fnStart = source.indexOf(anchor);
  return source.slice(fnStart, source.indexOf("language plpgsql", fnStart));
}

const LOOKUP_ANCHOR = "create or replace function public.get_conversation_for_shop_order(";
const FIRST_MESSAGE_ANCHOR = "create or replace function public.start_conversation_from_order(";

describe("0093 is the newest migration and 0086 remains absent", () => {
  it("0093_seller_order_messaging.sql exists and is the highest-numbered migration file", () => {
    const migrationFiles = readdirSync(path.join(process.cwd(), "supabase/migrations")).filter((f) => f.endsWith(".sql"));
    expect(migrationFiles).toContain("0093_seller_order_messaging.sql");
    const numbered = migrationFiles.filter((f) => /^\d{4}_/.test(f));
    const highest = numbered.sort().at(-1);
    expect(highest).toBe("0093_seller_order_messaging.sql");
  });

  it("no 0086-numbered migration file exists", () => {
    const migrationFiles = readdirSync(path.join(process.cwd(), "supabase/migrations"));
    expect(migrationFiles.some((f) => f.startsWith("0086_"))).toBe(false);
  });
});

describe("0093 is scoped to exactly two new RPCs -- no schema/index/enum/RLS/publication change", () => {
  const source = readFile(MIGRATION_PATH);

  it("creates get_conversation_for_shop_order and start_conversation_from_order, nothing else", () => {
    expect(source).toMatch(/create or replace function public\.get_conversation_for_shop_order\(/);
    expect(source).toMatch(/create or replace function public\.start_conversation_from_order\(/);
    const createFunctionCount = (source.match(/create or replace function/g) ?? []).length;
    expect(createFunctionCount).toBe(2);
  });

  it("creates, alters, or drops no table, column, index, or enum", () => {
    expect(source).not.toMatch(/create table|drop table|alter table|drop column|add column/i);
    expect(source).not.toMatch(/create type|alter type|drop type/i);
    expect(source).not.toMatch(/create index|drop index|alter index/i);
  });

  it("creates, alters, or drops no RLS policy", () => {
    expect(source).not.toMatch(/create policy|alter policy|drop policy|enable row level security|disable row level security/i);
  });

  it("touches no Realtime publication", () => {
    expect(source).not.toMatch(/alter publication/i);
  });

  it("never redefines any existing messaging or unread-count RPC", () => {
    expect(source).not.toMatch(/create or replace function public\.start_conversation\(/);
    expect(source).not.toMatch(/create or replace function public\.send_message\(/);
    expect(source).not.toMatch(/create or replace function public\.get_my_conversations\(/);
    expect(source).not.toMatch(/create or replace function public\.get_conversation_context\(/);
    expect(source).not.toMatch(/create or replace function public\.get_conversation_messages\(/);
    expect(source).not.toMatch(/create or replace function public\.get_my_unread_conversation_count\(/);
    expect(source).not.toMatch(/create or replace function public\.get_my_general_notification_unread_count\(/);
  });
});

describe("get_conversation_for_shop_order: signature accepts only p_order_public_code", () => {
  const source = readFile(MIGRATION_PATH);
  const signature = getFunctionSignature(source, LOOKUP_ANCHOR);

  it("accepts exactly one parameter: p_order_public_code text", () => {
    expect(signature).toMatch(/p_order_public_code text/);
    expect(signature).not.toMatch(/p_buyer_id|p_shop_id|p_user_id|p_conversation_id/);
  });

  it("returns only conversation_id -- no buyer_id, shop_id, or any other field", () => {
    expect(signature).toMatch(/returns table \(\s*\n\s*conversation_id uuid\s*\n\s*\)/);
    expect(signature).not.toMatch(/buyer_id|shop_id/);
  });
});

describe("get_conversation_for_shop_order: behavior", () => {
  const source = readFile(MIGRATION_PATH);
  const body = getFunctionBody(source, LOOKUP_ANCHOR);

  it("derives the caller from auth.uid(), rejecting unauthenticated callers with the standard NOT_AUTHENTICATED code", () => {
    expect(body).toMatch(/v_caller := auth\.uid\(\);/);
    expect(body).toMatch(/'Authentication required\.' using detail = 'NOT_AUTHENTICATED'/);
  });

  it("derives the caller's shop server-side -- shops.owner_id = caller, never a parameter", () => {
    expect(body).toMatch(/select s\.id into v_shop_id\s*\n\s*from public\.shops s\s*\n\s*where s\.owner_id = v_caller;/);
  });

  it("no shop yet resolves to a soft zero-row return, not an error", () => {
    const noShopIndex = body.indexOf("where s.owner_id = v_caller;");
    const afterNoShop = body.slice(noShopIndex, noShopIndex + 80);
    expect(afterNoShop).toMatch(/if not found then\s*\n\s*return;\s*\n\s*end if;/);
  });

  it("validates the order belongs to the caller's shop -- cross-shop and nonexistent order both resolve identically", () => {
    expect(body).toMatch(/if not found or v_order_shop_id <> v_shop_id then\s*\n\s*return;\s*\n\s*end if;/);
  });

  it("looks up the order by public_code alone, deriving both shop_id and buyer_id from the row internally", () => {
    expect(body).toMatch(/select o\.shop_id, o\.buyer_id\s*\n\s*into v_order_shop_id, v_buyer_id\s*\n\s*from public\.orders o\s*\n\s*where o\.public_code = p_order_public_code;/);
  });

  it("the final query filters strictly to the GENERAL conversation -- listing_id IS NULL", () => {
    expect(body).toMatch(/where c\.initiator_id = v_buyer_id\s*\n\s*and c\.shop_id = v_shop_id\s*\n\s*and c\.listing_id is null;/);
  });

  it("performs no INSERT, UPDATE, or DELETE of any kind", () => {
    expect(body).not.toMatch(/\binsert into\b|\bupdate\b|\bdelete from\b/i);
  });

  it("never selects from or writes to notifications or conversation_user_states -- pure read, zero side effects", () => {
    expect(body).not.toMatch(/notifications|conversation_user_states/);
  });

  it("never gates on order status, buyer restriction, seller restriction, or buyer deleted_at", () => {
    expect(body).not.toMatch(/o\.status|order_status_enum/);
    expect(body).not.toMatch(/user_restrictions/);
    expect(body).not.toMatch(/deleted_at/);
  });

  it("is SECURITY DEFINER with empty search_path, revoked from public/anon, granted to authenticated only", () => {
    const signature = source.slice(source.indexOf(LOOKUP_ANCHOR), source.indexOf("as $$", source.indexOf(LOOKUP_ANCHOR)));
    expect(signature).toMatch(/security definer/);
    expect(signature).toMatch(/set search_path = ''/);
    expect(source).toMatch(/revoke all on function public\.get_conversation_for_shop_order\(text\) from public;/);
    expect(source).toMatch(/revoke all on function public\.get_conversation_for_shop_order\(text\) from anon;/);
    expect(source).toMatch(/grant execute on function public\.get_conversation_for_shop_order\(text\) to authenticated;/);
  });
});

describe("start_conversation_from_order: signature accepts only p_order_public_code and p_body", () => {
  const source = readFile(MIGRATION_PATH);
  const signature = getFunctionSignature(source, FIRST_MESSAGE_ANCHOR);

  it("accepts exactly two parameters: p_order_public_code text, p_body text", () => {
    expect(signature).toMatch(/p_order_public_code text/);
    expect(signature).toMatch(/p_body text/);
    expect(signature).not.toMatch(/p_buyer_id|p_shop_id|p_user_id|p_conversation_id|p_seller_id/);
  });

  it("returns the same useful shape as start_conversation: conversation_id, message_id, message_created_at, conversation_created", () => {
    expect(signature).toMatch(/conversation_id uuid,\s*\n\s*message_id uuid,\s*\n\s*message_created_at timestamptz,\s*\n\s*conversation_created boolean/);
  });
});

describe("start_conversation_from_order: authorization derives buyer from the authorized order only", () => {
  const source = readFile(MIGRATION_PATH);
  const body = getFunctionBody(source, FIRST_MESSAGE_ANCHOR);

  it("derives the caller from auth.uid(), requires authentication", () => {
    expect(body).toMatch(/v_caller := auth\.uid\(\);/);
    expect(body).toMatch(/'Authentication required\.' using detail = 'NOT_AUTHENTICATED'/);
  });

  it("checks the caller's own profile is not deleted/anonymized", () => {
    expect(body).toMatch(/select p\.deleted_at into v_caller_deleted_at\s*\n\s*from public\.profiles p\s*\n\s*where p\.id = v_caller;/);
    expect(body).toMatch(/if v_caller_deleted_at is not null then\s*\n\s*raise exception 'Your account cannot send messages\.' using detail = 'INTERACTION_BLOCKED';/);
  });

  it("derives the caller's shop server-side -- shops.owner_id = caller, never a parameter", () => {
    expect(body).toMatch(/select s\.id into v_shop_id\s*\n\s*from public\.shops s\s*\n\s*where s\.owner_id = v_caller;/);
  });

  it("no shop and cross-shop/nonexistent order both raise the identical ORDER_NOT_FOUND exception", () => {
    const noShopIndex = body.indexOf("where s.owner_id = v_caller;");
    const noShopBranch = body.slice(noShopIndex, noShopIndex + 150);
    expect(noShopBranch).toMatch(/if not found then\s*\n\s*raise exception 'Order not found\.' using detail = 'ORDER_NOT_FOUND';/);
    expect(body).toMatch(/if not found or v_order_shop_id <> v_shop_id then\s*\n\s*raise exception 'Order not found\.' using detail = 'ORDER_NOT_FOUND';/);
  });

  it("derives buyer_id from the order row itself, never from a parameter", () => {
    expect(body).toMatch(/select o\.shop_id, o\.buyer_id\s*\n\s*into v_order_shop_id, v_buyer_id\s*\n\s*from public\.orders o\s*\n\s*where o\.public_code = p_order_public_code;/);
  });
});

describe("start_conversation_from_order: recipient deletion policy (locked decision)", () => {
  const source = readFile(MIGRATION_PATH);
  const body = getFunctionBody(source, FIRST_MESSAGE_ANCHOR);

  it("checks the buyer's deleted_at only inside the fresh-creation branch, before the INSERT", () => {
    const createBranchStart = body.indexOf("if v_conversation_id is null then");
    const insertIndex = body.indexOf("insert into public.conversations as c");
    const deletedCheckIndex = body.indexOf("v_buyer_deleted_at is not null");
    expect(createBranchStart).toBeGreaterThan(-1);
    expect(deletedCheckIndex).toBeGreaterThan(createBranchStart);
    expect(deletedCheckIndex).toBeLessThan(insertIndex);
  });

  it("a deleted/anonymized buyer blocks creation with the standard INTERACTION_BLOCKED code, never a distinguishing message", () => {
    expect(body).toMatch(/if v_buyer_deleted_at is not null then\s*\n\s*raise exception 'You cannot message this buyer right now\.' using detail = 'INTERACTION_BLOCKED';/);
  });

  it("the deleted-buyer check is scoped only to the null-conversation branch -- never applied when a conversation already exists", () => {
    const createBranchStart = body.indexOf("if v_conversation_id is null then");
    const createBranchEnd = body.indexOf("\n  end if;", createBranchStart);
    const deletedCheckIndex = body.indexOf("v_buyer_deleted_at");
    expect(deletedCheckIndex).toBeGreaterThan(createBranchStart);
    expect(deletedCheckIndex).toBeLessThan(createBranchEnd);
  });
});

describe("start_conversation_from_order: restrictions and blocking mirror existing messaging policy exactly", () => {
  const source = readFile(MIGRATION_PATH);
  const body = getFunctionBody(source, FIRST_MESSAGE_ANCHOR);

  it("checks the buyer's restrictions (buyer_restricted/account_suspended), role-based", () => {
    expect(body).toMatch(/where ur\.user_id = v_buyer_id\s*\n\s*and ur\.lifted_at is null\s*\n\s*and ur\.restriction_type in \('buyer_restricted', 'account_suspended'\)/);
  });

  it("checks the seller/caller's restrictions (seller_suspended/account_suspended), role-based", () => {
    expect(body).toMatch(/where ur\.user_id = v_caller\s*\n\s*and ur\.lifted_at is null\s*\n\s*and ur\.restriction_type in \('seller_suspended', 'account_suspended'\)/);
  });

  it("checks bidirectional user_blocks between the caller and the buyer", () => {
    expect(body).toMatch(/where \(ub\.blocker_id = v_caller and ub\.blocked_id = v_buyer_id\)\s*\n\s*or \(ub\.blocker_id = v_buyer_id and ub\.blocked_id = v_caller\)/);
  });

  it("every restriction/blocking rejection uses the same existing INTERACTION_BLOCKED code -- no weaker or stronger privilege than send_message", () => {
    const restrictionAndBlockSection = body.slice(body.indexOf("admin restrictions"), body.indexOf("message normalization"));
    const rejectionCount = (restrictionAndBlockSection.match(/'INTERACTION_BLOCKED'/g) ?? []).length;
    expect(rejectionCount).toBe(3);
  });
});

describe("start_conversation_from_order: message validation mirrors existing messaging exactly", () => {
  const source = readFile(MIGRATION_PATH);
  const body = getFunctionBody(source, FIRST_MESSAGE_ANCHOR);

  it("trims leading/trailing whitespace using the identical regexp_replace expression", () => {
    expect(body).toMatch(/v_body := regexp_replace\(p_body, '\^\[\[:space:\]\]\+\|\[\[:space:\]\]\+\$', '', 'g'\);/);
  });

  it("rejects an empty/whitespace-only body with MESSAGE_EMPTY", () => {
    expect(body).toMatch(/if v_body is null or v_body !~ '\[\^\[:space:\]\]' then\s*\n\s*raise exception 'Message cannot be empty\.' using detail = 'MESSAGE_EMPTY';/);
  });

  it("enforces the existing 4000-character maximum, no new length policy", () => {
    expect(body).toMatch(/if char_length\(v_body\) > 4000 then\s*\n\s*raise exception 'Message is too long\.' using detail = 'MESSAGE_TOO_LONG';/);
  });
});

describe("start_conversation_from_order: GENERAL-conversation find-or-create reuses the existing unique index", () => {
  const source = readFile(MIGRATION_PATH);
  const body = getFunctionBody(source, FIRST_MESSAGE_ANCHOR);

  it("the lookup and the insert both key on (initiator_id = buyer, shop_id = seller's shop, listing_id IS NULL)", () => {
    const lookupCount = (body.match(/c\.initiator_id = v_buyer_id and c\.shop_id = v_shop_id and c\.listing_id is null/g) ?? []).length;
    expect(lookupCount).toBe(2); // once before create, once in the unique_violation re-select
  });

  it("the fresh INSERT always supplies listing_id = null and conversation_type = 'general_shop' -- never listing-specific, never one-per-order", () => {
    expect(body).toMatch(/values \('general_shop', v_buyer_id, v_shop_id, null, v_now\)/);
  });

  it("the initiator_id column is set to the BUYER, never the calling seller -- the schema's role model is preserved", () => {
    expect(body).toMatch(/insert into public\.conversations as c \(conversation_type, initiator_id, shop_id, listing_id, last_message_at\)\s*\n\s*values \('general_shop', v_buyer_id,/);
  });

  it("the create attempt is wrapped in its own BEGIN/EXCEPTION block catching unique_violation", () => {
    expect(body).toMatch(/begin\s*\n\s*insert into public\.conversations as c/);
    expect(body).toMatch(/exception\s*\n\s*when unique_violation then/);
  });

  it("a lost creation race re-selects the canonical row FOR UPDATE rather than erroring", () => {
    const exceptionIndex = body.indexOf("when unique_violation then");
    const afterException = body.slice(exceptionIndex, exceptionIndex + 500);
    expect(afterException).toMatch(/v_conversation_created := false;/);
    expect(afterException).toMatch(/for update;/);
  });

  it("no new uniqueness constraint or index is introduced anywhere in this migration -- the existing partial unique index remains the sole source of truth", () => {
    expect(source).not.toMatch(/create unique index|add constraint/i);
  });
});

describe("start_conversation_from_order: message/state/notification behavior mirrors start_conversation/send_message", () => {
  const source = readFile(MIGRATION_PATH);
  const body = getFunctionBody(source, FIRST_MESSAGE_ANCHOR);

  it("the message insert, conversation resolution, and state row inserts are all in the same function -- one atomic transaction, never two RPC calls", () => {
    expect(body).toMatch(/insert into public\.conversations as c/);
    expect(body).toMatch(/insert into public\.messages as m/);
  });

  it("the message insert happens unconditionally, after both the create and reuse branches converge -- no successful path skips it", () => {
    const stateInvariantIndex = body.indexOf("state-row invariant for EXISTING conversations only");
    const messageInsertIndex = body.indexOf("insert into public.messages as m");
    expect(stateInvariantIndex).toBeGreaterThan(-1);
    expect(messageInsertIndex).toBeGreaterThan(stateInvariantIndex);
  });

  it("sender_id is always the caller (the seller) -- never client-supplied beyond auth.uid()", () => {
    expect(body).toMatch(/insert into public\.messages as m \(conversation_id, sender_id, body, created_at\)\s*\n\s*values \(v_conversation_id, v_caller, v_body, v_now\)/);
  });

  it("advances conversations.last_message_at to the same transaction-stable timestamp as the message", () => {
    expect(body).toMatch(/update public\.conversations as c\s*\n\s*set last_message_at = v_now\s*\n\s*where c\.id = v_conversation_id;/);
  });

  it("advances the caller's own state (last_read_at, clears marked_unread_at) and clears only the buyer's archived_at", () => {
    expect(body).toMatch(/set last_read_at = v_now,\s*\n\s*marked_unread_at = null\s*\n\s*where cus\.conversation_id = v_conversation_id and cus\.user_id = v_caller;/);
    expect(body).toMatch(/set archived_at = null\s*\n\s*where cus\.conversation_id = v_conversation_id and cus\.user_id <> v_caller;/);
  });

  it("the state-row invariant guard is only checked on the reuse path (not v_conversation_created), matching start_conversation's own established shape", () => {
    expect(body).toMatch(/if not v_conversation_created then/);
    expect(body).toMatch(/'Conversation state is missing or corrupted\.' using detail = 'CONVERSATION_STATE_INVALID'/);
  });

  it("inserts a new_message notification to the buyer, suppressed if muted, suppressed if the buyer is deleted, deduped on the existing constraint", () => {
    expect(body).toMatch(/where cus\.conversation_id = v_conversation_id\s*\n\s*and cus\.user_id = v_buyer_id\s*\n\s*and cus\.muted/);
    expect(body).toMatch(/insert into public\.notifications \(recipient_id, type, actor_id, conversation_id, dedupe_key\)\s*\n\s*select v_buyer_id, 'new_message', v_caller, v_conversation_id, v_message_id::text/);
    expect(body).toMatch(/where not exists \(\s*\n\s*select 1 from public\.profiles p where p\.id = v_buyer_id and p\.deleted_at is not null\s*\n\s*\)/);
    expect(body).toMatch(/on conflict on constraint notifications_recipient_type_dedupe_key do nothing;/);
  });

  it("never gates any of this on order status", () => {
    expect(body).not.toMatch(/o\.status|order_status_enum/);
  });

  it("is SECURITY DEFINER with empty search_path, revoked from public/anon, granted to authenticated only", () => {
    const signature = source.slice(source.indexOf(FIRST_MESSAGE_ANCHOR), source.indexOf("as $$", source.indexOf(FIRST_MESSAGE_ANCHOR)));
    expect(signature).toMatch(/security definer/);
    expect(signature).toMatch(/set search_path = ''/);
    expect(source).toMatch(/revoke all on function public\.start_conversation_from_order\(text, text\) from public;/);
    expect(source).toMatch(/revoke all on function public\.start_conversation_from_order\(text, text\) from anon;/);
    expect(source).toMatch(/grant execute on function public\.start_conversation_from_order\(text, text\) to authenticated;/);
  });
});

describe("frontend wrappers never accept a buyerId and never surface raw backend errors", () => {
  const lookupSource = readFile("lib/messaging/get-conversation-for-shop-order.ts");
  const firstMessageSource = readFile("lib/messaging/start-conversation-from-order.ts");

  it("neither wrapper's exported function signature accepts a buyerId/shopId parameter", () => {
    expect(lookupSource).not.toMatch(/buyerId|shopId/);
    expect(firstMessageSource).not.toMatch(/buyerId|shopId/);
  });

  it("neither wrapper ever returns error.message (the raw Supabase/Postgres error) to its caller", () => {
    for (const source of [lookupSource, firstMessageSource]) {
      const returnStatements = source.match(/return \{[^}]*\}/g) ?? [];
      for (const statement of returnStatements) {
        expect(statement).not.toMatch(/error\.message/);
      }
    }
  });

  it("both wrappers log failures server/console-side only, never include the raw message in the returned value", () => {
    expect(lookupSource).toMatch(/console\.error\("get_conversation_for_shop_order RPC failed:", error\.message\);/);
    expect(firstMessageSource).toMatch(/console\.error\("start_conversation_from_order RPC failed:", error\.message\);/);
  });

  it("the lookup wrapper's only failure surface is a fixed generic string, not a per-code map", () => {
    expect(lookupSource).toMatch(/const GENERIC_ERROR_MESSAGE = "We couldn't open this conversation right now\.";/);
  });

  it("the first-message wrapper collapses every error code into one of exactly three safe, generic buckets", () => {
    const messages = new Set(
      Array.from(firstMessageSource.matchAll(/:\s*"([^"]+)",/g)).map((match) => match[1]),
    );
    const allowed = new Set([
      "We couldn't open this conversation right now.",
      "You can't message this buyer right now.",
      "Please enter a message.",
      "Messages can be up to 4000 characters.",
      "Something went wrong. Please try again.",
    ]);
    for (const message of messages) {
      expect(allowed.has(message)).toBe(true);
    }
  });
});

describe("no unrelated schema/RPC changes -- existing messaging surface is untouched by this migration", () => {
  const source = readFile(MIGRATION_PATH);

  it("does not touch conversations, messages, conversation_user_states, or user_blocks tables directly (only reads/writes via the two new functions' own bodies, never DDL)", () => {
    expect(source).not.toMatch(/alter table public\.(conversations|messages|conversation_user_states|user_blocks)/i);
  });

  it("does not reference any table outside the established messaging/orders/shops/profiles/user_restrictions/user_blocks/notifications set", () => {
    const referencedTables = Array.from(source.matchAll(/public\.(\w+)/g)).map((match) => match[1]);
    const allowedTables = new Set([
      "conversations",
      "messages",
      "conversation_user_states",
      "user_blocks",
      "user_restrictions",
      "notifications",
      "orders",
      "shops",
      "profiles",
      "get_conversation_for_shop_order",
      "start_conversation_from_order",
    ]);
    for (const table of referencedTables) {
      expect(allowedTables.has(table)).toBe(true);
    }
  });
});
