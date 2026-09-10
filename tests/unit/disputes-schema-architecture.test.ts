import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

function readFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf-8");
}

const MIGRATION_PATH = "supabase/migrations/0073_disputes_schema.sql";

describe("0073 disputes schema", () => {
  const source = readFile(MIGRATION_PATH);

  it("creates exactly four new tables: disputes, dispute_images, dispute_status_history, dispute_admin_notes", () => {
    expect(source).toMatch(/create table public\.disputes\b/);
    expect(source).toMatch(/create table public\.dispute_images\b/);
    expect(source).toMatch(/create table public\.dispute_status_history\b/);
    expect(source).toMatch(/create table public\.dispute_admin_notes\b/);
  });

  it("reuses the existing dispute_status_enum -- does not recreate it", () => {
    expect(source).not.toMatch(/create type public\.dispute_status_enum/);
    expect(source).toMatch(/status public\.dispute_status_enum not null default 'opened'/);
  });

  it("adds exactly two new notification_type_enum values: dispute_opened, dispute_resolved", () => {
    expect(source).toMatch(/alter type public\.notification_type_enum add value 'dispute_opened';/);
    expect(source).toMatch(/alter type public\.notification_type_enum add value 'dispute_resolved';/);
  });

  it("does not add a dispute_id column to notifications -- order_id is reused for deep-linking", () => {
    expect(source).not.toMatch(/alter table public\.notifications/);
  });

  it("disputes: opened_by/reason/explanation not null, resolved_by/resolved_at paired via a resolution-state check", () => {
    const table = source.slice(source.indexOf("create table public.disputes"), source.indexOf("create index disputes_order_id_idx"));
    expect(table).toMatch(/opened_by uuid not null references public\.profiles\(id\) on delete restrict/);
    expect(table).toMatch(/reason text not null/);
    expect(table).toMatch(/explanation text not null/);
    expect(table).toMatch(/disputes_resolution_state_check/);
    expect(table).toMatch(/status = 'resolved' and resolved_by is not null and resolved_at is not null/);
  });

  it("enforces at most one non-resolved dispute per order via a partial unique index", () => {
    expect(source).toMatch(/create unique index disputes_order_id_active_unique\s*\n\s*on public\.disputes\(order_id\)\s*\n\s*where status <> 'resolved';/);
  });

  it("dispute_images has no DB-level count constraint -- enforced by create_dispute (0074) instead", () => {
    const table = source.slice(source.indexOf("create table public.dispute_images"), source.indexOf("create index dispute_images_dispute_id_idx"));
    expect(table).not.toMatch(/check.*count|max.*3/i);
  });

  it("dispute_status_history and dispute_admin_notes are append-only -- no updated_at, no update trigger", () => {
    const historyTable = source.slice(
      source.indexOf("create table public.dispute_status_history"),
      source.indexOf("create index dispute_status_history_dispute_created_idx"),
    );
    const notesTable = source.slice(
      source.indexOf("create table public.dispute_admin_notes"),
      source.indexOf("create index dispute_admin_notes_dispute_created_idx"),
    );
    expect(historyTable).not.toMatch(/updated_at/);
    expect(notesTable).not.toMatch(/updated_at/);
    expect(source).not.toMatch(/create trigger/i);
  });

  it("adds no RLS policy on any of the four tables -- RPC-only access, matching reports/moderation_actions/support_tickets", () => {
    expect(source).not.toMatch(/create policy dispute(?!_images_)|create policy disputes_/);
  });

  it("can_view_dispute_evidence is SECURITY DEFINER, granted to authenticated only, never anon/public", () => {
    const body = source.slice(source.indexOf("create or replace function public.can_view_dispute_evidence"));
    expect(body).toMatch(/security definer/);
    expect(body).toMatch(/set search_path = ''/);
    expect(source).toMatch(/revoke all on function public\.can_view_dispute_evidence\(uuid\) from public/);
    expect(source).toMatch(/revoke all on function public\.can_view_dispute_evidence\(uuid\) from anon/);
    expect(source).toMatch(/grant execute on function public\.can_view_dispute_evidence\(uuid\) to authenticated/);
  });

  it("can_view_dispute_evidence returns true for admin or either order participant, false otherwise", () => {
    const body = source.slice(
      source.indexOf("create or replace function public.can_view_dispute_evidence"),
      source.indexOf("revoke all on function public.can_view_dispute_evidence"),
    );
    expect(body).toMatch(/if exists \(select 1 from public\.user_roles ur where ur\.user_id = v_caller\) then\s*\n\s*return true;/);
    expect(body).toMatch(/return v_caller = v_buyer_id or v_caller = v_shop_owner_id;/);
  });

  it("creates the dispute-images bucket as private (public = false)", () => {
    expect(source).toMatch(/insert into storage\.buckets \(id, name, public, file_size_limit, allowed_mime_types\)\s*\n\s*values \('dispute-images', 'dispute-images', false,/);
  });

  it("dispute-images insert/update/delete policies are owner-scoped, matching the other three buckets' convention", () => {
    expect(source).toMatch(/create policy dispute_images_insert_own[\s\S]*?\(storage\.foldername\(name\)\)\[1\] = auth\.uid\(\)::text/);
    expect(source).toMatch(/create policy dispute_images_update_own/);
    expect(source).toMatch(/create policy dispute_images_delete_own/);
  });

  it("dispute-images has no public select policy -- select requires uploader identity or the participant/admin helper", () => {
    expect(source).not.toMatch(/create policy dispute_images_select_public/);
    expect(source).toMatch(/create policy dispute_images_select_participants_or_admin/);
    expect(source).toMatch(/to authenticated\s*\nusing \(\s*\n\s*bucket_id = 'dispute-images'\s*\n\s*and \(\s*\n\s*\(storage\.foldername\(name\)\)\[1\] = auth\.uid\(\)::text\s*\n\s*or public\.can_view_dispute_evidence/);
  });

  it("never mentions escrow, refund, or payment arbitration -- PRD 34.5/46", () => {
    expect(source).not.toMatch(/escrow|refund|payment arbitration/i);
  });
});
