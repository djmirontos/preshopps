import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

function readFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf-8");
}

const MIGRATION_PATH = "supabase/migrations/0053_shop_reviews_rating_filter_and_sort.sql";

describe("0053 extends get_shop_reviews only -- no other Reviews behavior changes (PRD 26.8 scope)", () => {
  const source = readFile(MIGRATION_PATH);

  it("drops the old 4-parameter get_shop_reviews and recreates it under the same name (avoids a duplicate overload)", () => {
    expect(source).toMatch(/drop function if exists public\.get_shop_reviews\(uuid, integer, timestamptz, uuid\);/i);
    expect(source).toMatch(/create or replace function public\.get_shop_reviews\s*\(/i);
  });

  it("does not touch review write rules, schema, RLS, or moderation", () => {
    expect(source).not.toMatch(/create or replace function public\.create_review/i);
    expect(source).not.toMatch(/create or replace function public\.update_review/i);
    expect(source).not.toMatch(/create or replace function public\.upsert_review_reply/i);
    expect(source).not.toMatch(/create table|alter table|drop table/i);
    expect(source).not.toMatch(/create policy|alter policy|drop policy/i);
    expect(source).not.toMatch(/create type|alter type/i);
    expect(source).not.toMatch(/create trigger|drop trigger/i);
  });

  it("does not touch notifications or storage", () => {
    expect(source).not.toMatch(/insert into public\.notifications/i);
    expect(source).not.toMatch(/storage\.objects|storage\.buckets/i);
  });

  it("does not redefine get_shop_review_summary -- the overall rating header stays unfiltered", () => {
    expect(source).not.toMatch(/create or replace function public\.get_shop_review_summary/i);
  });
});

describe("0053 get_shop_reviews signature and defaults reproduce pre-existing behavior", () => {
  const source = readFile(MIGRATION_PATH);

  it("appends p_rating_filter, p_sort_mode, p_before_rating after the four original parameters, each with a default matching current behavior", () => {
    expect(source).toMatch(/p_shop_id uuid,\s*\n\s*p_limit integer default 20,\s*\n\s*p_before_created_at timestamptz default null,\s*\n\s*p_before_id uuid default null,\s*\n\s*p_rating_filter integer default null,\s*\n\s*p_sort_mode text default 'newest',\s*\n\s*p_before_rating smallint default null/);
  });

  it("RETURNS TABLE shape is unchanged from 0034/0047's own row shape", () => {
    for (const column of [
      "review_id uuid",
      "rating smallint",
      "body text",
      "created_at timestamptz",
      "updated_at timestamptz",
      "buyer_display_name text",
      "buyer_avatar_storage_path text",
      "reply_body text",
      "reply_created_at timestamptz",
      "reply_updated_at timestamptz",
      "image_paths text[]",
      "purchased_item_titles text[]",
    ]) {
      expect(source).toContain(column);
    }
  });
});

describe("0053 rating filter behavior", () => {
  const source = readFile(MIGRATION_PATH);

  it("filters to an exact rating match only when p_rating_filter is supplied -- null means All", () => {
    expect(source).toMatch(/\(p_rating_filter is null or r\.rating = p_rating_filter\)/);
  });

  it("rejects an out-of-range rating filter explicitly rather than silently returning zero rows", () => {
    expect(source).toMatch(/p_rating_filter is not null and \(p_rating_filter < 1 or p_rating_filter > 5\)/);
    expect(source).toMatch(/RATING_FILTER_INVALID/);
  });
});

describe("0053 sort mode behavior", () => {
  const source = readFile(MIGRATION_PATH);

  it("rejects any sort mode other than newest/highest_rating explicitly", () => {
    expect(source).toMatch(/p_sort_mode is null or p_sort_mode not in \('newest', 'highest_rating'\)/);
    expect(source).toMatch(/SORT_MODE_INVALID/);
  });

  it("newest mode keeps the original (created_at, id) DESC keyset predicate untouched", () => {
    expect(source).toMatch(/p_sort_mode = 'newest'[\s\S]{0,80}p_before_created_at is null[\s\S]{0,40}or \(r\.created_at, r\.id\) < \(p_before_created_at, p_before_id\)/);
  });

  it("highest_rating mode adds a (rating, created_at, id) DESC keyset predicate", () => {
    expect(source).toMatch(/p_sort_mode = 'highest_rating'[\s\S]{0,80}p_before_rating is null[\s\S]{0,60}or \(r\.rating, r\.created_at, r\.id\) < \(p_before_rating, p_before_created_at, p_before_id\)/);
  });

  it("orders by rating DESC first only in highest_rating mode, always breaking ties by created_at DESC then id DESC -- deterministic in both modes", () => {
    expect(source).toMatch(/order by\s*\n\s*case when p_sort_mode = 'highest_rating' then r\.rating end desc,\s*\n\s*r\.created_at desc,\s*\n\s*r\.id desc/);
  });

  it("reuses the existing reviews_shop_id_rating_created_at_id_idx index (0033) instead of adding a new one", () => {
    expect(source).not.toMatch(/create index/i);
    expect(source).toMatch(/reviews_shop_id_rating_created_at_id_idx/);
  });
});

describe("0053 cursor validation stays strict for both sort modes", () => {
  const source = readFile(MIGRATION_PATH);

  it("still rejects a created_at/id cursor supplied only partially, regardless of sort mode", () => {
    expect(source).toMatch(/\(p_before_created_at is null\) <> \(p_before_id is null\)/);
  });

  it("in highest_rating mode, requires the rating cursor to travel with created_at/id or not at all", () => {
    expect(source).toMatch(/p_sort_mode = 'highest_rating' and \(p_before_created_at is not null\) <> \(p_before_rating is not null\)/);
  });
});

describe("0053 preserves get_shop_reviews' existing privacy/security posture exactly", () => {
  const source = readFile(MIGRATION_PATH);

  it("is SECURITY DEFINER with an empty search_path, same as every other review RPC", () => {
    expect(source).toMatch(/security definer/i);
    expect(source).toMatch(/set search_path = ''/);
  });

  it("re-grants execute to anon and authenticated (guest-safe public read, unchanged) on the new 7-argument signature", () => {
    expect(source).toMatch(/revoke all on function public\.get_shop_reviews\(uuid, integer, timestamptz, uuid, integer, text, smallint\) from public/i);
    expect(source).toMatch(/grant execute on function public\.get_shop_reviews\(uuid, integer, timestamptz, uuid, integer, text, smallint\) to anon/i);
    expect(source).toMatch(/grant execute on function public\.get_shop_reviews\(uuid, integer, timestamptz, uuid, integer, text, smallint\) to authenticated/i);
  });

  it("still never selects/returns order_id or buyer_id", () => {
    const returnsBlock = source.slice(source.indexOf("returns table"), source.indexOf("language plpgsql"));
    expect(returnsBlock).not.toMatch(/\border_id\b/);
    expect(returnsBlock).not.toMatch(/\bbuyer_id\b/);
  });

  it("still validates the shop exists and the limit is between 1 and 50, unchanged from 0034", () => {
    expect(source).toMatch(/SHOP_NOT_FOUND/);
    expect(source).toMatch(/LIMIT_INVALID/);
  });
});
