import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock, createClientMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  createClientMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: createClientMock,
}));

createClientMock.mockResolvedValue({ rpc: rpcMock });

import { getAdminSupportTicketDetail } from "@/lib/admin/get-admin-support-ticket-detail";

function row(overrides: Record<string, unknown> = {}) {
  return {
    ticket_id: "ticket-1",
    category: "account_issue",
    message: "Please delete my account.",
    user_id: "user-1",
    user_display_name: "Jane D.",
    created_at: "2026-01-05T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  rpcMock.mockReset();
});

describe("getAdminSupportTicketDetail", () => {
  it("calls get_admin_support_ticket_detail with the ticket id", async () => {
    rpcMock.mockResolvedValue({ data: [row()], error: null });
    await getAdminSupportTicketDetail("ticket-1");
    expect(rpcMock).toHaveBeenCalledWith("get_admin_support_ticket_detail", { p_ticket_id: "ticket-1" });
  });

  it("maps the row to AdminSupportTicketDetail on success", async () => {
    rpcMock.mockResolvedValue({ data: [row()], error: null });
    const result = await getAdminSupportTicketDetail("ticket-1");
    expect(result).toEqual({
      status: "found",
      ticket: {
        ticketId: "ticket-1",
        category: "account_issue",
        message: "Please delete my account.",
        userId: "user-1",
        userDisplayName: "Jane D.",
        createdAt: "2026-01-05T00:00:00.000Z",
      },
    });
  });

  it("returns not_admin for NOT_ADMIN", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "denied", details: "NOT_ADMIN" } });
    const result = await getAdminSupportTicketDetail("ticket-1");
    expect(result).toEqual({ status: "not_admin" });
  });

  it("returns not_found for TICKET_NOT_FOUND", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "missing", details: "TICKET_NOT_FOUND" } });
    const result = await getAdminSupportTicketDetail("ticket-1");
    expect(result).toEqual({ status: "not_found" });
  });

  it("returns not_found when the RPC succeeds but returns no row", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    const result = await getAdminSupportTicketDetail("ticket-1");
    expect(result).toEqual({ status: "not_found" });
  });

  it("returns error for any other failure", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    const result = await getAdminSupportTicketDetail("ticket-1");
    expect(result).toEqual({ status: "error" });
  });

  it("returns error when the RPC throws", async () => {
    rpcMock.mockRejectedValue(new Error("network down"));
    const result = await getAdminSupportTicketDetail("ticket-1");
    expect(result).toEqual({ status: "error" });
  });
});
