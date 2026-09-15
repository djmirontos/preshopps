import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";

const { resetPasswordForEmailMock, verifyOtpMock, updateUserMock, signOutMock, pushMock, refreshMock } = vi.hoisted(() => ({
  resetPasswordForEmailMock: vi.fn(),
  verifyOtpMock: vi.fn(),
  updateUserMock: vi.fn(),
  signOutMock: vi.fn(),
  pushMock: vi.fn(),
  refreshMock: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      resetPasswordForEmail: resetPasswordForEmailMock,
      verifyOtp: verifyOtpMock,
      updateUser: updateUserMock,
      signOut: signOutMock,
    },
  }),
}));

vi.mock("@/lib/env", () => ({
  getAppUrl: () => "http://localhost:3000",
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

import { ForgotPasswordForm } from "@/components/auth/ForgotPasswordForm";

const INVALID_CODE_MESSAGE = "That verification code is invalid or has expired. Request a new code and try again.";
const RATE_LIMIT_MESSAGE = "Please wait before requesting another code.";

async function goToCodeStep(email = "buyer@example.com") {
  render(<ForgotPasswordForm />);
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: email } });
  fireEvent.click(screen.getByRole("button", { name: /send code/i }));
  await screen.findByLabelText("Recovery code");
}

async function goToCodeStepAndVerify(code = "123456") {
  await goToCodeStep();
  fireEvent.change(screen.getByLabelText("Recovery code"), { target: { value: code } });
  fireEvent.click(screen.getByRole("button", { name: /verify code/i }));
  await screen.findByLabelText("New password");
}

/** Ticks the fake clock forward one second at a time, flushing React
 * (via act) between each tick -- the component's own cooldown effect
 * re-schedules its next setTimeout only once React has re-rendered with
 * the decremented value, so a single large advanceTimersByTime call can
 * miss everything after the first tick. */
async function advanceCooldownToZero() {
  for (let i = 0; i < 60; i++) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
  }
}

/** Same as goToCodeStep, but safe to call with fake timers already
 * active: it flushes the pending resetPasswordForEmail promise via
 * act() directly instead of relying on Testing Library's own
 * interval-based findByText polling, which does not advance under a
 * fake clock unless explicitly ticked. */
async function goToCodeStepFakeTimers(email = "buyer@example.com") {
  render(<ForgotPasswordForm />);
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: email } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /send code/i }));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetPasswordForEmailMock.mockResolvedValue({ data: {}, error: null });
  verifyOtpMock.mockResolvedValue({ data: {}, error: null });
  updateUserMock.mockResolvedValue({ data: {}, error: null });
  signOutMock.mockResolvedValue({ error: null });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Step 1 -- request a recovery code", () => {
  it("accepts an email and moves to the code step", async () => {
    await goToCodeStep("buyer@example.com");
    expect(screen.getByLabelText("Recovery code")).toBeInTheDocument();
  });

  it("calls resetPasswordForEmail with the entered email and a redirectTo pointing at /reset-password", async () => {
    await goToCodeStep("buyer@example.com");
    expect(resetPasswordForEmailMock).toHaveBeenCalledWith("buyer@example.com", {
      redirectTo: "http://localhost:3000/reset-password",
    });
  });

  it("a no-error response (Supabase's own account-existence-safe outcome) advances to step 2, for any email", async () => {
    // Supabase itself never reports an error for a nonexistent account on
    // this call -- it resolves with no error either way. This is the
    // "does the account exist" case, distinct from a genuine failure.
    resetPasswordForEmailMock.mockResolvedValue({ data: {}, error: null });
    await goToCodeStep("nonexistent@example.com");

    expect(screen.getByRole("heading", { name: "Check your email" })).toBeInTheDocument();
    expect(screen.queryByText(/no account/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/does not exist/i)).not.toBeInTheDocument();
  });

  it("never persists the email to localStorage, sessionStorage, cookies, or a query param", async () => {
    const localSetSpy = vi.spyOn(Storage.prototype, "setItem");
    render(<ForgotPasswordForm />);

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "buyer@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /send code/i }));
    await screen.findByLabelText("Recovery code");

    expect(localSetSpy).not.toHaveBeenCalled();
    expect(document.cookie).not.toContain("buyer@example.com");
    expect(window.location.search).toBe("");
    expect(pushMock).not.toHaveBeenCalledWith(expect.stringContaining("buyer@example.com"));

    localSetSpy.mockRestore();
  });
});

describe("Step 1 -- a genuine request failure keeps the user on the email step", () => {
  it("does NOT advance to the code step when resetPasswordForEmail returns a real error", async () => {
    resetPasswordForEmailMock.mockResolvedValue({ data: null, error: new Error("Network request failed") });
    render(<ForgotPasswordForm />);

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "buyer@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /send code/i }));

    await screen.findByRole("alert");
    expect(screen.queryByLabelText("Recovery code")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
  });

  it("shows the safe rate-limit copy for a rate-limit error, never the raw message", async () => {
    resetPasswordForEmailMock.mockResolvedValue({ data: null, error: new Error("Email rate limit exceeded") });
    render(<ForgotPasswordForm />);

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "buyer@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /send code/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(RATE_LIMIT_MESSAGE);
    expect(alert.textContent).not.toMatch(/rate limit exceeded/i);
  });

  it("shows the safe generic retry copy for a network/general failure, never the raw message", async () => {
    resetPasswordForEmailMock.mockResolvedValue({ data: null, error: new Error("fetch failed: ECONNRESET") });
    render(<ForgotPasswordForm />);

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "buyer@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /send code/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("We couldn't send a password reset code right now. Please try again.");
    expect(alert.textContent).not.toMatch(/econnreset/i);
  });

  it("never exposes the raw Supabase error message anywhere in the UI", async () => {
    resetPasswordForEmailMock.mockResolvedValue({
      data: null,
      error: new Error("SMTP server rejected request: 550 mailbox unavailable"),
    });
    render(<ForgotPasswordForm />);

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "buyer@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /send code/i }));

    await screen.findByRole("alert");
    expect(document.body.textContent).not.toMatch(/smtp|mailbox|550/i);
  });

  it("keeps the typed email in the input so the user can retry", async () => {
    resetPasswordForEmailMock.mockResolvedValue({ data: null, error: new Error("Network request failed") });
    render(<ForgotPasswordForm />);

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "buyer@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /send code/i }));

    await screen.findByRole("alert");
    expect(screen.getByLabelText("Email")).toHaveValue("buyer@example.com");
  });

  it("a retry after a fixed transient failure succeeds and advances normally", async () => {
    resetPasswordForEmailMock.mockResolvedValueOnce({ data: null, error: new Error("Network request failed") });
    resetPasswordForEmailMock.mockResolvedValueOnce({ data: {}, error: null });
    render(<ForgotPasswordForm />);

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "buyer@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /send code/i }));
    await screen.findByRole("alert");

    fireEvent.click(screen.getByRole("button", { name: /send code/i }));
    await screen.findByLabelText("Recovery code");

    expect(resetPasswordForEmailMock).toHaveBeenCalledTimes(2);
  });
});

describe("Step 2 -- 6-digit recovery code", () => {
  it("renders the shared 6-digit OtpCodeInput (numeric, one-time-code, max 6 digits)", async () => {
    await goToCodeStep();
    const input = screen.getByLabelText("Recovery code");
    expect(input).toHaveAttribute("inputMode", "numeric");
    expect(input).toHaveAttribute("autoComplete", "one-time-code");
    expect(input).toHaveAttribute("maxLength", "6");
  });

  it("verifies via verifyOtp({ email, token, type: 'recovery' })", async () => {
    await goToCodeStep("buyer@example.com");
    fireEvent.change(screen.getByLabelText("Recovery code"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: /verify code/i }));

    await waitFor(() =>
      expect(verifyOtpMock).toHaveBeenCalledWith({ email: "buyer@example.com", token: "123456", type: "recovery" }),
    );
  });

  it("shows the safe invalid/expired copy on a failed verification, never the raw Supabase error", async () => {
    verifyOtpMock.mockResolvedValue({ data: null, error: new Error("Token has expired or is invalid") });
    await goToCodeStep();
    fireEvent.change(screen.getByLabelText("Recovery code"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: /verify code/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(INVALID_CODE_MESSAGE);
    expect(alert.textContent).not.toMatch(/token has expired or is invalid/i);
  });

  it("clears the code field after a failed verification", async () => {
    verifyOtpMock.mockResolvedValue({ data: null, error: new Error("invalid") });
    await goToCodeStep();
    fireEvent.change(screen.getByLabelText("Recovery code"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: /verify code/i }));

    await screen.findByRole("alert");
    expect(screen.getByLabelText("Recovery code")).toHaveValue("");
  });

  it("moves to the new-password step on successful verification", async () => {
    await goToCodeStepAndVerify();
    expect(screen.getByLabelText("New password")).toBeInTheDocument();
    expect(screen.getByLabelText("Confirm new password")).toBeInTheDocument();
  });

  it("'Use a different email' returns to the email step", async () => {
    await goToCodeStep("buyer@example.com");
    fireEvent.click(screen.getByRole("button", { name: /use a different email/i }));

    expect(screen.getByLabelText("Email")).toBeInTheDocument();
  });
});

describe("Step 2 -- resend code", () => {
  it("starts with a 60-second cooldown disabling resend immediately after the first send", async () => {
    await goToCodeStep();
    expect(screen.getByRole("button", { name: /resend code in 60s/i })).toBeDisabled();
  });

  it("re-enables resend once the cooldown reaches zero", async () => {
    vi.useFakeTimers();
    await goToCodeStepFakeTimers();
    await advanceCooldownToZero();

    expect(screen.getByRole("button", { name: /^resend code$/i })).not.toBeDisabled();
  });

  it("resend calls resetPasswordForEmail again and restarts the 60-second cooldown", async () => {
    vi.useFakeTimers();
    await goToCodeStepFakeTimers("buyer@example.com");
    await advanceCooldownToZero();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^resend code$/i }));
    });
    expect(resetPasswordForEmailMock).toHaveBeenCalledTimes(2);

    expect(screen.getByRole("button", { name: /resend code in 60s/i })).toBeDisabled();
  });

  it("a failed resend shows the rate-limit copy and does not falsely restart the cooldown or claim success", async () => {
    vi.useFakeTimers();
    await goToCodeStepFakeTimers();
    await advanceCooldownToZero();

    resetPasswordForEmailMock.mockResolvedValue({ data: null, error: new Error("rate limited") });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^resend code$/i }));
    });

    expect(screen.getByRole("alert")).toHaveTextContent(RATE_LIMIT_MESSAGE);
    expect(screen.queryByText("A new code was sent.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^resend code$/i })).not.toBeDisabled();
  });
});

describe("Step 3 -- set a new password", () => {
  it("requires a new password of at least 6 characters", async () => {
    await goToCodeStepAndVerify();
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "abc" } });
    fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "abc" } });
    fireEvent.click(screen.getByRole("button", { name: /update password/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Password must be at least 6 characters.");
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  it("requires the confirmation to match", async () => {
    await goToCodeStepAndVerify();
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "abcdef1" } });
    fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "abcdef2" } });
    fireEvent.click(screen.getByRole("button", { name: /update password/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Passwords don't match.");
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  it("calls updateUser({ password }) only, never with current_password", async () => {
    await goToCodeStepAndVerify();
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "newpass1" } });
    fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "newpass1" } });
    fireEvent.click(screen.getByRole("button", { name: /update password/i }));

    await waitFor(() => expect(updateUserMock).toHaveBeenCalledWith({ password: "newpass1" }));
    const callArg = updateUserMock.mock.calls[0]![0];
    expect(callArg).not.toHaveProperty("current_password");
  });

  it("disables the submit button while updating", async () => {
    let resolveUpdate: (value: { data: object; error: null }) => void = () => {};
    updateUserMock.mockImplementation(() => new Promise((resolve) => (resolveUpdate = resolve)));
    await goToCodeStepAndVerify();

    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "newpass1" } });
    fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "newpass1" } });
    fireEvent.click(screen.getByRole("button", { name: /update password/i }));

    await waitFor(() => expect(screen.getByRole("button", { name: /updating/i })).toBeDisabled());
    resolveUpdate({ data: {}, error: null });
  });
});

describe("Step-by-step copy (title/subtitle)", () => {
  it("Step 1 keeps its title and subtitle", () => {
    render(<ForgotPasswordForm />);
    expect(screen.getByRole("heading", { name: "Forgot your password?" })).toBeInTheDocument();
    expect(screen.getByText("Enter your email and we'll send you a password reset code.")).toBeInTheDocument();
  });

  it("Step 2 says 'Check your email' with the new 6-digit-code subtitle", async () => {
    await goToCodeStep();
    expect(screen.getByRole("heading", { name: "Check your email" })).toBeInTheDocument();
    expect(screen.getByText("Enter the 6-digit password reset code we sent to your email.")).toBeInTheDocument();
  });

  it("the stale step-1 (email-entry) subtitle is not shown on step 2", async () => {
    await goToCodeStep();
    expect(screen.queryByText("Enter your email and we'll send you a password reset code.")).not.toBeInTheDocument();
  });

  it("Step 2 never displays the submitted email address", async () => {
    await goToCodeStep("buyer@example.com");
    expect(screen.queryByText("buyer@example.com")).not.toBeInTheDocument();
  });

  it("Step 3 says 'Create a new password' with its own subtitle", async () => {
    await goToCodeStepAndVerify();
    expect(screen.getByRole("heading", { name: "Create a new password" })).toBeInTheDocument();
    expect(screen.getByText("Choose a new password for your Preshopps account.")).toBeInTheDocument();
  });
});

describe("Step 3 -- password visibility toggles", () => {
  it("New password starts hidden", async () => {
    await goToCodeStepAndVerify();
    expect(screen.getByLabelText("New password")).toHaveAttribute("type", "password");
  });

  it("Confirm new password starts hidden", async () => {
    await goToCodeStepAndVerify();
    expect(screen.getByLabelText("Confirm new password")).toHaveAttribute("type", "password");
  });

  it("toggling New password's visibility does not affect Confirm new password", async () => {
    await goToCodeStepAndVerify();
    fireEvent.click(screen.getByRole("button", { name: "Show new password" }));

    expect(screen.getByLabelText("New password")).toHaveAttribute("type", "text");
    expect(screen.getByLabelText("Confirm new password")).toHaveAttribute("type", "password");
  });

  it("toggling Confirm new password's visibility does not affect New password", async () => {
    await goToCodeStepAndVerify();
    fireEvent.click(screen.getByRole("button", { name: "Show password confirmation" }));

    expect(screen.getByLabelText("Confirm new password")).toHaveAttribute("type", "text");
    expect(screen.getByLabelText("New password")).toHaveAttribute("type", "password");
  });

  it("the accessible label switches from Show to Hide once toggled", async () => {
    await goToCodeStepAndVerify();
    fireEvent.click(screen.getByRole("button", { name: "Show new password" }));

    expect(screen.getByRole("button", { name: "Hide new password" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show new password" })).not.toBeInTheDocument();
  });

  it("the toggle button is type=button and never submits the form", async () => {
    await goToCodeStepAndVerify();
    const toggle = screen.getByRole("button", { name: "Show new password" });
    expect(toggle).toHaveAttribute("type", "button");

    fireEvent.click(toggle);
    expect(updateUserMock).not.toHaveBeenCalled();
  });
});

describe("Step 3 -- success is a mandatory global sign-out", () => {
  async function submitNewPassword() {
    await goToCodeStepAndVerify();
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "newpass1" } });
    fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "newpass1" } });
    fireEvent.click(screen.getByRole("button", { name: /update password/i }));
  }

  it("calls signOut({ scope: 'global' }) after a successful password update", async () => {
    await submitNewPassword();
    await waitFor(() => expect(signOutMock).toHaveBeenCalledWith({ scope: "global" }));
  });

  it("redirects to /sign-in once sign-out succeeds", async () => {
    await submitNewPassword();
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/sign-in"));
  });

  it("clears the password fields and no longer renders them once redirecting", async () => {
    await submitNewPassword();
    await waitFor(() => expect(pushMock).toHaveBeenCalled());
    expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Confirm new password")).not.toBeInTheDocument();
  });

  it("shows safe recovery guidance and does not redirect when the global sign-out fails", async () => {
    signOutMock.mockResolvedValue({ error: new Error("network error") });
    await submitNewPassword();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/couldn't finish signing you out automatically/i);
    expect(alert.textContent).not.toMatch(/network error/i);
    expect(pushMock).not.toHaveBeenCalledWith("/sign-in");
  });

  it("does not auto-retry sign-out on failure", async () => {
    signOutMock.mockResolvedValue({ error: new Error("network error") });
    await submitNewPassword();

    await screen.findByRole("alert");
    expect(signOutMock).toHaveBeenCalledTimes(1);
  });
});

describe("No sensitive value is ever logged", () => {
  it("does not log the password, code, or a raw error message when sign-out fails", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    signOutMock.mockResolvedValue({ error: new Error("some raw supabase detail") });

    await goToCodeStepAndVerify();
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "newpass1" } });
    fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "newpass1" } });
    fireEvent.click(screen.getByRole("button", { name: /update password/i }));

    await screen.findByRole("alert");

    for (const call of consoleErrorSpy.mock.calls) {
      const serialized = call.map((arg) => String(arg)).join(" ");
      expect(serialized).not.toContain("newpass1");
      expect(serialized).not.toContain("123456");
    }

    consoleErrorSpy.mockRestore();
  });

  it("does not log anything at all on the happy path", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await goToCodeStepAndVerify();
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "newpass1" } });
    fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "newpass1" } });
    fireEvent.click(screen.getByRole("button", { name: /update password/i }));

    await waitFor(() => expect(pushMock).toHaveBeenCalled());

    expect(consoleErrorSpy).not.toHaveBeenCalled();
    expect(consoleLogSpy).not.toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
    consoleLogSpy.mockRestore();
  });
});
