import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

function readFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf-8");
}

const MIGRATION_PATH = "supabase/migrations/0079_fix_plpgsql_output_column_collisions.sql";

function getFunctionBody(source: string, anchor: string): string {
  const fnStart = source.indexOf(anchor);
  const bodyStart = source.indexOf("begin\n", fnStart);
  const bodyEnd = source.indexOf("end;\n$$;", bodyStart);
  return source.slice(bodyStart, bodyEnd);
}

const BOOTSTRAP_ANCHOR = "create or replace function public.bootstrap_first_super_admin(";
const SUPPORT_ANCHOR = "create or replace function public.submit_support_ticket(";
const DISPUTE_ANCHOR = "create or replace function public.create_dispute(";
const NOTE_ANCHOR = "create or replace function public.add_dispute_admin_note(";
const REVOKE_ANCHOR = "create or replace function public.revoke_admin_role(";

describe("0079 is scoped to exactly the five confirmed-collision functions, no other change", () => {
  const source = readFile(MIGRATION_PATH);

  it("creates exactly bootstrap_first_super_admin, submit_support_ticket, create_dispute, add_dispute_admin_note, revoke_admin_role", () => {
    const matches = (source.match(/create or replace function public\.\w+\(/g) ?? []).sort();
    expect(matches).toEqual(
      [
        "create or replace function public.add_dispute_admin_note(",
        "create or replace function public.bootstrap_first_super_admin(",
        "create or replace function public.create_dispute(",
        "create or replace function public.revoke_admin_role(",
        "create or replace function public.submit_support_ticket(",
      ].sort(),
    );
  });

  it("adds no table, enum, policy, or storage change of any kind", () => {
    expect(source).not.toMatch(/create table|create type|create policy|alter table|drop table|storage\.buckets/i);
  });

  it("never mentions escrow, refund, or payment arbitration", () => {
    expect(source).not.toMatch(/escrow|refund|payment arbitration/i);
  });
});

describe("0079: the five confirmed ambiguous references are gone", () => {
  const source = readFile(MIGRATION_PATH);

  it("bootstrap_first_super_admin: RETURNING is now qualified via the ur alias, not bare created_at", () => {
    const body = getFunctionBody(source, BOOTSTRAP_ANCHOR);
    expect(body).toMatch(/insert into public\.user_roles as ur \(user_id, role, granted_by\)/);
    expect(body).toMatch(/returning ur\.created_at into v_created_at;/);
    expect(body).not.toMatch(/returning created_at into/);
  });

  it("submit_support_ticket: RETURNING is now qualified via the st alias, not bare id/created_at", () => {
    const body = getFunctionBody(source, SUPPORT_ANCHOR);
    expect(body).toMatch(/insert into public\.support_tickets as st \(user_id, category, message\)/);
    expect(body).toMatch(/returning st\.id, st\.created_at into v_ticket_id, v_created_at;/);
    expect(body).not.toMatch(/returning id, created_at into/);
  });

  it("create_dispute: RETURNING is now qualified via the d alias, not bare id/created_at", () => {
    const body = getFunctionBody(source, DISPUTE_ANCHOR);
    expect(body).toMatch(/insert into public\.disputes as d \(order_id, opened_by, reason, explanation, created_at\)/);
    expect(body).toMatch(/returning d\.id, d\.created_at into v_dispute_id, v_created_at;/);
    expect(body).not.toMatch(/returning id, created_at into/);
  });

  it("add_dispute_admin_note: RETURNING is now qualified via the dan alias, not bare id/created_at", () => {
    const body = getFunctionBody(source, NOTE_ANCHOR);
    expect(body).toMatch(/insert into public\.dispute_admin_notes as dan \(dispute_id, admin_id, note\)/);
    expect(body).toMatch(/returning dan\.id, dan\.created_at into v_note_id, v_created_at;/);
    expect(body).not.toMatch(/returning id, created_at into/);
  });

  it("revoke_admin_role: DELETE WHERE is now qualified via the ur alias, not bare user_id", () => {
    const body = getFunctionBody(source, REVOKE_ANCHOR);
    expect(body).toMatch(/delete from public\.user_roles as ur where ur\.user_id = p_user_id;/);
    expect(body).not.toMatch(/delete from public\.user_roles where user_id = p_user_id;/);
  });

  it("no unqualified `returning id` or `returning created_at` or `returning id, created_at` remains anywhere in this file", () => {
    expect(source).not.toMatch(/returning id,? ?created_at? into/);
    expect(source).not.toMatch(/returning created_at into/);
  });
});

describe("0079: no RETURNS TABLE public column name changed for any of the five functions", () => {
  const source = readFile(MIGRATION_PATH);

  it("bootstrap_first_super_admin still returns (user_id, role, created_at)", () => {
    const signature = source.slice(source.indexOf(BOOTSTRAP_ANCHOR), source.indexOf("language plpgsql", source.indexOf(BOOTSTRAP_ANCHOR)));
    expect(signature).toMatch(/returns table \(\s*user_id uuid,\s*role public\.user_role_enum,\s*created_at timestamptz\s*\)/);
  });

  it("submit_support_ticket still returns (ticket_id, created_at)", () => {
    const signature = source.slice(source.indexOf(SUPPORT_ANCHOR), source.indexOf("language plpgsql", source.indexOf(SUPPORT_ANCHOR)));
    expect(signature).toMatch(/returns table \(\s*ticket_id uuid,\s*created_at timestamptz\s*\)/);
  });

  it("create_dispute still returns (dispute_id, created_at)", () => {
    const signature = source.slice(source.indexOf(DISPUTE_ANCHOR), source.indexOf("language plpgsql", source.indexOf(DISPUTE_ANCHOR)));
    expect(signature).toMatch(/returns table \(\s*dispute_id uuid,\s*created_at timestamptz\s*\)/);
  });

  it("add_dispute_admin_note still returns (note_id, created_at)", () => {
    const signature = source.slice(source.indexOf(NOTE_ANCHOR), source.indexOf("language plpgsql", source.indexOf(NOTE_ANCHOR)));
    expect(signature).toMatch(/returns table \(\s*note_id uuid,\s*created_at timestamptz\s*\)/);
  });

  it("revoke_admin_role still returns (user_id, previous_role)", () => {
    const signature = source.slice(source.indexOf(REVOKE_ANCHOR), source.indexOf("language plpgsql", source.indexOf(REVOKE_ANCHOR)));
    expect(signature).toMatch(/returns table \(\s*user_id uuid,\s*previous_role public\.user_role_enum\s*\)/);
  });

  it("no function's parameter signature changed from its live form", () => {
    expect(source).toMatch(/create or replace function public\.bootstrap_first_super_admin\(\s*p_user_id uuid\s*\)/);
    expect(source).toMatch(
      /create or replace function public\.submit_support_ticket\(\s*p_category public\.support_ticket_category_enum,\s*p_message text\s*\)/,
    );
    expect(source).toMatch(
      /create or replace function public\.create_dispute\(\s*p_order_id uuid,\s*p_reason text,\s*p_explanation text,\s*p_image_paths text\[\] default '\{\}'::text\[\]\s*\)/,
    );
    expect(source).toMatch(/create or replace function public\.add_dispute_admin_note\(\s*p_dispute_id uuid,\s*p_note text\s*\)/);
    expect(source).toMatch(
      /create or replace function public\.revoke_admin_role\(\s*p_user_id uuid,\s*p_reason text default null\s*\)/,
    );
  });
});

describe("0079: create_dispute still contains all 0076 image-path hardening, unchanged", () => {
  const source = readFile(MIGRATION_PATH);
  const body = getFunctionBody(source, DISPUTE_ANCHOR);

  it("still caps images at 3 (TOO_MANY_DISPUTE_IMAGES)", () => {
    expect(body).toMatch(/if v_image_count > 3 then/);
    expect(body).toMatch(/'TOO_MANY_DISPUTE_IMAGES'/);
  });

  it("still builds the exact caller/order prefix from auth.uid() and p_order_id", () => {
    expect(body).toMatch(
      /v_expected_prefix := 'dispute-images\/' \|\| v_caller::text \|\| '\/' \|\| p_order_id::text \|\| '\/';/,
    );
  });

  it("still rejects any path not matching the exact prefix, and a prefix-only path with no remainder", () => {
    expect(body).toMatch(/if left\(v_path, char_length\(v_expected_prefix\)\) <> v_expected_prefix then/);
    expect(body).toMatch(/if char_length\(v_path\) <= char_length\(v_expected_prefix\) then/);
  });

  it("still rejects duplicate paths with DUPLICATE_DISPUTE_IMAGE_PATH", () => {
    expect(body).toMatch(/if \(select count\(distinct u\) from unnest\(p_image_paths\) as u\) <> v_image_count then/);
    expect(body).toMatch(/'DUPLICATE_DISPUTE_IMAGE_PATH'/);
  });

  it("still never adds a storage.objects existence check", () => {
    const codeOnly = source
      .split("\n")
      .map((line) => line.replace(/--.*$/, ""))
      .join("\n");
    expect(codeOnly).not.toMatch(/storage\.objects/);
  });
});

describe("0079: each fixed function's behavior is otherwise byte-identical (comments may be reworded, code may not)", () => {
  function stripSqlComments(sql: string): string {
    return sql
      .split("\n")
      .map((line) => line.replace(/--.*$/, ""))
      .join("\n");
  }

  it("bootstrap_first_super_admin preserves single-use (empty user_roles) precondition and TARGET_USER_NOT_FOUND check", () => {
    const source = readFile(MIGRATION_PATH);
    const body = getFunctionBody(source, BOOTSTRAP_ANCHOR);
    expect(body).toMatch(/if exists \(select 1 from public\.user_roles\) then/);
    expect(body).toMatch(/'BOOTSTRAP_ALREADY_USED'/);
    expect(body).toMatch(/if not exists \(select 1 from public\.profiles p where p\.id = p_user_id and p\.deleted_at is null\) then/);
    expect(body).toMatch(/'TARGET_USER_NOT_FOUND'/);
    expect(body).toMatch(/values \(p_user_id, 'super_admin', null\)/);
    expect(body).toMatch(
      /insert into public\.admin_audit_logs \(actor_id, target_user_id, action, previous_role, new_role, reason\)\s*\n\s*values \(null, p_user_id, 'admin_role_granted', null, 'super_admin', 'Bootstrap: first super_admin'\);/,
    );
  });

  it("submit_support_ticket preserves auth, deleted-account, and message-length validation", () => {
    const source = readFile(MIGRATION_PATH);
    const body = getFunctionBody(source, SUPPORT_ANCHOR);
    expect(body).toMatch(/'NOT_AUTHENTICATED'/);
    expect(body).toMatch(/'INTERACTION_BLOCKED'/);
    expect(body).toMatch(/'MESSAGE_REQUIRED'/);
    expect(body).toMatch(/'MESSAGE_TOO_LONG'/);
    expect(body).toMatch(/char_length\(v_message\) > 2000/);
  });

  it("add_dispute_admin_note preserves admin-auth, dispute-exists, and note-length validation", () => {
    const source = readFile(MIGRATION_PATH);
    const body = getFunctionBody(source, NOTE_ANCHOR);
    expect(body).toMatch(/if not exists \(select 1 from public\.user_roles ur where ur\.user_id = v_caller\) then/);
    expect(body).toMatch(/'NOT_ADMIN'/);
    expect(body).toMatch(/'DISPUTE_NOT_FOUND'/);
    expect(body).toMatch(/'NOTE_REQUIRED'/);
    expect(body).toMatch(/'NOTE_TOO_LONG'/);
  });

  it("revoke_admin_role preserves super_admin auth, TARGET_HAS_NO_ROLE, and last-super-admin lockout logic", () => {
    const source = readFile(MIGRATION_PATH);
    const body = getFunctionBody(source, REVOKE_ANCHOR);
    expect(body).toMatch(/if not exists \(select 1 from public\.user_roles ur where ur\.user_id = v_caller and ur\.role = 'super_admin'\) then/);
    expect(body).toMatch(/'NOT_SUPER_ADMIN'/);
    expect(body).toMatch(/'TARGET_HAS_NO_ROLE'/);
    expect(body).toMatch(/if v_previous_role = 'super_admin' then/);
    expect(body).toMatch(/perform 1 from public\.user_roles ur where ur\.role = 'super_admin' for update;/);
    expect(body).toMatch(/where ur\.role = 'super_admin' and ur\.user_id <> p_user_id/);
    expect(body).toMatch(/'LAST_SUPER_ADMIN'/);
    expect(body).toMatch(
      /insert into public\.admin_audit_logs \(actor_id, target_user_id, action, previous_role, new_role, reason\)\s*\n\s*values \(v_caller, p_user_id, 'admin_role_revoked', v_previous_role, null, v_reason\);/,
    );
  });

  it("all five preserve SECURITY DEFINER, empty search_path, and their existing grants", () => {
    const source = readFile(MIGRATION_PATH);

    for (const anchor of [BOOTSTRAP_ANCHOR, SUPPORT_ANCHOR, DISPUTE_ANCHOR, NOTE_ANCHOR, REVOKE_ANCHOR]) {
      const fnStart = source.indexOf(anchor);
      const fnHeader = source.slice(fnStart, source.indexOf("as $$", fnStart));
      expect(fnHeader).toMatch(/language plpgsql/);
      expect(fnHeader).toMatch(/security definer/);
      expect(fnHeader).toMatch(/set search_path = ''/);
    }

    expect(source).toMatch(/grant execute on function public\.bootstrap_first_super_admin\(uuid\) to service_role;/);
    expect(source).not.toMatch(/grant execute on function public\.bootstrap_first_super_admin\(uuid\) to authenticated;/);
    expect(source).toMatch(/grant execute on function public\.submit_support_ticket\(public\.support_ticket_category_enum, text\) to authenticated;/);
    expect(source).toMatch(/grant execute on function public\.create_dispute\(uuid, text, text, text\[\]\) to authenticated;/);
    expect(source).toMatch(/grant execute on function public\.add_dispute_admin_note\(uuid, text\) to authenticated;/);
    expect(source).toMatch(/grant execute on function public\.revoke_admin_role\(uuid, text\) to authenticated;/);
  });

  it("every statement outside the single fixed line in each function is functionally unchanged from its prior migration", () => {
    const newSource = readFile(MIGRATION_PATH);

    const priorSources: Record<string, { path: string; anchor: string; offending: string }> = {
      bootstrap: { path: "supabase/migrations/0077_admin_role_management_schema.sql", anchor: BOOTSTRAP_ANCHOR, offending: "returning created_at into v_created_at;" },
      support: { path: "supabase/migrations/0069_support_tickets.sql", anchor: SUPPORT_ANCHOR, offending: "returning id, created_at into v_ticket_id, v_created_at;" },
      dispute: { path: "supabase/migrations/0076_harden_dispute_image_paths.sql", anchor: DISPUTE_ANCHOR, offending: "returning id, created_at into v_dispute_id, v_created_at;" },
      note: { path: "supabase/migrations/0075_admin_dispute_rpcs.sql", anchor: NOTE_ANCHOR, offending: "returning id, created_at into v_note_id, v_created_at;" },
      revoke: { path: "supabase/migrations/0078_admin_role_management_rpcs.sql", anchor: REVOKE_ANCHOR, offending: "delete from public.user_roles where user_id = p_user_id;" },
    };

    const fixedLines: Record<string, string> = {
      bootstrap: "returning ur.created_at into v_created_at;",
      support: "returning st.id, st.created_at into v_ticket_id, v_created_at;",
      dispute: "returning d.id, d.created_at into v_dispute_id, v_created_at;",
      note: "returning dan.id, dan.created_at into v_note_id, v_created_at;",
      revoke: "delete from public.user_roles as ur where ur.user_id = p_user_id;",
    };

    const insertPrefixFixes: Record<string, [string, string]> = {
      bootstrap: ["insert into public.user_roles (user_id, role, granted_by)", "insert into public.user_roles as ur (user_id, role, granted_by)"],
      support: ["insert into public.support_tickets (user_id, category, message)", "insert into public.support_tickets as st (user_id, category, message)"],
      dispute: ["insert into public.disputes (order_id, opened_by, reason, explanation, created_at)", "insert into public.disputes as d (order_id, opened_by, reason, explanation, created_at)"],
      note: ["insert into public.dispute_admin_notes (dispute_id, admin_id, note)", "insert into public.dispute_admin_notes as dan (dispute_id, admin_id, note)"],
      revoke: ["", ""],
    };

    for (const key of Object.keys(priorSources)) {
      const { path: priorPath, anchor, offending } = priorSources[key];
      const priorSource = readFile(priorPath);
      const priorBody = getFunctionBody(priorSource, anchor);
      const newBody = getFunctionBody(newSource, anchor);

      const priorNormalized = stripSqlComments(priorBody).replace(/\s+/g, " ").trim();
      const newNormalized = stripSqlComments(newBody).replace(/\s+/g, " ").trim();

      const [oldInsert, newInsert] = insertPrefixFixes[key];
      let priorAdjusted = priorNormalized.replace(offending.replace(/\s+/g, " ").trim(), fixedLines[key]);
      if (oldInsert) {
        priorAdjusted = priorAdjusted.replace(oldInsert, newInsert);
      }

      expect(newNormalized).toBe(priorAdjusted);
    }
  });
});
