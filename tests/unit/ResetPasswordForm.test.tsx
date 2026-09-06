import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { getSessionMock, onAuthStateChangeMock, updateUserMock, unsubscribeMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  onAuthStateChangeMock: vi.fn(),
  updateUserMock: vi.fn(),
  unsubscribeMock: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getSession: getSessionMock,
      onAuthStateChange: onAuthStateChangeMock,
      updateUser: updateUserMock,
    },
  }),
}));

import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";

describe("ResetPasswordForm", () => {
  beforeEach(() => {
    getSessionMock.mockReset();
    onAuthStateChangeMock.mockReset();
    updateUserMock.mockReset();
    unsubscribeMock.mockReset();
    onAuthStateChangeMock.mockReturnValue({ data: { subscription: { unsubscribe: unsubscribeMock } } });
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

  it("updates the password successfully and shows a success state", async () => {
    getSessionMock.mockResolvedValue({ data: { session: { user: { id: "u1" } } } });
    updateUserMock.mockResolvedValue({ data: {}, error: null });
    render(<ResetPasswordForm />);

    fireEvent.change(await screen.findByLabelText("New password"), { target: { value: "newpass1" } });
    fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "newpass1" } });
    fireEvent.click(screen.getByRole("button", { name: /update password/i }));

    await waitFor(() => expect(screen.getByText(/password has been updated/i)).toBeInTheDocument());
    expect(updateUserMock).toHaveBeenCalledWith({ password: "newpass1" });
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
});
