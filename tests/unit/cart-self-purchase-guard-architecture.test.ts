import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

function readFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf-8");
}

const LATEST_MIGRATION_PATH = "supabase/migrations/0038_fix_cart_item_upsert_ambiguity.sql";
const MIGRATIONS_DIR = "supabase/migrations";

/** The function body only. */
function getFunctionBody(source: string): string {
  const start = source.indexOf("create or replace function public.set_cart_item_quantity");
  const end = source.indexOf("$$;", start) + "$$;".length;
  return source.slice(start, end);
}

/**
 * This task ("self-purchase / own-listing Add to Cart UX") found the
 * backend guard already correct -- set_cart_item_quantity (0037, restated
 * unrelatedly by 0038's ON CONFLICT ambiguity fix) already raises
 * CANNOT_BUY_OWN_LISTING before ever inserting a cart_items row. The real
 * bug was purely client-side: ListingActions.tsx rendered an active Add to
 * Cart button even for the listing's own owner. This file locks in that
 * the backend guard remains intact and independent of the UI fix -- "do
 * not rely only on frontend hiding" per the task's own instruction.
 */
describe("set_cart_item_quantity already blocks self-purchase server-side", () => {
  const source = readFile(LATEST_MIGRATION_PATH);
  const body = getFunctionBody(source);

  it("0038 is confirmed the latest CREATE OR REPLACE for set_cart_item_quantity -- no migration after it redefines this function", () => {
    const latestBasename = path.basename(LATEST_MIGRATION_PATH);
    const files = readdirSync(path.join(process.cwd(), MIGRATIONS_DIR)).filter(
      (f) => f.endsWith(".sql") && f > latestBasename,
    );

    for (const file of files) {
      const laterSource = readFile(path.join(MIGRATIONS_DIR, file));
      expect(laterSource).not.toMatch(/create or replace function public\.set_cart_item_quantity/i);
    }
  });

  it("resolves the listing's shop owner id (v_shop_owner_id) before any cart write", () => {
    expect(body).toMatch(/select\s+s\.owner_id,/);
  });

  it("raises CANNOT_BUY_OWN_LISTING when the caller is the shop's own owner", () => {
    expect(body).toMatch(/if v_shop_owner_id = v_caller_id then\s*\n\s*raise exception '[^']*' using detail = 'CANNOT_BUY_OWN_LISTING';\s*\n\s*end if;/);
  });

  it("runs the self-purchase check BEFORE inserting/upserting into cart_items -- a direct RPC call can never sneak a row in first", () => {
    const guardIndex = body.indexOf("CANNOT_BUY_OWN_LISTING");
    const insertIndex = body.indexOf("insert into public.cart_items");
    expect(guardIndex).toBeGreaterThan(0);
    expect(insertIndex).toBeGreaterThan(guardIndex);
  });

  it("the guard compares the resolved listing owner against auth.uid(), never a client-supplied id", () => {
    expect(body).toMatch(/v_caller_id := auth\.uid\(\);/);
    expect(body).not.toMatch(/\bp_user_id\b|\bp_owner_id\b|\bp_caller_id\b/);
  });

  it("still requires authentication independently of the self-purchase guard (NOT_AUTHENTICATED)", () => {
    expect(body).toMatch(/'Authentication required\.' using detail = 'NOT_AUTHENTICATED'/);
  });

  it("remains SECURITY DEFINER with an empty search_path, granted to authenticated only", () => {
    expect(source).toMatch(/security definer/i);
    expect(source).toMatch(/set search_path = ''/);
    expect(source).toMatch(/grant execute on function public\.set_cart_item_quantity\(uuid, integer\) to authenticated/i);
    expect(source).not.toMatch(/grant execute on function public\.set_cart_item_quantity\(uuid, integer\) to anon/i);
  });
});
