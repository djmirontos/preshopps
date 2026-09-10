import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { AuthUser } from "@/lib/auth/session";
import type { GetAdminSupportTicketDetailResult, AdminSupportTicketDetail } from "@/lib/admin/get-admin-support-ticket-detail";

const { getAuthUserMock, getAdminSupportTicketDetailMock, redirectMock, notFoundMock } = vi.hoisted(() => ({
  getAuthUserMock: vi.fn<() => Promise<AuthUser | null>>(),
  getAdminSupportTicketDetailMock: vi.fn<() => Promise<GetAdminSupportTicketDetailResult>>(),
  redirectMock: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  notFoundMock: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("@/lib/auth/session", () => ({
  getAuthUser: getAuthUserMock,
}));

vi.mock("@/lib/admin/get-admin-support-ticket-detail", () => ({
  getAdminSupportTicketDetail: getAdminSupportTicketDetailMock,
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
  notFound: notFoundMock,
  useRouter: () => ({ refresh: vi.fn() }),
}));

import AdminSupportTicketDetailPage from "@/app/admin/support/[ticketId]/page";

function makeTicket(overrides: Partial<AdminSupportTicketDetail> = {}): AdminSupportTicketDetail {
  return {
    ticketId: "ticket-1",
    category: "account_issue",
    message: "Please delete my account.",
    userId: "user-1",
    userDisplayName: "Jane D.",
    userDeletedAt: null,
    createdAt: "2026-01-05T00:00:00.000Z",
    ...overrides,
  };
}

function params(ticketId = "ticket-1") {
  return { params: Promise.resolve({ ticketId }) };
}

describe("AdminSupportTicketDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects a guest to sign-in with the ticket-specific next path", async () => {
    getAuthUserMock.mockResolvedValue(null);
    await expect(AdminSupportTicketDetailPage(params("ticket-1"))).rejects.toThrow(
      "NEXT_REDIRECT:/sign-in?next=%2Fadmin%2Fsupport%2Fticket-1",
    );
    expect(getAdminSupportTicketDetailMock).not.toHaveBeenCalled();
  });

  it("calls notFound() for a non-admin caller", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: "user@example.com" });
    getAdminSupportTicketDetailMock.mockResolvedValue({ status: "not_admin" });
    await expect(AdminSupportTicketDetailPage(params())).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("calls notFound() for a nonexistent ticket", async () => {
    getAuthUserMock.mockResolvedValue({ id: "admin-1", email: "admin@example.com" });
    getAdminSupportTicketDetailMock.mockResolvedValue({ status: "not_found" });
    await expect(AdminSupportTicketDetailPage(params())).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("shows a safe error state on an unexpected read error", async () => {
    getAuthUserMock.mockResolvedValue({ id: "admin-1", email: "admin@example.com" });
    getAdminSupportTicketDetailMock.mockResolvedValue({ status: "error" });
    render(await AdminSupportTicketDetailPage(params()));
    expect(screen.getByText(/unable to load this support ticket/i)).toBeInTheDocument();
  });

  it("renders the ticket for an admin", async () => {
    getAuthUserMock.mockResolvedValue({ id: "admin-1", email: "admin@example.com" });
    getAdminSupportTicketDetailMock.mockResolvedValue({ status: "found", ticket: makeTicket() });

    render(await AdminSupportTicketDetailPage(params()));

    expect(screen.getByRole("heading", { level: 1, name: "Account issue" })).toBeInTheDocument();
    expect(screen.getByText("Please delete my account.")).toBeInTheDocument();
    expect(screen.getByText(/Jane D\./)).toBeInTheDocument();
  });

  it("shows the Anonymize Account action for a not-yet-anonymized account issue ticket", async () => {
    getAuthUserMock.mockResolvedValue({ id: "admin-1", email: "admin@example.com" });
    getAdminSupportTicketDetailMock.mockResolvedValue({ status: "found", ticket: makeTicket() });

    render(await AdminSupportTicketDetailPage(params()));

    expect(screen.getByRole("button", { name: "Anonymize Account" })).toBeInTheDocument();
  });

  it("does not show the action for a general inquiry ticket", async () => {
    getAuthUserMock.mockResolvedValue({ id: "admin-1", email: "admin@example.com" });
    getAdminSupportTicketDetailMock.mockResolvedValue({
      status: "found",
      ticket: makeTicket({ category: "general_inquiry" }),
    });

    render(await AdminSupportTicketDetailPage(params()));

    expect(screen.queryByRole("button", { name: "Anonymize Account" })).not.toBeInTheDocument();
  });

  it("shows an anonymized state, not an active action, once the account is already anonymized", async () => {
    getAuthUserMock.mockResolvedValue({ id: "admin-1", email: "admin@example.com" });
    getAdminSupportTicketDetailMock.mockResolvedValue({
      status: "found",
      ticket: makeTicket({ userDeletedAt: "2026-02-01T00:00:00.000Z", userDisplayName: "Deleted user" }),
    });

    render(await AdminSupportTicketDetailPage(params()));

    expect(screen.queryByRole("button", { name: "Anonymize Account" })).not.toBeInTheDocument();
    expect(screen.getByText("Account anonymized")).toBeInTheDocument();
  });
});
