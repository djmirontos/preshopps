// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

// process-email-outbox.ts's default sendEmail parameter transitively
// imports resend-client.ts, which has `import "server-only"` at its top --
// same reason supabase-server.test.ts mocks this module away.
vi.mock("server-only", () => ({}));

vi.mock("@/lib/env", () => ({
  getAppUrl: () => "https://preshopps.test",
}));

import { processEmailOutbox } from "@/lib/email/process-email-outbox";

type RpcResult = { data: unknown; error: { message: string } | null };

function makeSupabase(claimResult: RpcResult) {
  const rpc = vi.fn(async (fn: string): Promise<RpcResult> => {
    if (fn === "claim_pending_emails") return claimResult;
    if (fn === "mark_email_sent") return { data: null, error: null };
    if (fn === "mark_email_failed") return { data: null, error: null };
    throw new Error(`unexpected rpc call: ${fn}`);
  });
  return { rpc };
}

const configured = () => true;

describe("processEmailOutbox -- provider-configured happy paths", () => {
  it("claims rows, renders + sends each, and marks sent on provider success", async () => {
    const rows = [
      {
        id: "e1",
        event_type: "order_accepted",
        entity_id: "o1",
        recipient_user_id: "u1",
        recipient_email: "buyer@example.com",
        payload: { order_public_code: "PSO-1" },
        attempt_count: 1,
      },
    ];
    const supabase = makeSupabase({ data: rows, error: null });
    const sendEmail = vi.fn(async () => ({ ok: true as const }));

    const result = await processEmailOutbox({ supabase, sendEmail, isProviderConfigured: configured });

    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "buyer@example.com", subject: expect.stringContaining("PSO-1") }),
    );
    expect(supabase.rpc).toHaveBeenCalledWith("mark_email_sent", { p_id: "e1" });
    expect(supabase.rpc).not.toHaveBeenCalledWith("mark_email_failed", expect.anything());
    expect(result).toEqual({ claimed: 1, sent: 1, failed: 0, providerConfigured: true });
  });

  it("processes multiple claimed rows independently (one failure does not affect another row)", async () => {
    const rows = [
      { id: "e1", event_type: "order_accepted", entity_id: "o1", recipient_user_id: "u1", recipient_email: "a@example.com", payload: {}, attempt_count: 1 },
      { id: "e2", event_type: "order_declined", entity_id: "o2", recipient_user_id: "u2", recipient_email: "b@example.com", payload: {}, attempt_count: 1 },
    ];
    const supabase = makeSupabase({ data: rows, error: null });
    const sendEmail = vi
      .fn()
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, reason: "provider_error", error: "boom" });

    const result = await processEmailOutbox({ supabase, sendEmail, isProviderConfigured: configured });
    expect(result).toEqual({ claimed: 2, sent: 1, failed: 1, providerConfigured: true });
  });

  it("returns zero counts and never calls sendEmail when nothing is claimed", async () => {
    const supabase = makeSupabase({ data: [], error: null });
    const sendEmail = vi.fn();
    const result = await processEmailOutbox({ supabase, sendEmail, isProviderConfigured: configured });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(result).toEqual({ claimed: 0, sent: 0, failed: 0, providerConfigured: true });
  });

  it("throws when claim_pending_emails itself errors, never silently swallowing the error", async () => {
    const supabase = makeSupabase({ data: null, error: { message: "db down" } });
    await expect(
      processEmailOutbox({ supabase, sendEmail: vi.fn(), isProviderConfigured: configured }),
    ).rejects.toThrow("db down");
  });

  it("passes the configured limit through to claim_pending_emails", async () => {
    const supabase = makeSupabase({ data: [], error: null });
    await processEmailOutbox({ supabase, sendEmail: vi.fn(), isProviderConfigured: configured, limit: 5 });
    expect(supabase.rpc).toHaveBeenCalledWith("claim_pending_emails", { p_limit: 5 });
  });

  it("defaults to a limit of 20 when none is given", async () => {
    const supabase = makeSupabase({ data: [], error: null });
    await processEmailOutbox({ supabase, sendEmail: vi.fn(), isProviderConfigured: configured });
    expect(supabase.rpc).toHaveBeenCalledWith("claim_pending_emails", { p_limit: 20 });
  });
});

describe("processEmailOutbox -- genuine provider failures still use the normal bounded retry path", () => {
  it("marks failed with the provider's error message on a real delivery failure, never marks sent", async () => {
    const rows = [
      {
        id: "e2",
        event_type: "order_declined",
        entity_id: "o2",
        recipient_user_id: "u2",
        recipient_email: "buyer2@example.com",
        payload: {},
        attempt_count: 1,
      },
    ];
    const supabase = makeSupabase({ data: rows, error: null });
    const sendEmail = vi.fn(async () => ({ ok: false as const, reason: "provider_error" as const, error: "rate limited" }));

    const result = await processEmailOutbox({ supabase, sendEmail, isProviderConfigured: configured });

    expect(supabase.rpc).toHaveBeenCalledWith("mark_email_failed", { p_id: "e2", p_error: "rate limited" });
    expect(supabase.rpc).not.toHaveBeenCalledWith("mark_email_sent", expect.anything());
    expect(result).toEqual({ claimed: 1, sent: 0, failed: 1, providerConfigured: true });
  });

  it("a genuine delivery attempt is made (sendEmail invoked) before any failure is recorded -- terminal failure never happens without an actual attempt", async () => {
    const rows = [
      { id: "e3", event_type: "order_accepted", entity_id: "o3", recipient_user_id: "u3", recipient_email: "c@example.com", payload: {}, attempt_count: 4 },
    ];
    const supabase = makeSupabase({ data: rows, error: null });
    const sendEmail = vi.fn(async () => ({ ok: false as const, reason: "provider_error" as const, error: "timeout" }));

    await processEmailOutbox({ supabase, sendEmail, isProviderConfigured: configured });

    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(supabase.rpc).toHaveBeenCalledWith("mark_email_failed", { p_id: "e3", p_error: "timeout" });
  });
});

describe("processEmailOutbox -- missing provider configuration is never a delivery attempt", () => {
  it("consumes zero attempts when the provider is not configured -- claim_pending_emails is never even called", async () => {
    const supabase = makeSupabase({ data: [{ id: "should-not-be-returned" }], error: null });
    const sendEmail = vi.fn();

    const result = await processEmailOutbox({ supabase, sendEmail, isProviderConfigured: () => false });

    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
    expect(result).toEqual({ claimed: 0, sent: 0, failed: 0, providerConfigured: false });
  });

  it("uses the real isEmailProviderConfigured by default when this environment has no RESEND_API_KEY/EMAIL_FROM_ADDRESS set, still without claiming anything", async () => {
    const supabase = makeSupabase({ data: [{ id: "should-not-be-returned" }], error: null });
    const sendEmail = vi.fn();

    const result = await processEmailOutbox({ supabase, sendEmail });

    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
    expect(result).toEqual({ claimed: 0, sent: 0, failed: 0, providerConfigured: false });
  });

  it("a row that was never claimed while unconfigured remains deliverable once configuration is supplied later", async () => {
    const rows = [
      { id: "e4", event_type: "order_accepted", entity_id: "o4", recipient_user_id: "u4", recipient_email: "d@example.com", payload: {}, attempt_count: 0 },
    ];
    const supabase = makeSupabase({ data: rows, error: null });
    const sendEmail = vi.fn(async () => ({ ok: true as const }));

    // First run: unconfigured -- nothing claimed, nothing sent.
    const firstRun = await processEmailOutbox({ supabase, sendEmail, isProviderConfigured: () => false });
    expect(firstRun).toEqual({ claimed: 0, sent: 0, failed: 0, providerConfigured: false });
    expect(supabase.rpc).not.toHaveBeenCalled();

    // Second run: now configured -- the same still-queued row is claimed and sent normally.
    const secondRun = await processEmailOutbox({ supabase, sendEmail, isProviderConfigured: configured });
    expect(secondRun).toEqual({ claimed: 1, sent: 1, failed: 0, providerConfigured: true });
    expect(supabase.rpc).toHaveBeenCalledWith("mark_email_sent", { p_id: "e4" });
  });

  it("defense-in-depth: if sendEmail itself ever returns reason: not_configured mid-run, the row is neither marked sent nor failed", async () => {
    const rows = [
      { id: "e5", event_type: "order_accepted", entity_id: "o5", recipient_user_id: "u5", recipient_email: "e@example.com", payload: {}, attempt_count: 1 },
    ];
    const supabase = makeSupabase({ data: rows, error: null });
    const sendEmail = vi.fn(async () => ({ ok: false as const, reason: "not_configured" as const, error: "not configured" }));

    const result = await processEmailOutbox({ supabase, sendEmail, isProviderConfigured: configured });

    expect(supabase.rpc).not.toHaveBeenCalledWith("mark_email_sent", expect.anything());
    expect(supabase.rpc).not.toHaveBeenCalledWith("mark_email_failed", expect.anything());
    expect(result).toEqual({ claimed: 1, sent: 0, failed: 0, providerConfigured: true });
  });
});
