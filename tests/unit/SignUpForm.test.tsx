import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { signUpMock, pushMock, refreshMock } = vi.hoisted(() => ({
  signUpMock: vi.fn(),
  pushMock: vi.fn(),
  refreshMock: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { signUp: signUpMock } }),
}));

vi.mock("@/lib/env", () => ({
  getAppUrl: () => "http://localhost:3000",
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

import { SignUpForm } from "@/components/auth/SignUpForm";

describe("SignUpForm", () => {
  beforeEach(() => {
    signUpMock.mockReset();
    pushMock.mockReset();
    refreshMock.mockReset();
  });

  it("renders email, password, and confirm-password fields", () => {
    render(<SignUpForm next="/" />);
    expect(screen.getByLabelText("Email")).toHaveAttribute("type", "email");
    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "password");
    expect(screen.getByLabelText("Confirm password")).toHaveAttribute("type", "password");
  });

  it("shows a safe error and does not call signUp when passwords do not match", async () => {
    render(<SignUpForm next="/" />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "new@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "password1" } });
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "password2" } });
    fireEvent.click(screen.getByRole("button", { name: /create account/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Passwords do not match.");
    expect(signUpMock).not.toHaveBeenCalled();
  });

  it("signs the user in directly when Supabase returns an active session (confirmation off)", async () => {
    signUpMock.mockResolvedValue({ data: { session: { access_token: "x" }, user: {} }, error: null });
    render(<SignUpForm next="/item/PSO-ABC" />);

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "new@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "password1" } });
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "password1" } });
    fireEvent.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/item/PSO-ABC"));
    expect(refreshMock).toHaveBeenCalled();
  });

  it("shows the check-email state when Supabase returns no session (confirmation required)", async () => {
    signUpMock.mockResolvedValue({ data: { session: null, user: { id: "u1" } }, error: null });
    render(<SignUpForm next="/" />);

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "new@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "password1" } });
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "password1" } });
    fireEvent.click(screen.getByRole("button", { name: /create account/i }));

    expect(await screen.findByText(/new@example\.com/)).toBeInTheDocument();
    expect(screen.getByText(/verify your email/i)).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("does not claim the user is signed in when verification is required", async () => {
    signUpMock.mockResolvedValue({ data: { session: null, user: { id: "u1" } }, error: null });
    render(<SignUpForm next="/" />);

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "new@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "password1" } });
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "password1" } });
    fireEvent.click(screen.getByRole("button", { name: /create account/i }));

    await screen.findByText(/verify your email/i);
    expect(screen.queryByText(/you're signed in/i)).not.toBeInTheDocument();
  });

  it("shows a safe error for an already-registered email", async () => {
    signUpMock.mockResolvedValue({ data: {}, error: new Error("User already registered") });
    render(<SignUpForm next="/" />);

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "existing@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "password1" } });
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "password1" } });
    fireEvent.click(screen.getByRole("button", { name: /create account/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "An account with that email already exists.",
    );
  });
});
