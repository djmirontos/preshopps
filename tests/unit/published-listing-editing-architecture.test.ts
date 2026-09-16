import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("supabase/migrations/0094_published_listing_editing.sql", "utf8");
const code = migration.replace(/--.*$/gm, "");
const body = (name: string) => code.split(`create or replace function public.${name}(`)[1]?.split("\n$$;")[0];

// These are contract/regression checks, not evidence of transaction correctness.
// Actual SQL behavior and competing sessions run in tests/database/*.mjs.
describe("0094 published editing contracts", () => {
  it("leaves the migration transaction boundary to the Supabase executor", () => {
    expect(code.trimStart()).not.toMatch(/^begin;/i);
    expect(code.trimEnd()).not.toMatch(/commit;$/i);
  });

  it("uses the revision trigger for versioning while the seller RPC protects identity", () => {
    const trigger = body("guard_listing_revision")!;
    const save = body("update_published_listing")!;
    expect(trigger).not.toContain("new.category_id");
    expect(trigger).not.toContain("new.listing_type");
    expect(trigger).not.toContain("new.condition");
    expect(save).toContain("'category_id','listing_type','condition','status'");
    expect(save).toContain("PROTECTED_FIELD");
  });

  it("has additive revision and nullable historical snapshots, without inferred history", () => {
    expect(code).toMatch(/revision bigint not null default 0/);
    expect(code).toMatch(/listing_type_snapshot public\.listing_type_enum,/);
    expect(code).toMatch(/listing_condition_snapshot public\.listing_condition_enum;/);
    expect(code).not.toMatch(/update\s+public\.order_items/i);
    expect(code).not.toMatch(/create\s+table/i);
  });

  it("keeps draft writers and lifecycle routines isolated", () => {
    for (const name of ["update_listing", "replace_listing_images", "accept_order_items", "confirm_order_changes", "complete_order"]) {
      expect(body(name)).toBeUndefined();
    }
    expect(body("publish_listing")).toContain("public.validate_published_listing(p_listing_id, false)");
    expect(body("update_listing_status")).toContain("public.validate_published_listing(p_listing_id, false)");
  });

  it("keeps published save separate from status and reservation-row locking", () => {
    const save = body("update_published_listing")!;
    expect(save).toContain("p_expected_revision bigint");
    expect(save).toContain("security definer set search_path = ''");
    expect(save.match(/for update/gi)).toHaveLength(1);
    expect(save).not.toMatch(/set\s+status\s*=/i);
    expect(save).not.toMatch(/delete\s+from\s+storage\.objects/i);
    expect(save).toContain("LISTING_HAS_ACTIVE_RESERVATION");
    expect(save).toContain("STALE_LISTING_REVISION");
    expect(body("get_published_listing_edit_state")).toContain("v_listing.revision::text");
  });

  it("locks before term materialization and preserves the shared cart/Buy Now core signature", () => {
    const core = body("create_orders_from_selection")!;
    expect(core.indexOf("for update")).toBeLessThan(core.indexOf("insert into tmp_submit_items"));
    expect(core).toContain("order by (elem ->> 'listing_id')::uuid");
    expect(core).toContain("listing_type_snapshot, listing_condition_snapshot");
    expect(code).toContain("from public, anon, authenticated, service_role");
  });

  it("retains upload immutability and removes only listing Storage mutation policies", () => {
    const uploader = readFileSync("lib/image-processing/upload-image.ts", "utf8");
    expect(uploader).toContain("crypto.randomUUID()");
    expect(uploader).toContain("upsert: false");
    expect(code.match(/drop policy .* on storage\.objects;/g)).toEqual([
      "drop policy listing_images_update_own on storage.objects;",
      "drop policy listing_images_delete_own on storage.objects;",
    ]);
    expect(code).not.toMatch(/create\s+policy/i);
  });
});
