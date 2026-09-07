import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

function readFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf-8");
}

const MIGRATION = "supabase/migrations/0044_confirm_order_received_auto_complete.sql";

describe("0044_confirm_order_received_auto_complete closes the received_confirmed -> completed gap", () => {
  it("modifies exactly confirm_order_received -- no other function body is redefined", () => {
    const source = readFile(MIGRATION);
    expect(source).toMatch(/create or replace function public\.confirm_order_received/i);
    expect(source).not.toMatch(/create or replace function public\.complete_order/i);
    expect(source).not.toMatch(/create or replace function public\.mark_order_ready/i);
    expect(source).not.toMatch(/create or replace function public\.mark_order_handed_over_or_shipped/i);
    expect(source).not.toMatch(/create or replace function public\.accept_order_items/i);
  });

  it("introduces no new table, enum, index, trigger, or RLS policy", () => {
    const source = readFile(MIGRATION);
    expect(source).not.toMatch(/create table|alter table|drop table/i);
    expect(source).not.toMatch(/create type|alter type/i);
    expect(source).not.toMatch(/create policy|drop policy|alter policy/i);
    expect(source).not.toMatch(/create index|create trigger/i);
  });

  it("does not change complete_order's grants -- it stays service_role-only, never authenticated", () => {
    const source = readFile(MIGRATION);
    expect(source).not.toMatch(/grant execute on function public\.complete_order/i);
    expect(source).not.toMatch(/revoke all on function public\.complete_order/i);
  });

  it("keeps confirm_order_received's own grants unchanged: revoked from public/anon, granted to authenticated only", () => {
    const source = readFile(MIGRATION);
    expect(source).toMatch(/revoke all on function public\.confirm_order_received\(uuid\) from public/i);
    expect(source).toMatch(/revoke all on function public\.confirm_order_received\(uuid\) from anon/i);
    expect(source).toMatch(/grant execute on function public\.confirm_order_received\(uuid\) to authenticated/i);
    expect(source).not.toMatch(/grant execute on function public\.confirm_order_received\(uuid\) to service_role/i);
  });

  it("calls complete_order internally from inside confirm_order_received, guarded by an exception block", () => {
    const source = readFile(MIGRATION);
    expect(source).toMatch(/perform public\.complete_order\(p_order_id\)/);
    expect(source).toMatch(/exception\s+when others then/i);
  });

  it("still authenticates and authorizes the caller as the order's own buyer before any mutation", () => {
    const source = readFile(MIGRATION);
    expect(source).toMatch(/auth\.uid\(\)/);
    expect(source).toMatch(/NOT_AUTHENTICATED/);
    expect(source).toMatch(/NOT_ORDER_BUYER/);
  });

  it("still gates the fresh transition on handed_over_or_shipped -- buyer confirmation remains a required precondition", () => {
    const source = readFile(MIGRATION);
    expect(source).toMatch(/v_order_status\s*<>\s*'handed_over_or_shipped'/);
    expect(source).toMatch(/ORDER_NOT_RECEIVABLE/);
  });
});
