import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { AuthUser } from "@/lib/auth/session";
import type { AdminSupportTicketSummary, GetAdminSupportTicketsResult } from "@/lib/admin/get-admin-support-tickets";

const { getAuthUserMock, getAdminSupportTicketsMock, getMyAdminRoleMock, redirectMock, notFoundMock } = vi.hoisted(() => ({
  getAuthUserMock: vi.fn<() => Promise<AuthUser | null>>(),
  getAdminSupportTicketsMock: vi.fn<() => Promise<GetAdminSupportTicketsResult>>(),
  getMyAdminRoleMock: vi.fn<() => Promise<"admin" | "super_admin" | null>>(),
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

vi.mock("@/lib/admin/get-admin-support-tickets", () => ({
  getAdminSupportTickets: getAdminSupportTicketsMock,
}));

vi.mock("@/lib/admin/get-my-admin-role", () => ({
  getMyAdminRole: getMyAdminRoleMock,
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
  notFound: notFoundMock,
}));

import AdminSupportTicketsPage from "@/app/admin/support/page";

function makeTicket(overrides: Partial<AdminSupportTicketSummary> = {}): AdminSupportTicketSummary {
  return {
    ticketId: "ticket-1",
    category: "general_inquiry",
    message: "How do I change my shop location?",
    userId: "user-1",
    userDisplayName: "Jane D.",
    createdAt: "2026-01-05T00:00:00.000Z",
    ...overrides,
  };
}

describe("AdminSupportTicketsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMyAdminRoleMock.mockResolvedValue("admin");
  });

  it("redirects a guest to sign-in with next=/admin/support before checking admin status", async () => {
    getAuthUserMock.mockResolvedValue(null);
    await expect(AdminSupportTicketsPage()).rejects.toThrow("NEXT_REDIRECT:/sign-in?next=%2Fadmin%2Fsupport");
    expect(getAdminSupportTicketsMock).not.toHaveBeenCalled();
  });

  it("calls notFound() for a signed-in ordinary (non-admin) user", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: "user@example.com" });
    getAdminSupportTicketsMock.mockResolvedValue({ tickets: [], hadError: false, notAdmin: true, nextCursor: null });

    await expect(AdminSupportTicketsPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("renders the support queue for an admin", async () => {
    getAuthUserMock.mockResolvedValue({ id: "admin-1", email: "admin@example.com" });
    getAdminSupportTicketsMock.mockResolvedValue({ tickets: [makeTicket()], hadError: false, notAdmin: false, nextCursor: null });

    render(await AdminSupportTicketsPage());

    expect(screen.getByRole("heading", { level: 1, name: "Support" })).toBeInTheDocument();
    expect(screen.getByText("How do I change my shop location?")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Support" })).toHaveAttribute("aria-current", "page");
  });

  it("shows an empty state when there are no tickets", async () => {
    getAuthUserMock.mockResolvedValue({ id: "admin-1", email: "admin@example.com" });
    getAdminSupportTicketsMock.mockResolvedValue({ tickets: [], hadError: false, notAdmin: false, nextCursor: null });

    render(await AdminSupportTicketsPage());

    expect(screen.getByText("No support tickets yet.")).toBeInTheDocument();
  });

  it("shows an error state distinct from the empty state", async () => {
    getAuthUserMock.mockResolvedValue({ id: "admin-1", email: "admin@example.com" });
    getAdminSupportTicketsMock.mockResolvedValue({ tickets: [], hadError: true, notAdmin: false, nextCursor: null });

    render(await AdminSupportTicketsPage());

    expect(screen.getByText("Unable to load support tickets right now.")).toBeInTheDocument();
  });

  it("links back to the Reports queue", async () => {
    getAuthUserMock.mockResolvedValue({ id: "admin-1", email: "admin@example.com" });
    getAdminSupportTicketsMock.mockResolvedValue({ tickets: [], hadError: false, notAdmin: false, nextCursor: null });

    render(await AdminSupportTicketsPage());

    expect(screen.getByRole("link", { name: "Reports" })).toHaveAttribute("href", "/admin");
  });

  it("does not show the Admins nav link for an ordinary admin", async () => {
    getAuthUserMock.mockResolvedValue({ id: "admin-1", email: "admin@example.com" });
    getAdminSupportTicketsMock.mockResolvedValue({ tickets: [], hadError: false, notAdmin: false, nextCursor: null });
    getMyAdminRoleMock.mockResolvedValue("admin");

    render(await AdminSupportTicketsPage());

    expect(screen.queryByRole("link", { name: "Admins" })).not.toBeInTheDocument();
  });

  it("shows the Admins nav link for a super_admin", async () => {
    getAuthUserMock.mockResolvedValue({ id: "super-1", email: "super@example.com" });
    getAdminSupportTicketsMock.mockResolvedValue({ tickets: [], hadError: false, notAdmin: false, nextCursor: null });
    getMyAdminRoleMock.mockResolvedValue("super_admin");

    render(await AdminSupportTicketsPage());

    expect(screen.getByRole("link", { name: "Admins" })).toHaveAttribute("href", "/admin/admins");
  });
});
