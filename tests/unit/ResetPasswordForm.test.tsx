import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { getSessionMock, onAuthStateChangeMock, updateUserMock, signOutMock, unsubscribeMock, pushMock, refreshMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  onAuthStateChangeMock: vi.fn(),
  updateUserMock: vi.fn(),
  signOutMock: vi.fn(),
  unsubscribeMock: vi.fn(),
  pushMock: vi.fn(),
  refreshMock: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getSession: getSessionMock,
      onAuthStateChange: onAuthStateChangeMock,
      updateUser: updateUserMock,
      signOut: signOutMock,
    },
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";

describe("ResetPasswordForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    onAuthStateChangeMock.mockReturnValue({ data: { subscription: { unsubscribe: unsubscribeMock } } });
    signOutMock.mockResolvedValue({ error: null });
  });

  it("shows the new-password form once a recovery session is detected", async () => {
    getSessionMock.mockResolvedValue({ data: { session: { user: { id: "u1" } } } });
    render(<ResetPasswordForm />);

    expect(await screen.findByLabelText("New password")).toBeInTheDocument();
    expect(screen.getByLabelText("Confirm new password")).toBeInTheDocument();
  });

  it("shows a safe invalid/expired message when no recovery session is found", async () => {
    getSessionMock.mockResolvedValue({ data: { session: null } });
    render(<ResetPasswordForm />);

    expect(
      await screen.findByText(/invalid or has expired/i, {}, { timeout: 3000 }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /request a new link/i })).toHaveAttribute(
      "href",
      "/forgot-password",
    );
  });

  it("shows a client-side mismatch error without calling updateUser", async () => {
    getSessionMock.mockResolvedValue({ data: { session: { user: { id: "u1" } } } });
    render(<ResetPasswordForm />);

    fireEvent.change(await screen.findByLabelText("New password"), { target: { value: "abcdef1" } });
    fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "abcdef2" } });
    fireEvent.click(screen.getByRole("button", { name: /update password/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Passwords do not match.");
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  it("shows a safe error, not a raw one, when the password update fails", async () => {
    getSessionMock.mockResolvedValue({ data: { session: { user: { id: "u1" } } } });
    updateUserMock.mockResolvedValue({
      data: {},
      error: new Error("Password should be at least 6 characters"),
    });
    render(<ResetPasswordForm />);

    fireEvent.change(await screen.findByLabelText("New password"), { target: { value: "abcdef" } });
    fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "abcdef" } });
    fireEvent.click(screen.getByRole("button", { name: /update password/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Password must be at least 6 characters.",
    );
    expect(signOutMock).not.toHaveBeenCalled();
  });

  describe("password visibility toggles", () => {
    it("New password starts hidden", async () => {
      getSessionMock.mockResolvedValue({ data: { session: { user: { id: "u1" } } } });
      render(<ResetPasswordForm />);

      expect(await screen.findByLabelText("New password")).toHaveAttribute("type", "password");
    });

    it("Confirm new password starts hidden", async () => {
      getSessionMock.mockResolvedValue({ data: { session: { user: { id: "u1" } } } });
      render(<ResetPasswordForm />);

      await screen.findByLabelText("New password");
      expect(screen.getByLabelText("Confirm new password")).toHaveAttribute("type", "password");
    });

    it("toggling New password's visibility does not affect Confirm new password", async () => {
      getSessionMock.mockResolvedValue({ data: { session: { user: { id: "u1" } } } });
      render(<ResetPasswordForm />);
      await screen.findByLabelText("New password");

      fireEvent.click(screen.getByRole("button", { name: "Show new password" }));

      expect(screen.getByLabelText("New password")).toHaveAttribute("type", "text");
      expect(screen.getByLabelText("Confirm new password")).toHaveAttribute("type", "password");
    });

    it("toggling Confirm new password's visibility does not affect New password", async () => {
      getSessionMock.mockResolvedValue({ data: { session: { user: { id: "u1" } } } });
      render(<ResetPasswordForm />);
      await screen.findByLabelText("New password");

      fireEvent.click(screen.getByRole("button", { name: "Show password confirmation" }));

      expect(screen.getByLabelText("Confirm new password")).toHaveAttribute("type", "text");
      expect(screen.getByLabelText("New password")).toHaveAttribute("type", "password");
    });

    it("the accessible label switches from Show to Hide once toggled", async () => {
      getSessionMock.mockResolvedValue({ data: { session: { user: { id: "u1" } } } });
      render(<ResetPasswordForm />);
      await screen.findByLabelText("New password");

      fireEvent.click(screen.getByRole("button", { name: "Show new password" }));

      expect(screen.getByRole("button", { name: "Hide new password" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Show new password" })).not.toBeInTheDocument();
    });

    it("the toggle buttons are type=button and never submit the form", async () => {
      getSessionMock.mockResolvedValue({ data: { session: { user: { id: "u1" } } } });
      render(<ResetPasswordForm />);
      await screen.findByLabelText("New password");

      const newToggle = screen.getByRole("button", { name: "Show new password" });
      const confirmToggle = screen.getByRole("button", { name: "Show password confirmation" });
      expect(newToggle).toHaveAttribute("type", "button");
      expect(confirmToggle).toHaveAttribute("type", "button");

      fireEvent.click(newToggle);
      fireEvent.click(confirmToggle);
      expect(updateUserMock).not.toHaveBeenCalled();
    });
  });

  describe("successful update follows the approved global-signout policy", () => {
    async function submitNewPassword() {
      getSessionMock.mockResolvedValue({ data: { session: { user: { id: "u1" } } } });
      updateUserMock.mockResolvedValue({ data: {}, error: null });
      render(<ResetPasswordForm />);

      fireEvent.change(await screen.findByLabelText("New password"), { target: { value: "newpass1" } });
      fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "newpass1" } });
      fireEvent.click(screen.getByRole("button", { name: /update password/i }));
    }

    it("calls updateUser({ password }) with the entered password", async () => {
      await submitNewPassword();
      await waitFor(() => expect(updateUserMock).toHaveBeenCalledWith({ password: "newpass1" }));
    });

    it("calls signOut({ scope: 'global' }) after a successful update", async () => {
      await submitNewPassword();
      await waitFor(() => expect(signOutMock).toHaveBeenCalledWith({ scope: "global" }));
    });

    it("redirects to /sign-in once sign-out succeeds", async () => {
      await submitNewPassword();
      await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/sign-in"));
    });

    it("no longer renders the password fields once redirecting", async () => {
      await submitNewPassword();
      await waitFor(() => expect(pushMock).toHaveBeenCalled());
      expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();
    });

    it("shows safe recovery guidance and does not redirect when the global sign-out fails", async () => {
      signOutMock.mockResolvedValue({ error: new Error("network error") });
      await submitNewPassword();

      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toMatch(/couldn't finish signing you out automatically/i);
      expect(alert.textContent).not.toMatch(/network error/i);
      expect(pushMock).not.toHaveBeenCalledWith("/sign-in");
    });
  });
});
