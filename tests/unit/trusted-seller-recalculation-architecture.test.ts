import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

function readFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf-8");
}

const MIGRATION_PATH = "supabase/migrations/0065_trusted_seller_recalculation.sql";

function getFunctionBody(source: string, fnName: string, signatureOpen = "("): string {
  const start = source.indexOf(`create or replace function public.${fnName}${signatureOpen}`);
  const bodyStart = source.indexOf("begin\n", start);
  const bodyEnd = source.indexOf("end;\n$$;", bodyStart);
  return source.slice(bodyStart, bodyEnd);
}

describe("0065 is scoped to Trusted Seller recalculation only", () => {
  const source = readFile(MIGRATION_PATH);

  it("creates exactly two new functions -- no schema/enum/column/policy change", () => {
    expect(source).toMatch(/create or replace function public\.recalculate_trusted_seller\s*\(/);
    expect(source).toMatch(/create or replace function public\.recalculate_all_trusted_sellers\s*\(/);
    expect(source).not.toMatch(/create table|alter table|drop table/i);
    expect(source).not.toMatch(/create type|alter type/i);
    expect(source).not.toMatch(/create policy|alter policy|drop policy|create index|drop index/i);
  });

  it("touches exactly three existing functions (complete_order, create_review, update_review) -- no other RPC", () => {
    expect(source).toMatch(/create or replace function public\.complete_order\(/);
    expect(source).toMatch(/create or replace function public\.create_review\(/);
    expect(source).toMatch(/create or replace function public\.update_review\(/);
    expect(source).not.toMatch(/create or replace function public\.publish_listing/i);
    expect(source).not.toMatch(/create or replace function public\.update_listing_status/i);
    expect(source).not.toMatch(/create or replace function public\.accept_order_items/i);
    expect(source).not.toMatch(/create or replace function public\.cancel_accepted_order/i);
    expect(source).not.toMatch(/create or replace function public\.resolve_order_cancellation/i);
    expect(source).not.toMatch(/create or replace function public\.upsert_review_reply/i);
    expect(source).not.toMatch(/create or replace function public\.create_shop/i);
    expect(source).not.toMatch(/create or replace function public\.update_shop/i);
  });

  it("recalculate_trusted_seller and recalculate_all_trusted_sellers are never callable by public/anon/authenticated -- service_role only", () => {
    expect(source).toMatch(/revoke all on function public\.recalculate_trusted_seller\(uuid\) from public/i);
    expect(source).toMatch(/revoke all on function public\.recalculate_trusted_seller\(uuid\) from anon/i);
    expect(source).toMatch(/revoke all on function public\.recalculate_trusted_seller\(uuid\) from authenticated/i);
    expect(source).toMatch(/grant execute on function public\.recalculate_trusted_seller\(uuid\) to service_role/i);

    expect(source).toMatch(/revoke all on function public\.recalculate_all_trusted_sellers\(\) from public/i);
    expect(source).toMatch(/revoke all on function public\.recalculate_all_trusted_sellers\(\) from anon/i);
    expect(source).toMatch(/revoke all on function public\.recalculate_all_trusted_sellers\(\) from authenticated/i);
    expect(source).toMatch(/grant execute on function public\.recalculate_all_trusted_sellers\(\) to service_role/i);
  });

  it("never grants either new function to authenticated or anon anywhere in the file", () => {
    expect(source).not.toMatch(/grant execute on function public\.recalculate_trusted_seller\(uuid\) to authenticated/i);
    expect(source).not.toMatch(/grant execute on function public\.recalculate_trusted_seller\(uuid\) to anon/i);
    expect(source).not.toMatch(/grant execute on function public\.recalculate_all_trusted_sellers\(\) to authenticated/i);
    expect(source).not.toMatch(/grant execute on function public\.recalculate_all_trusted_sellers\(\) to anon/i);
  });

  it("re-states the pre-existing grants for complete_order (service_role), create_review and update_review (authenticated)", () => {
    expect(source).toMatch(/grant execute on function public\.complete_order\(uuid\) to service_role/i);
    expect(source).not.toMatch(/grant execute on function public\.complete_order\(uuid\) to authenticated/i);
    expect(source).toMatch(/grant execute on function public\.create_review\(uuid, integer, text, text\[\]\) to authenticated/i);
    expect(source).toMatch(/grant execute on function public\.update_review\(uuid, integer, text, text\[\]\) to authenticated/i);
  });

  it("recalculate_trusted_seller accepts only an opaque shop id -- no client-supplied count/rating/boolean", () => {
    const signature = source.slice(
      source.indexOf("create or replace function public.recalculate_trusted_seller("),
      source.indexOf("returns table", source.indexOf("create or replace function public.recalculate_trusted_seller(")),
    );
    expect(signature).toMatch(/p_shop_id uuid/);
    expect(signature).not.toMatch(/p_is_trusted|p_rating|p_count|p_email/);
  });

  it("ends with exactly one backfill invocation of recalculate_all_trusted_sellers", () => {
    const matches = source.match(/select public\.recalculate_all_trusted_sellers\(\);/g) ?? [];
    expect(matches).toHaveLength(1);
  });
});

describe("0065 recalculate_trusted_seller -- exact canonical criteria (PRD 27.2)", () => {
  const source = readFile(MIGRATION_PATH);
  const body = getFunctionBody(source, "recalculate_trusted_seller");

  it("locks the shop row FOR UPDATE as the universal serialization point", () => {
    expect(body).toMatch(/from public\.shops s\s*\n\s*where s\.id = p_shop_id\s*\n\s*for update;/);
    expect(body).toMatch(/'Shop not found\.' using detail = 'SHOP_NOT_FOUND'/);
  });

  it("checks verified email via auth.users.email_confirmed_at for the shop owner", () => {
    expect(body).toMatch(/select u\.email_confirmed_at into v_email_confirmed_at\s*\n\s*from auth\.users u\s*\n\s*where u\.id = v_owner_id;/);
  });

  it("requires at least 5 completed orders for this shop", () => {
    expect(body).toMatch(/from public\.orders o\s*\n\s*where o\.shop_id = p_shop_id\s*\n\s*and o\.status = 'completed';/);
    expect(body).toMatch(/v_completed_order_count >= 5/);
  });

  it("requires at least 3 reviews (no separate 'verified' flag -- every review is already order-gated)", () => {
    expect(body).toMatch(/from public\.reviews r\s*\n\s*where r\.shop_id = p_shop_id;/);
    expect(body).toMatch(/v_review_count >= 3/);
  });

  it("requires an average rating of at least 4.0, coalesced to 0 for zero reviews", () => {
    expect(body).toMatch(/avg\(r\.rating\)/);
    expect(body).toMatch(/coalesce\(v_average_rating, 0\) >= 4\.0/);
  });

  it("requires no active seller_suspended/account_suspended restriction (not buyer_restricted alone)", () => {
    expect(body).toMatch(/restriction_type in \('seller_suspended', 'account_suspended'\)/);
    expect(body).not.toMatch(/'buyer_restricted'/);
    expect(body).toMatch(/and not v_has_active_restriction;/);
  });

  it("combines all five criteria with AND -- every one is required, none is sufficient alone", () => {
    const eligibleBlock = body.slice(body.indexOf("v_eligible :="), body.indexOf("v_now := now();"));
    expect(eligibleBlock).toMatch(/v_email_confirmed_at is not null/);
    expect(eligibleBlock).toMatch(/and v_completed_order_count >= 5/);
    expect(eligibleBlock).toMatch(/and v_review_count >= 3/);
    expect(eligibleBlock).toMatch(/and coalesce\(v_average_rating, 0\) >= 4\.0/);
    expect(eligibleBlock).toMatch(/and not v_has_active_restriction/);
  });

  it("always writes both is_trusted_seller and trusted_seller_calculated_at, in both directions (true and false)", () => {
    expect(body).toMatch(/set is_trusted_seller = v_eligible,\s*\n\s*trusted_seller_calculated_at = v_now/);
    expect(body).not.toMatch(/if v_eligible then[\s\S]*update public\.shops/);
  });

  it("never references orders/reviews for any shop other than p_shop_id", () => {
    expect(body).not.toMatch(/o\.shop_id\s*<>/);
    expect(body).not.toMatch(/o\.shop_id\s*!=/);
  });
});

describe("0065 recalculate_all_trusted_sellers -- the backfill/recalculate-all path", () => {
  const source = readFile(MIGRATION_PATH);
  const body = getFunctionBody(source, "recalculate_all_trusted_sellers", "(");

  it("loops over every shop and calls recalculate_trusted_seller once per shop", () => {
    expect(body).toMatch(/for v_shop_id in select s\.id from public\.shops s order by s\.id loop/);
    expect(body).toMatch(/perform public\.recalculate_trusted_seller\(v_shop_id\);/);
  });

  it("returns the number of shops processed", () => {
    expect(body).toMatch(/return v_count;/);
  });
});

describe("0065 invocation points -- complete_order, create_review, update_review", () => {
  const source = readFile(MIGRATION_PATH);

  it("complete_order recalculates the order's shop, after the order's own completion update and before the history/notification inserts", () => {
    const body = getFunctionBody(source, "complete_order");
    const orderUpdateIndex = body.indexOf("set status = 'completed'");
    const recalcIndex = body.indexOf("perform public.recalculate_trusted_seller(v_order_shop_id);");
    const historyIndex = body.indexOf("insert into public.order_status_history");
    expect(orderUpdateIndex).toBeGreaterThan(-1);
    expect(recalcIndex).toBeGreaterThan(orderUpdateIndex);
    expect(historyIndex).toBeGreaterThan(recalcIndex);
  });

  it("create_review recalculates the order's shop, after the review insert and before the notification insert", () => {
    const body = getFunctionBody(source, "create_review", "(p_order_id");
    const reviewInsertIndex = body.indexOf("insert into public.reviews as r");
    const recalcIndex = body.indexOf("perform public.recalculate_trusted_seller(v_order_shop_id);");
    const notificationIndex = body.indexOf("insert into public.notifications");
    expect(reviewInsertIndex).toBeGreaterThan(-1);
    expect(recalcIndex).toBeGreaterThan(reviewInsertIndex);
    expect(notificationIndex).toBeGreaterThan(recalcIndex);
  });

  it("update_review selects the review's shop_id and recalculates that shop after the rating update", () => {
    const body = getFunctionBody(source, "update_review", "(\n");
    expect(body).toMatch(/select r\.buyer_id, r\.created_at, r\.shop_id\s*\n\s*into v_review_buyer_id, v_review_created_at, v_review_shop_id/);
    const updateIndex = body.indexOf("set rating = p_rating");
    const recalcIndex = body.indexOf("perform public.recalculate_trusted_seller(v_review_shop_id);");
    expect(updateIndex).toBeGreaterThan(-1);
    expect(recalcIndex).toBeGreaterThan(updateIndex);
  });

  it("no order-lifecycle function other than complete_order ever calls recalculate_trusted_seller in this migration", () => {
    const codeOnly = source
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");
    const matches = codeOnly.match(/perform public\.recalculate_trusted_seller\(/g) ?? [];
    // exactly 4 real call sites in executable code: the bulk loop inside
    // recalculate_all_trusted_sellers, plus complete_order, create_review,
    // and update_review each calling it once.
    expect(matches).toHaveLength(4);
  });
});

describe("0065 preserves every existing behavior of complete_order/create_review/update_review verbatim", () => {
  const source = readFile(MIGRATION_PATH);

  it("complete_order keeps its full reservation/listing-status/stock logic unchanged", () => {
    const body = getFunctionBody(source, "complete_order");
    expect(body).toMatch(/'ORDER_NOT_COMPLETABLE'/);
    expect(body).toMatch(/'RESERVATION_STATE_INVALID'/);
    expect(body).toMatch(/when v_listing_status = 'reserved' and not v_other_active_exists/);
    expect(body).toMatch(/status = 'consumed'/);
  });

  it("create_review keeps its full eligibility/validation logic unchanged", () => {
    const body = getFunctionBody(source, "create_review", "(p_order_id");
    expect(body).toMatch(/'ORDER_NOT_REVIEWABLE'/);
    expect(body).toMatch(/'REVIEW_ALREADY_EXISTS'/);
    expect(body).toMatch(/'RATING_INVALID'/);
    expect(body).toMatch(/'TOO_MANY_REVIEW_IMAGES'/);
  });

  it("update_review keeps its 7-day edit window and validation logic unchanged", () => {
    const body = getFunctionBody(source, "update_review", "(\n");
    expect(body).toMatch(/interval '7 days'/);
    expect(body).toMatch(/'REVIEW_EDIT_WINDOW_CLOSED'/);
    expect(body).toMatch(/'NOT_REVIEW_AUTHOR'/);
  });
});
