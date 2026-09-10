import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

const { findUserMock, grantMock, revokeMock, refreshMock } = vi.hoisted(() => ({
  findUserMock: vi.fn(),
  grantMock: vi.fn(),
  revokeMock: vi.fn(),
  refreshMock: vi.fn(),
}));

vi.mock("@/lib/admin/admin-role-actions", async () => {
  const actual = await vi.importActual<typeof import("@/lib/admin/admin-role-actions")>("@/lib/admin/admin-role-actions");
  return { ...actual, findUserForRoleAssignment: findUserMock, grantAdminRole: grantMock, revokeAdminRole: revokeMock };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

import { AdminRoleManagementClient } from "@/components/admin/AdminRoleManagementClient";
import type { AdminUserSummary } from "@/lib/admin/get-admin-users";

function makeUser(overrides: Partial<AdminUserSummary> = {}): AdminUserSummary {
  return {
    userId: "admin-1",
    displayName: "Jane D.",
    email: "jane@example.com",
    role: "admin",
    grantedBy: "super-1",
    grantedByDisplayName: "Sam S.",
    createdAt: "2026-01-05T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AdminRoleManagementClient -- roster", () => {
  it("renders each admin's name, email, role badge, and granted-by attribution", () => {
    render(<AdminRoleManagementClient currentUserId="viewer-1" initialUsers={[makeUser()]} />);

    expect(screen.getByText("Jane D.")).toBeInTheDocument();
    expect(screen.getByText("jane@example.com")).toBeInTheDocument();
    expect(screen.getByText("Admin")).toBeInTheDocument();
    expect(screen.getByText(/Granted by Sam S\./)).toBeInTheDocument();
  });

  it("shows 'system bootstrap' attribution when granted_by is null", () => {
    render(
      <AdminRoleManagementClient
        currentUserId="viewer-1"
        initialUsers={[makeUser({ grantedBy: null, grantedByDisplayName: null })]}
      />,
    );

    expect(screen.getByText(/Granted by system bootstrap/)).toBeInTheDocument();
  });

  it("marks the current viewer's own row with (you)", () => {
    render(<AdminRoleManagementClient currentUserId="admin-1" initialUsers={[makeUser({ userId: "admin-1" })]} />);
    expect(screen.getByText("(you)")).toBeInTheDocument();
  });
});

describe("AdminRoleManagementClient -- search and grant", () => {
  it("searches by email and shows the found user with role-assignment buttons", async () => {
    findUserMock.mockResolvedValue({
      ok: true,
      user: { userId: "user-2", displayName: "New Person", email: "new@example.com", currentRole: null },
    });

    render(<AdminRoleManagementClient currentUserId="viewer-1" initialUsers={[]} />);

    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "new@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    expect(await screen.findByText("New Person")).toBeInTheDocument();
    expect(findUserMock).toHaveBeenCalledWith("new@example.com");
    expect(screen.getByRole("button", { name: "Make Admin" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Make Super Admin" })).toBeInTheDocument();
  });

  it("shows a friendly message when no user matches", async () => {
    findUserMock.mockResolvedValue({ ok: true, user: null });

    render(<AdminRoleManagementClient currentUserId="viewer-1" initialUsers={[]} />);
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "nobody@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    expect(await screen.findByText("No user found with that email.")).toBeInTheDocument();
  });

  it("shows an error message when the search RPC rejects the caller", async () => {
    findUserMock.mockResolvedValue({ ok: false, code: "NOT_SUPER_ADMIN" });

    render(<AdminRoleManagementClient currentUserId="viewer-1" initialUsers={[]} />);
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "x@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    expect(await screen.findByText("Super admin access is required.")).toBeInTheDocument();
  });

  it("grants the searched user a role and refreshes on success", async () => {
    findUserMock.mockResolvedValue({
      ok: true,
      user: { userId: "user-2", displayName: "New Person", email: "new@example.com", currentRole: null },
    });
    grantMock.mockResolvedValue({ ok: true, userId: "user-2", role: "admin", previousRole: null });

    render(<AdminRoleManagementClient currentUserId="viewer-1" initialUsers={[]} />);
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "new@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await screen.findByText("New Person");

    fireEvent.click(screen.getByRole("button", { name: "Make Admin" }));

    await waitFor(() => expect(grantMock).toHaveBeenCalledWith("user-2", "admin"));
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("only offers 'Make Super Admin' (not 'Make Admin') for a user who is already an admin", async () => {
    findUserMock.mockResolvedValue({
      ok: true,
      user: { userId: "user-2", displayName: "Existing Admin", email: "existing@example.com", currentRole: "admin" },
    });

    render(<AdminRoleManagementClient currentUserId="viewer-1" initialUsers={[]} />);
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "existing@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await screen.findByText("Existing Admin");

    expect(screen.queryByRole("button", { name: "Make Admin" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Make Super Admin" })).toBeInTheDocument();
  });
});

describe("AdminRoleManagementClient -- roster role changes and removal", () => {
  it("offers 'Make Super Admin' but not 'Make Admin' for an existing admin row", () => {
    render(<AdminRoleManagementClient currentUserId="viewer-1" initialUsers={[makeUser({ role: "admin" })]} />);

    const row = screen.getByText("Jane D.").closest("li") as HTMLElement;
    expect(within(row).queryByRole("button", { name: "Make Admin" })).not.toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "Make Super Admin" })).toBeInTheDocument();
  });

  it("offers 'Make Admin' but not 'Make Super Admin' for an existing super_admin row", () => {
    render(<AdminRoleManagementClient currentUserId="viewer-1" initialUsers={[makeUser({ role: "super_admin" })]} />);

    const row = screen.getByText("Jane D.").closest("li") as HTMLElement;
    expect(within(row).getByRole("button", { name: "Make Admin" })).toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: "Make Super Admin" })).not.toBeInTheDocument();
  });

  it("changes a roster member's role directly (no confirm dialog) and refreshes", async () => {
    grantMock.mockResolvedValue({ ok: true, userId: "admin-1", role: "super_admin", previousRole: "admin" });
    render(<AdminRoleManagementClient currentUserId="viewer-1" initialUsers={[makeUser({ role: "admin" })]} />);

    fireEvent.click(screen.getByRole("button", { name: "Make Super Admin" }));

    await waitFor(() => expect(grantMock).toHaveBeenCalledWith("admin-1", "super_admin"));
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("opens a confirm dialog before removing a roster member", () => {
    render(<AdminRoleManagementClient currentUserId="viewer-1" initialUsers={[makeUser()]} />);

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Remove Jane D.'s admin access?")).toBeInTheDocument();
    expect(revokeMock).not.toHaveBeenCalled();
  });

  it("confirms removal, calls revokeAdminRole, and refreshes on success", async () => {
    revokeMock.mockResolvedValue({ ok: true, userId: "admin-1", previousRole: "admin" });
    render(<AdminRoleManagementClient currentUserId="viewer-1" initialUsers={[makeUser()]} />);

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove access" }));

    await waitFor(() => expect(revokeMock).toHaveBeenCalledWith("admin-1", undefined));
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows LAST_SUPER_ADMIN's friendly message and keeps the dialog open on failure", async () => {
    revokeMock.mockResolvedValue({ ok: false, code: "LAST_SUPER_ADMIN" });
    render(<AdminRoleManagementClient currentUserId="viewer-1" initialUsers={[makeUser({ role: "super_admin" })]} />);

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove access" }));

    expect(await screen.findByText("You can't remove the last remaining super admin.")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("closes the dialog without calling revokeAdminRole when cancelled", () => {
    render(<AdminRoleManagementClient currentUserId="viewer-1" initialUsers={[makeUser()]} />);

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(revokeMock).not.toHaveBeenCalled();
  });
});
