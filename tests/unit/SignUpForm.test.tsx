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

/** Fills the three fields and, unless `skipConsent`, checks the combined
 * Terms/Privacy checkbox -- the one new precondition every previously-
 * passing signup flow must still clear (PRD 5.5). */
function fillForm(options: { email?: string; password?: string; confirmPassword?: string; skipConsent?: boolean } = {}) {
  const { email = "new@example.com", password = "password1", confirmPassword = password, skipConsent = false } = options;
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: email } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: password } });
  fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: confirmPassword } });
  if (!skipConsent) {
    fireEvent.click(screen.getByRole("checkbox"));
  }
}

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
    fillForm({ password: "password1", confirmPassword: "password2" });
    fireEvent.click(screen.getByRole("button", { name: /create account/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Passwords do not match.");
    expect(signUpMock).not.toHaveBeenCalled();
  });

  it("signs the user in directly when Supabase returns an active session (confirmation off)", async () => {
    signUpMock.mockResolvedValue({ data: { session: { access_token: "x" }, user: {} }, error: null });
    render(<SignUpForm next="/item/PSO-ABC" />);

    fillForm();
    fireEvent.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/item/PSO-ABC"));
    expect(refreshMock).toHaveBeenCalled();
  });

  it("shows the check-email state when Supabase returns no session (confirmation required)", async () => {
    signUpMock.mockResolvedValue({ data: { session: null, user: { id: "u1" } }, error: null });
    render(<SignUpForm next="/" />);

    fillForm();
    fireEvent.click(screen.getByRole("button", { name: /create account/i }));

    expect(await screen.findByText(/new@example\.com/)).toBeInTheDocument();
    expect(screen.getByText(/verify your email/i)).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("does not claim the user is signed in when verification is required", async () => {
    signUpMock.mockResolvedValue({ data: { session: null, user: { id: "u1" } }, error: null });
    render(<SignUpForm next="/" />);

    fillForm();
    fireEvent.click(screen.getByRole("button", { name: /create account/i }));

    await screen.findByText(/verify your email/i);
    expect(screen.queryByText(/you're signed in/i)).not.toBeInTheDocument();
  });

  it("shows a safe error for an already-registered email", async () => {
    signUpMock.mockResolvedValue({ data: {}, error: new Error("User already registered") });
    render(<SignUpForm next="/" />);

    fillForm({ email: "existing@example.com" });
    fireEvent.click(screen.getByRole("button", { name: /create account/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "An account with that email already exists.",
    );
  });
});

describe("SignUpForm -- Terms of Use / Privacy Policy consent (PRD 5.5)", () => {
  beforeEach(() => {
    signUpMock.mockReset();
    pushMock.mockReset();
    refreshMock.mockReset();
  });

  it("the consent checkbox is unchecked by default", () => {
    render(<SignUpForm next="/" />);
    expect(screen.getByRole("checkbox")).not.toBeChecked();
  });

  it("links Terms of Use to /terms, opened in a new tab so in-progress signup data is not lost", () => {
    render(<SignUpForm next="/" />);
    const link = screen.getByRole("link", { name: "Terms of Use" });
    expect(link).toHaveAttribute("href", "/terms");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("links Privacy Policy to /privacy, opened in a new tab", () => {
    render(<SignUpForm next="/" />);
    const link = screen.getByRole("link", { name: "Privacy Policy" });
    expect(link).toHaveAttribute("href", "/privacy");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("Create account is disabled until the checkbox is checked", () => {
    render(<SignUpForm next="/" />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "new@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "password1" } });
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "password1" } });

    expect(screen.getByRole("button", { name: /create account/i })).toBeDisabled();

    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("button", { name: /create account/i })).not.toBeDisabled();
  });

  it("blocks submission with a clear validation message when unchecked, and never calls signUp", async () => {
    render(<SignUpForm next="/" />);
    fillForm({ skipConsent: true });

    // The disabled button already blocks a click; submit the form directly
    // to also prove the handleSubmit-level guard (defense in depth, same
    // pattern as the password-mismatch check).
    fireEvent.submit(screen.getByRole("button", { name: /create account/i }).closest("form")!);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Please agree to the Terms of Use and Privacy Policy to continue.",
    );
    expect(signUpMock).not.toHaveBeenCalled();
  });

  it("sends policies_accepted: true in signUp's metadata -- never a client-supplied timestamp -- once checked", async () => {
    signUpMock.mockResolvedValue({ data: { session: null, user: { id: "u1" } }, error: null });
    render(<SignUpForm next="/" />);

    fillForm({ email: "new@example.com", password: "password1" });
    fireEvent.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => expect(signUpMock).toHaveBeenCalled());
    const call = signUpMock.mock.calls[0][0];
    expect(call.options.data).toEqual({ policies_accepted: true });
  });

  it("proceeds normally once checked (regression: existing signup flow still completes)", async () => {
    signUpMock.mockResolvedValue({ data: { session: { access_token: "x" }, user: {} }, error: null });
    render(<SignUpForm next="/" />);

    fillForm();
    fireEvent.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/"));
  });
});
