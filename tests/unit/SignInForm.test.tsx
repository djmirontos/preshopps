import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { signInWithPasswordMock, pushMock, refreshMock } = vi.hoisted(() => ({
  signInWithPasswordMock: vi.fn(),
  pushMock: vi.fn(),
  refreshMock: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { signInWithPassword: signInWithPasswordMock } }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

import { SignInForm } from "@/components/auth/SignInForm";

describe("SignInForm", () => {
  beforeEach(() => {
    signInWithPasswordMock.mockReset();
    pushMock.mockReset();
    refreshMock.mockReset();
  });

  it("renders email, password, and submit", () => {
    render(<SignInForm next="/" />);
    expect(screen.getByLabelText("Email")).toHaveAttribute("type", "email");
    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "password");
    expect(screen.getByRole("button", { name: /sign in/i })).toBeInTheDocument();
  });

  it("uses autocomplete attributes for email and password", () => {
    render(<SignInForm next="/" />);
    expect(screen.getByLabelText("Email")).toHaveAttribute("autocomplete", "email");
    expect(screen.getByLabelText("Password")).toHaveAttribute("autocomplete", "current-password");
  });

  it("includes a forgot password link and a sign-up link carrying next", () => {
    render(<SignInForm next="/item/PSO-ABC" />);
    expect(screen.getByRole("link", { name: /forgot password/i })).toHaveAttribute(
      "href",
      "/forgot-password",
    );
    expect(screen.getByRole("link", { name: /create an account/i })).toHaveAttribute(
      "href",
      `/sign-up?next=${encodeURIComponent("/item/PSO-ABC")}`,
    );
  });

  it("signs in successfully and honors the given return-to path", async () => {
    signInWithPasswordMock.mockResolvedValue({ data: {}, error: null });
    render(<SignInForm next="/item/PSO-ABC" />);

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "buyer@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "correct-password" } });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/item/PSO-ABC"));
    expect(refreshMock).toHaveBeenCalled();
    expect(signInWithPasswordMock).toHaveBeenCalledWith({
      email: "buyer@example.com",
      password: "correct-password",
    });
  });

  it("shows a safe error message for invalid credentials, never the raw error", async () => {
    signInWithPasswordMock.mockResolvedValue({
      data: {},
      error: new Error("Invalid login credentials"),
    });
    render(<SignInForm next="/" />);

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "buyer@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Email or password is incorrect."),
    );
    expect(pushMock).not.toHaveBeenCalled();
    expect(screen.queryByText(/invalid login credentials/i)).not.toBeInTheDocument();
  });

  it("never leaks a raw/unmapped error message into the UI", async () => {
    signInWithPasswordMock.mockResolvedValue({
      data: {},
      error: new Error("relation auth.users does not exist"),
    });
    render(<SignInForm next="/" />);

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "buyer@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.queryByText(/relation/i)).not.toBeInTheDocument();
  });
});
