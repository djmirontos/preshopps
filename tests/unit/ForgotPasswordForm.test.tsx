import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const resetPasswordForEmailMock = vi.fn();

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { resetPasswordForEmail: resetPasswordForEmailMock } }),
}));

vi.mock("@/lib/env", () => ({
  getAppUrl: () => "http://localhost:3000",
}));

import { ForgotPasswordForm } from "@/components/auth/ForgotPasswordForm";

const GENERIC_MESSAGE = "If an account exists for that email, we've sent reset instructions.";

describe("ForgotPasswordForm", () => {
  beforeEach(() => {
    resetPasswordForEmailMock.mockReset();
  });

  it("shows the generic success message for an email that resolves successfully", async () => {
    resetPasswordForEmailMock.mockResolvedValue({ data: {}, error: null });
    render(<ForgotPasswordForm />);

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "real@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /send reset instructions/i }));

    await waitFor(() => expect(screen.getByText(GENERIC_MESSAGE)).toBeInTheDocument());
  });

  it("shows the exact same generic message regardless of whether the account exists (no enumeration)", async () => {
    resetPasswordForEmailMock.mockResolvedValue({ data: {}, error: null });
    render(<ForgotPasswordForm />);

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "nonexistent@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /send reset instructions/i }));

    await waitFor(() => expect(screen.getByText(GENERIC_MESSAGE)).toBeInTheDocument());
    expect(screen.queryByText(/no account/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/does not exist/i)).not.toBeInTheDocument();
  });
});
