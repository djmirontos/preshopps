import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock, createClientMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  createClientMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: createClientMock,
}));

createClientMock.mockResolvedValue({ rpc: rpcMock });

import { getAdminSupportTickets } from "@/lib/admin/get-admin-support-tickets";

function row(overrides: Record<string, unknown> = {}) {
  return {
    ticket_id: "ticket-1",
    category: "general_inquiry",
    message: "How do I change my shop location?",
    user_id: "user-1",
    user_display_name: "Jane D.",
    created_at: "2026-01-05T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  rpcMock.mockReset();
});

describe("getAdminSupportTickets", () => {
  it("calls get_admin_support_tickets with limit and null cursor on the first page", async () => {
    rpcMock.mockResolvedValue({ data: [row()], error: null });
    await getAdminSupportTickets(20);
    expect(rpcMock).toHaveBeenCalledWith("get_admin_support_tickets", {
      p_limit: 20,
      p_before_created_at: null,
      p_before_id: null,
    });
  });

  it("passes the cursor through unchanged on a subsequent page", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    await getAdminSupportTickets(20, { createdAt: "2026-01-04T00:00:00.000Z", id: "ticket-9" });
    expect(rpcMock).toHaveBeenCalledWith("get_admin_support_tickets", {
      p_limit: 20,
      p_before_created_at: "2026-01-04T00:00:00.000Z",
      p_before_id: "ticket-9",
    });
  });

  it("maps rows to AdminSupportTicketSummary", async () => {
    rpcMock.mockResolvedValue({ data: [row()], error: null });
    const result = await getAdminSupportTickets(20);
    expect(result.tickets).toEqual([
      {
        ticketId: "ticket-1",
        category: "general_inquiry",
        message: "How do I change my shop location?",
        userId: "user-1",
        userDisplayName: "Jane D.",
        createdAt: "2026-01-05T00:00:00.000Z",
      },
    ]);
    expect(result.hadError).toBe(false);
    expect(result.notAdmin).toBe(false);
  });

  it("surfaces NOT_ADMIN as notAdmin: true, distinct from a generic error", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "denied", details: "NOT_ADMIN" } });
    const result = await getAdminSupportTickets(20);
    expect(result).toEqual({ tickets: [], hadError: false, notAdmin: true, nextCursor: null });
  });

  it("returns hadError true for any other error", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "boom", details: "LIMIT_INVALID" } });
    const result = await getAdminSupportTickets(20);
    expect(result).toEqual({ tickets: [], hadError: true, notAdmin: false, nextCursor: null });
  });

  it("returns hadError true when the RPC throws", async () => {
    rpcMock.mockRejectedValue(new Error("network down"));
    const result = await getAdminSupportTickets(20);
    expect(result).toEqual({ tickets: [], hadError: true, notAdmin: false, nextCursor: null });
  });

  it("returns a nextCursor derived from the last row when a full page is returned", async () => {
    rpcMock.mockResolvedValue({
      data: [row({ ticket_id: "t1", created_at: "2026-01-05T00:00:00.000Z" }), row({ ticket_id: "t2", created_at: "2026-01-04T00:00:00.000Z" })],
      error: null,
    });
    const result = await getAdminSupportTickets(2);
    expect(result.nextCursor).toEqual({ createdAt: "2026-01-04T00:00:00.000Z", id: "t2" });
  });

  it("returns an empty list (not an error) when there are simply no tickets", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    const result = await getAdminSupportTickets(20);
    expect(result).toEqual({ tickets: [], hadError: false, notAdmin: false, nextCursor: null });
  });
});
