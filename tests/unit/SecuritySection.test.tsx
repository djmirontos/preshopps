import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

const { updateUserMock, signOutMock, pushMock, refreshMock } = vi.hoisted(() => ({
  updateUserMock: vi.fn(),
  signOutMock: vi.fn(),
  pushMock: vi.fn(),
  refreshMock: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { updateUser: updateUserMock, signOut: signOutMock } }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

import { SecuritySection } from "@/components/account/SecuritySection";

beforeEach(() => {
  vi.clearAllMocks();
  updateUserMock.mockResolvedValue({ data: {}, error: null });
  signOutMock.mockResolvedValue({ error: null });
});

describe("SecuritySection -- appears with exactly the two approved actions", () => {
  it("renders Change password and Sign out other devices rows", () => {
    render(<SecuritySection />);
    expect(screen.getByRole("button", { name: /change password/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign out other devices/i })).toBeInTheDocument();
  });

  it("does not render a Change Email action -- self-service email change is not part of MVP", () => {
    render(<SecuritySection />);
    expect(screen.queryByRole("button", { name: /change email/i })).not.toBeInTheDocument();
  });

  it("has a Security heading", () => {
    render(<SecuritySection />);
    expect(screen.getByRole("heading", { name: "Security" })).toBeInTheDocument();
  });
});

describe("SecuritySection -- Change Password dialog", () => {
  it("opens the Change password dialog with current/new/confirm fields, no OTP", () => {
    render(<SecuritySection />);
    fireEvent.click(screen.getByRole("button", { name: /^change password$/i }));

    expect(screen.getByRole("dialog", { name: "Change password" })).toBeInTheDocument();
    expect(screen.getByLabelText("Current password")).toBeInTheDocument();
    expect(screen.queryByLabelText(/verification code/i)).not.toBeInTheDocument();
  });

  it("a successful change globally signs out and redirects to plain /sign-in (the one-time confirmation is a sessionStorage flag, never a URL marker)", async () => {
    render(<SecuritySection />);
    fireEvent.click(screen.getByRole("button", { name: /^change password$/i }));

    fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "old-password" } });
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "password1" } });
    fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "password1" } });
    fireEvent.click(screen.getByRole("button", { name: /update password/i }));

    await waitFor(() => expect(signOutMock).toHaveBeenCalledWith({ scope: "global" }));
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/sign-in"));
  });
});

describe("SecuritySection -- Sign out other devices", () => {
  it("shows a confirmation dialog before calling signOut", () => {
    render(<SecuritySection />);
    fireEvent.click(screen.getByRole("button", { name: /sign out other devices/i }));

    expect(screen.getByText("Sign out other devices?")).toBeInTheDocument();
    expect(
      screen.getByText("This will sign your account out on your other devices. You will stay signed in on this device."),
    ).toBeInTheDocument();
    expect(signOutMock).not.toHaveBeenCalled();
  });

  it("Cancel closes the dialog without calling signOut", () => {
    render(<SecuritySection />);
    fireEvent.click(screen.getByRole("button", { name: /sign out other devices/i }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByText("Sign out other devices?")).not.toBeInTheDocument();
    expect(signOutMock).not.toHaveBeenCalled();
  });

  it("confirming calls supabase.auth.signOut({ scope: 'others' }) -- never affecting the current device", async () => {
    render(<SecuritySection />);
    fireEvent.click(screen.getByRole("button", { name: /sign out other devices/i }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Sign out other devices" }));

    await waitFor(() => expect(signOutMock).toHaveBeenCalledWith({ scope: "others" }));
  });

  it("shows the locked success copy after a successful revocation", async () => {
    render(<SecuritySection />);
    fireEvent.click(screen.getByRole("button", { name: /sign out other devices/i }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Sign out other devices" }));

    expect(await screen.findByText("Other devices have been signed out.")).toBeInTheDocument();
  });

  it("does not show success and keeps the dialog open when signOut fails", async () => {
    signOutMock.mockResolvedValue({ error: new Error("network error") });
    render(<SecuritySection />);
    fireEvent.click(screen.getByRole("button", { name: /sign out other devices/i }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Sign out other devices" }));

    expect(await screen.findByText("We couldn't sign out your other devices. Please try again.")).toBeInTheDocument();
    expect(screen.queryByText("Other devices have been signed out.")).not.toBeInTheDocument();
    expect(screen.getByText("Sign out other devices?")).toBeInTheDocument();
  });

  it("is a fully independent action -- unaffected by Change Password's own automatic global sign-out", async () => {
    render(<SecuritySection />);
    fireEvent.click(screen.getByRole("button", { name: /^change password$/i }));
    fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "old-password" } });
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "password1" } });
    fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "password1" } });
    fireEvent.click(screen.getByRole("button", { name: /update password/i }));

    await waitFor(() => expect(signOutMock).toHaveBeenCalledWith({ scope: "global" }));
    expect(signOutMock).not.toHaveBeenCalledWith({ scope: "others" });
  });
});
