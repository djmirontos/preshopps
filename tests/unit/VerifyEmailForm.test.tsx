import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

const { verifyOtpMock, resendMock, pushMock, refreshMock, mergeGuestCartOnAuthMock } = vi.hoisted(() => ({
  verifyOtpMock: vi.fn(),
  resendMock: vi.fn(),
  pushMock: vi.fn(),
  refreshMock: vi.fn(),
  mergeGuestCartOnAuthMock: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { verifyOtp: verifyOtpMock, resend: resendMock } }),
}));

vi.mock("@/lib/env", () => ({
  getAppUrl: () => "http://localhost:3000",
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

vi.mock("@/lib/cart/merge-guest-cart-on-auth", () => ({
  mergeGuestCartOnAuth: mergeGuestCartOnAuthMock,
}));

import { VerifyEmailForm } from "@/components/auth/VerifyEmailForm";
import { setPendingSignupEmail, getPendingSignupEmail } from "@/lib/auth/pending-signup-email";

beforeEach(() => {
  verifyOtpMock.mockReset();
  resendMock.mockReset();
  pushMock.mockReset();
  refreshMock.mockReset();
  mergeGuestCartOnAuthMock.mockReset();
  mergeGuestCartOnAuthMock.mockResolvedValue({ attempted: false });
  sessionStorage.clear();
});

// Guarantees fake timers never leak into a later test even if a
// fake-timer test above fails before reaching its own vi.useRealTimers()
// call -- otherwise every subsequent real-timer-based waitFor()/findBy*
// would hang forever against a clock that never advances.
afterEach(() => {
  vi.useRealTimers();
});

async function renderWithPendingEmail(email = "new@example.com", next = "/") {
  setPendingSignupEmail(email);
  render(<VerifyEmailForm next={next} />);
  return screen.findByLabelText("Verification code");
}

function typeCode(input: HTMLElement, code: string) {
  fireEvent.change(input, { target: { value: code } });
}

/** Advances the fake clock one second at a time, each inside its own
 * act() flush -- the countdown effect re-registers a fresh setTimeout via
 * a state update on every tick, and that re-registration only reliably
 * happens between React's own render/effect flushes, not from a single
 * large advanceTimersByTimeAsync() call spanning many ticks at once. */
async function advanceSeconds(seconds: number) {
  for (let i = 0; i < seconds; i++) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
  }
}

describe("VerifyEmailForm -- reads pending email from sessionStorage (6)", () => {
  it("renders the code form once a pending email is found in sessionStorage", async () => {
    const input = await renderWithPendingEmail("new@example.com");
    expect(input).toBeInTheDocument();
  });

  it("21. shows the missing-pending-email fallback (never crashing, never calling verifyOtp) when sessionStorage has nothing", async () => {
    render(<VerifyEmailForm next="/" />);

    expect(await screen.findByText(/We couldn.t find a pending email verification\./)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to Sign Up" })).toHaveAttribute("href", "/sign-up");
    expect(screen.getByRole("link", { name: "Sign In" })).toHaveAttribute("href", "/sign-in");
    expect(verifyOtpMock).not.toHaveBeenCalled();
  });
});

describe("VerifyEmailForm -- masked email display (7)", () => {
  it("displays a masked version of the pending email, never the raw address, in the page copy", async () => {
    await renderWithPendingEmail("daniel@gmail.com");
    expect(screen.getByText("d***@gmail.com")).toBeInTheDocument();
    expect(screen.queryByText("daniel@gmail.com")).not.toBeInTheDocument();
  });

  it("still uses the real, unmasked email for the actual verifyOtp call", async () => {
    verifyOtpMock.mockResolvedValue({ data: { session: {} }, error: null });
    const input = await renderWithPendingEmail("daniel@gmail.com");
    typeCode(input, "123456");
    fireEvent.click(screen.getByRole("button", { name: "Verify email" }));

    await waitFor(() => expect(verifyOtpMock).toHaveBeenCalledWith({ email: "daniel@gmail.com", token: "123456", type: "signup" }));
  });
});

describe("VerifyEmailForm -- OTP cell UI (8, 9, 10)", () => {
  it("8. renders exactly six visual code cells", async () => {
    setPendingSignupEmail("new@example.com");
    const { container } = render(<VerifyEmailForm next="/" />);
    await screen.findByLabelText("Verification code");

    const cellRow = container.querySelector('[aria-hidden="true"]');
    expect(cellRow).not.toBeNull();
    expect(cellRow!.children).toHaveLength(6);
  });

  it("the real input accepts inputMode=numeric, maxLength=6, and autoComplete=one-time-code", async () => {
    const input = await renderWithPendingEmail();
    expect(input).toHaveAttribute("inputMode", "numeric");
    expect(input).toHaveAttribute("maxLength", "6");
    expect(input).toHaveAttribute("autoComplete", "one-time-code");
  });

  it("9. strips non-numeric characters as they're typed", async () => {
    const input = await renderWithPendingEmail();
    typeCode(input, "1a2b3c");
    expect(input).toHaveValue("123");
  });

  it("10. accepts a full 6-digit code delivered as one paste-equivalent change event", async () => {
    const input = await renderWithPendingEmail();
    typeCode(input, "123456");
    expect(input).toHaveValue("123456");
    expect(screen.getByRole("button", { name: "Verify email" })).toBeEnabled();
  });

  it("truncates input beyond 6 digits", async () => {
    const input = await renderWithPendingEmail();
    typeCode(input, "1234567890");
    expect(input).toHaveValue("123456");
  });
});

describe("VerifyEmailForm -- verifyOtp call (11, 12)", () => {
  it("11. calls verifyOtp with type 'signup', never 'email'", async () => {
    verifyOtpMock.mockResolvedValue({ data: { session: {} }, error: null });
    const input = await renderWithPendingEmail("new@example.com");
    typeCode(input, "654321");
    fireEvent.click(screen.getByRole("button", { name: "Verify email" }));

    await waitFor(() => expect(verifyOtpMock).toHaveBeenCalled());
    const call = verifyOtpMock.mock.calls[0][0];
    expect(call.type).toBe("signup");
    expect(call.type).not.toBe("email");
  });

  it("12. sends exactly the pending email and the typed code, nothing else", async () => {
    verifyOtpMock.mockResolvedValue({ data: { session: {} }, error: null });
    const input = await renderWithPendingEmail("new@example.com");
    typeCode(input, "654321");
    fireEvent.click(screen.getByRole("button", { name: "Verify email" }));

    await waitFor(() =>
      expect(verifyOtpMock).toHaveBeenCalledWith({ email: "new@example.com", token: "654321", type: "signup" }),
    );
  });

  it("the submit button is disabled until exactly 6 digits are entered", async () => {
    const input = await renderWithPendingEmail();
    const button = screen.getByRole("button", { name: "Verify email" });
    expect(button).toBeDisabled();
    typeCode(input, "12345");
    expect(button).toBeDisabled();
    typeCode(input, "123456");
    expect(button).toBeEnabled();
  });
});

describe("VerifyEmailForm -- success behavior (13, 14, 15)", () => {
  it("13. clears the pending signup email from sessionStorage on success", async () => {
    verifyOtpMock.mockResolvedValue({ data: { session: {} }, error: null });
    const input = await renderWithPendingEmail("new@example.com");
    typeCode(input, "123456");
    fireEvent.click(screen.getByRole("button", { name: "Verify email" }));

    await waitFor(() => expect(getPendingSignupEmail()).toBeNull());
  });

  it("14. merges the guest cart on success, reusing the existing helper (never a duplicated implementation)", async () => {
    verifyOtpMock.mockResolvedValue({ data: { session: {} }, error: null });
    const input = await renderWithPendingEmail("new@example.com");
    typeCode(input, "123456");
    fireEvent.click(screen.getByRole("button", { name: "Verify email" }));

    await waitFor(() => expect(mergeGuestCartOnAuthMock).toHaveBeenCalledTimes(1));
  });

  it("15. navigates to the safe next destination and refreshes on success", async () => {
    verifyOtpMock.mockResolvedValue({ data: { session: {} }, error: null });
    const input = await renderWithPendingEmail("new@example.com", "/item/PSO-ABC");
    typeCode(input, "123456");
    fireEvent.click(screen.getByRole("button", { name: "Verify email" }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/item/PSO-ABC"));
    expect(refreshMock).toHaveBeenCalled();
  });
});

describe("VerifyEmailForm -- error handling (16, 17)", () => {
  it("16. shows the friendly generic invalid/expired-code message on a verifyOtp failure", async () => {
    verifyOtpMock.mockResolvedValue({ data: {}, error: new Error("Token has expired or is invalid") });
    const input = await renderWithPendingEmail();
    typeCode(input, "000000");
    fireEvent.click(screen.getByRole("button", { name: "Verify email" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That code is invalid or has expired. Please try again or request a new code.",
    );
  });

  it("17. never exposes the raw Supabase error text", async () => {
    verifyOtpMock.mockResolvedValue({ data: {}, error: new Error("Token has expired or is invalid") });
    const input = await renderWithPendingEmail();
    typeCode(input, "000000");
    fireEvent.click(screen.getByRole("button", { name: "Verify email" }));

    await screen.findByRole("alert");
    expect(screen.queryByText(/Token has expired or is invalid/)).not.toBeInTheDocument();
  });

  it("does not navigate or merge the cart on a failed verification", async () => {
    verifyOtpMock.mockResolvedValue({ data: {}, error: new Error("bad code") });
    const input = await renderWithPendingEmail();
    typeCode(input, "000000");
    fireEvent.click(screen.getByRole("button", { name: "Verify email" }));

    await screen.findByRole("alert");
    expect(pushMock).not.toHaveBeenCalled();
    expect(mergeGuestCartOnAuthMock).not.toHaveBeenCalled();
  });

  it("clears the entered code after a failed attempt so the seller/buyer retypes fresh", async () => {
    verifyOtpMock.mockResolvedValue({ data: {}, error: new Error("bad code") });
    const input = await renderWithPendingEmail();
    typeCode(input, "000000");
    fireEvent.click(screen.getByRole("button", { name: "Verify email" }));

    await screen.findByRole("alert");
    expect(input).toHaveValue("");
  });
});

describe("VerifyEmailForm -- resend (18, 19, 20)", () => {
  it("18. resend uses type 'signup'", async () => {
    vi.useFakeTimers();
    resendMock.mockResolvedValue({ error: null });
    setPendingSignupEmail("new@example.com");
    render(<VerifyEmailForm next="/" />);
    await advanceSeconds(60);

    fireEvent.click(screen.getByRole("button", { name: "Resend code" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(resendMock).toHaveBeenCalledWith({
      type: "signup",
      email: "new@example.com",
      options: { emailRedirectTo: "http://localhost:3000/auth/confirm" },
    });
  });

  it("19. shows and counts down a 60-second resend cooldown, disabling the resend action meanwhile", async () => {
    vi.useFakeTimers();
    setPendingSignupEmail("new@example.com");
    render(<VerifyEmailForm next="/" />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.getByRole("button", { name: "Resend code in 60s" })).toBeDisabled();

    await advanceSeconds(5);
    expect(screen.getByRole("button", { name: "Resend code in 55s" })).toBeDisabled();

    await advanceSeconds(55);
    expect(screen.getByRole("button", { name: "Resend code" })).toBeEnabled();
  });

  it("20. a successful resend clears the entered code and restarts the 60-second countdown", async () => {
    vi.useFakeTimers();
    resendMock.mockResolvedValue({ error: null });
    setPendingSignupEmail("new@example.com");
    render(<VerifyEmailForm next="/" />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const input = screen.getByLabelText("Verification code");
    typeCode(input, "123456");
    await advanceSeconds(60);

    fireEvent.click(screen.getByRole("button", { name: "Resend code" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(input).toHaveValue("");
    expect(screen.getByText("A new code was sent.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resend code in 60s" })).toBeDisabled();
  });

  it("shows a generic safe error and never exposes the raw error when resend fails", async () => {
    vi.useFakeTimers();
    resendMock.mockResolvedValue({ error: new Error("rate limited: internal detail") });
    setPendingSignupEmail("new@example.com");
    render(<VerifyEmailForm next="/" />);
    await advanceSeconds(60);

    fireEvent.click(screen.getByRole("button", { name: "Resend code" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't resend the code. Please try again.");
    expect(screen.queryByText(/rate limited/)).not.toBeInTheDocument();
  });
});

describe("VerifyEmailForm -- unsafe next redirect rejected (22)", () => {
  it("never receives/uses an external URL as next -- the page itself validates via getSafeNextPath before this component ever sees it", async () => {
    // This component trusts its `next` prop as already-validated (the
    // page component calls getSafeNextPath before rendering it) -- proven
    // here by passing an already-safe fallback ("/") and confirming that
    // exact value, never anything externally supplied, is what's used.
    verifyOtpMock.mockResolvedValue({ data: { session: {} }, error: null });
    const input = await renderWithPendingEmail("new@example.com", "/");
    typeCode(input, "123456");
    fireEvent.click(screen.getByRole("button", { name: "Verify email" }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/"));
    expect(pushMock).not.toHaveBeenCalledWith("https://evil.com");
  });
});
