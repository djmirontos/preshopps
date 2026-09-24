import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

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

import { ChangePasswordForm } from "@/components/account/ChangePasswordForm";
import { PASSWORD_UPDATED_STORAGE_KEY } from "@/lib/auth/password-updated-flag";

function renderForm() {
  const onUpdatingChange = vi.fn();
  const utils = render(<ChangePasswordForm onUpdatingChange={onUpdatingChange} />);
  return { ...utils, onUpdatingChange };
}

function fillAndSubmit(overrides: Partial<{ current: string; next: string; confirm: string }> = {}) {
  const { current = "old-password", next = "password1", confirm = next } = overrides;
  fireEvent.change(screen.getByLabelText("Current password"), { target: { value: current } });
  fireEvent.change(screen.getByLabelText("New password"), { target: { value: next } });
  fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: confirm } });
  fireEvent.click(screen.getByRole("button", { name: /update password/i }));
}

beforeEach(() => {
  vi.clearAllMocks();
  updateUserMock.mockResolvedValue({ data: {}, error: null });
  signOutMock.mockResolvedValue({ error: null });
  sessionStorage.clear();
});

describe("ChangePasswordForm -- asks for the current password directly, no reauthentication OTP", () => {
  it("renders a Current password field", () => {
    renderForm();
    expect(screen.getByLabelText("Current password")).toBeInTheDocument();
  });

  it("never renders a verification-code input", () => {
    renderForm();
    expect(screen.queryByLabelText(/verification code/i)).not.toBeInTheDocument();
  });

  it("never renders a Resend code control", () => {
    renderForm();
    expect(screen.queryByRole("button", { name: /resend/i })).not.toBeInTheDocument();
  });

  it("does not call reauthenticate on mount -- there is no such call in this component at all", () => {
    // createClient() from @/lib/supabase/client is mocked with only
    // updateUser/signOut -- if the component tried to call
    // `.auth.reauthenticate()` on mount, this render would throw
    // ("reauthenticate is not a function").
    expect(() => renderForm()).not.toThrow();
  });
});

describe("ChangePasswordForm -- validation", () => {
  it("requires the current password", () => {
    renderForm();
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "password1" } });
    fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "password1" } });
    fireEvent.click(screen.getByRole("button", { name: /update password/i }));

    expect(screen.getByText("Enter your current password.")).toBeInTheDocument();
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  it("enforces the existing 6-character minimum for the new password", () => {
    renderForm();
    fillAndSubmit({ next: "abc", confirm: "abc" });

    expect(screen.getByText("Password must be at least 6 characters.")).toBeInTheDocument();
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  it("requires the confirmation to match", () => {
    renderForm();
    fillAndSubmit({ next: "password1", confirm: "password2" });

    expect(screen.getByText("Passwords don't match.")).toBeInTheDocument();
    expect(updateUserMock).not.toHaveBeenCalled();
  });
});

describe("ChangePasswordForm -- updateUser receives current_password", () => {
  it("calls supabase.auth.updateUser({ password, current_password })", async () => {
    renderForm();
    fillAndSubmit({ current: "old-password", next: "password1" });

    await waitFor(() => expect(updateUserMock).toHaveBeenCalledWith({ password: "password1", current_password: "old-password" }));
  });

  it("never calls signInWithPassword or any reauthenticate method", async () => {
    renderForm();
    fillAndSubmit();
    await waitFor(() => expect(updateUserMock).toHaveBeenCalled());
    // The mocked client only exposes updateUser/signOut -- calling
    // anything else would throw, so a clean pass here already proves
    // this. Explicit assertion for clarity:
    expect(updateUserMock).toHaveBeenCalledTimes(1);
  });
});

describe("ChangePasswordForm -- wrong current password gets safe copy", () => {
  it("shows 'The current password is incorrect.' for an invalid-credentials-style error", async () => {
    updateUserMock.mockResolvedValue({ data: null, error: new Error("Invalid login credentials") });
    renderForm();
    fillAndSubmit();

    expect(await screen.findByText("The current password is incorrect.")).toBeInTheDocument();
    expect(signOutMock).not.toHaveBeenCalled();
  });

  it("never shows the raw Supabase error message", async () => {
    updateUserMock.mockResolvedValue({ data: null, error: new Error("Invalid login credentials") });
    renderForm();
    fillAndSubmit();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).not.toMatch(/invalid login credentials/i);
  });

  it("shows the generic update-failure copy for a non-credentials error", async () => {
    updateUserMock.mockResolvedValue({ data: null, error: new Error("Unexpected server error") });
    renderForm();
    fillAndSubmit();

    expect(await screen.findByText("We couldn't update your password. Please try again.")).toBeInTheDocument();
  });

  it("shows only its own existing error, never redirects, and never sets the passwordUpdated flag when updateUser fails", async () => {
    updateUserMock.mockResolvedValue({ data: null, error: new Error("Invalid login credentials") });
    renderForm();
    fillAndSubmit();

    await screen.findByText("The current password is incorrect.");
    expect(pushMock).not.toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();
    expect(screen.queryByText("Password updated. Signing you out…")).not.toBeInTheDocument();
    expect(sessionStorage.getItem(PASSWORD_UPDATED_STORAGE_KEY)).toBeNull();
  });
});

describe("ChangePasswordForm -- successful change triggers a mandatory global sign-out", () => {
  it("calls supabase.auth.signOut({ scope: 'global' }) after a successful update", async () => {
    renderForm();
    fillAndSubmit();

    await waitFor(() => expect(signOutMock).toHaveBeenCalledWith({ scope: "global" }));
  });

  it("redirects to plain /sign-in (no URL marker) after a successful global sign-out", async () => {
    renderForm();
    fillAndSubmit();

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/sign-in"));
    // Concern 1 fix: never a query-string marker anyone could type/share.
    expect(pushMock).not.toHaveBeenCalledWith(expect.stringContaining("?"));
  });

  it("sets the one-time passwordUpdated sessionStorage flag only after signOut itself has succeeded", async () => {
    renderForm();
    fillAndSubmit();

    await waitFor(() => expect(sessionStorage.getItem(PASSWORD_UPDATED_STORAGE_KEY)).toBe("1"));
  });

  it("sets the passwordUpdated flag before pushing the redirect, so PasswordUpdatedNotice can already read it once /sign-in mounts", async () => {
    renderForm();
    fillAndSubmit();

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/sign-in"));
    // Both are async-resolved by the time push fires; the flag must not
    // still be unset at that point.
    expect(sessionStorage.getItem(PASSWORD_UPDATED_STORAGE_KEY)).toBe("1");
  });

  it("review finding: still redirects even if sessionStorage is entirely unavailable/throwing -- markPasswordJustUpdated's own best-effort guard must never block navigation after a successful password change", async () => {
    const original = Object.getOwnPropertyDescriptor(window, "sessionStorage");
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      get() {
        throw new Error("SecurityError: sessionStorage is not available");
      },
    });

    try {
      renderForm();
      fillAndSubmit();

      await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/sign-in"));
      expect(await screen.findByText("Password updated. Signing you out…")).toBeInTheDocument();
    } finally {
      Object.defineProperty(window, "sessionStorage", original!);
    }
  });

  it("does not show a lingering success page while still signed in -- the visible state is a transient redirecting notice", async () => {
    renderForm();
    fillAndSubmit();

    expect(await screen.findByText("Password updated. Signing you out…")).toBeInTheDocument();
    expect(screen.queryByLabelText("Current password")).not.toBeInTheDocument();
  });
});

describe("ChangePasswordForm -- global sign-out failure after a successful password change", () => {
  it("does not claim success and shows safe recovery copy instead of redirecting", async () => {
    signOutMock.mockResolvedValue({ error: new Error("network error") });
    renderForm();
    fillAndSubmit();

    expect(
      await screen.findByText(
        "Your password was updated, but we couldn't sign out your other sessions automatically. For your security, please use \"Sign out other devices\" below.",
      ),
    ).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("preserves signOutFailedNotice, never redirects/refreshes, and never sets the passwordUpdated flag -- PasswordUpdatedNotice can never show for an incomplete flow", async () => {
    signOutMock.mockResolvedValue({ error: new Error("network error") });
    renderForm();
    fillAndSubmit();

    await screen.findByRole("alert");
    expect(pushMock).not.toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();
    expect(screen.queryByText("Password updated. Signing you out…")).not.toBeInTheDocument();
    expect(sessionStorage.getItem(PASSWORD_UPDATED_STORAGE_KEY)).toBeNull();
  });

  it("does not automatically retry the sign-out call", async () => {
    signOutMock.mockResolvedValue({ error: new Error("network error") });
    renderForm();
    fillAndSubmit();

    await waitFor(() => expect(signOutMock).toHaveBeenCalledTimes(1));
    // Give any stray microtask a chance to run, then confirm no retry happened.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(signOutMock).toHaveBeenCalledTimes(1);
  });
});

describe("ChangePasswordForm -- password values are cleared and never persisted", () => {
  it("clears all three password fields from the DOM after a successful change", async () => {
    renderForm();
    fillAndSubmit();

    await screen.findByText("Password updated. Signing you out…");
    expect(screen.queryByDisplayValue("password1")).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("old-password")).not.toBeInTheDocument();
  });

  it("clears the current-password field after a failed attempt", async () => {
    updateUserMock.mockResolvedValue({ data: null, error: new Error("Invalid login credentials") });
    renderForm();
    fillAndSubmit({ current: "wrong-password" });

    await screen.findByText("The current password is incorrect.");
    expect(screen.getByLabelText("Current password")).toHaveValue("");
  });
});

describe("ChangePasswordForm -- password visibility toggles", () => {
  it("Current password starts hidden", () => {
    renderForm();
    expect(screen.getByLabelText("Current password")).toHaveAttribute("type", "password");
  });

  it("New password starts hidden", () => {
    renderForm();
    expect(screen.getByLabelText("New password")).toHaveAttribute("type", "password");
  });

  it("Confirm new password starts hidden", () => {
    renderForm();
    expect(screen.getByLabelText("Confirm new password")).toHaveAttribute("type", "password");
  });

  it("each toggle controls only its own field", () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Show new password" }));

    expect(screen.getByLabelText("New password")).toHaveAttribute("type", "text");
    expect(screen.getByLabelText("Current password")).toHaveAttribute("type", "password");
    expect(screen.getByLabelText("Confirm new password")).toHaveAttribute("type", "password");
  });

  it("toggling Current password does not reveal New password or the confirmation", () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Show current password" }));

    expect(screen.getByLabelText("Current password")).toHaveAttribute("type", "text");
    expect(screen.getByLabelText("New password")).toHaveAttribute("type", "password");
    expect(screen.getByLabelText("Confirm new password")).toHaveAttribute("type", "password");
  });

  it("the accessible label switches from Show to Hide once toggled", () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Show current password" }));

    expect(screen.getByRole("button", { name: "Hide current password" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show current password" })).not.toBeInTheDocument();
  });

  it("each of the three toggle buttons is type=button and never submits the form", () => {
    renderForm();
    const currentToggle = screen.getByRole("button", { name: "Show current password" });
    const newToggle = screen.getByRole("button", { name: "Show new password" });
    const confirmToggle = screen.getByRole("button", { name: "Show password confirmation" });

    expect(currentToggle).toHaveAttribute("type", "button");
    expect(newToggle).toHaveAttribute("type", "button");
    expect(confirmToggle).toHaveAttribute("type", "button");

    fireEvent.click(currentToggle);
    fireEvent.click(newToggle);
    fireEvent.click(confirmToggle);
    expect(updateUserMock).not.toHaveBeenCalled();
  });
});

describe("ChangePasswordForm -- loading / double-submit prevention", () => {
  it("disables the submit button while the request is pending", async () => {
    let resolveUpdate: (value: { data: object; error: null }) => void = () => {};
    updateUserMock.mockImplementation(() => new Promise((resolve) => (resolveUpdate = resolve)));
    renderForm();
    fillAndSubmit();

    await waitFor(() => expect(screen.getByRole("button", { name: /updating/i })).toBeDisabled());
    resolveUpdate({ data: {}, error: null });
  });

  it("notifies the parent while updating (used to lock the surrounding dialog from closing)", async () => {
    let resolveUpdate: (value: { data: object; error: null }) => void = () => {};
    updateUserMock.mockImplementation(() => new Promise((resolve) => (resolveUpdate = resolve)));
    const { onUpdatingChange } = renderForm();
    fillAndSubmit();

    await waitFor(() => expect(onUpdatingChange).toHaveBeenCalledWith(true));
    resolveUpdate({ data: {}, error: null });
    await waitFor(() => expect(onUpdatingChange).toHaveBeenLastCalledWith(false));
  });

  it("does not call updateUser a second time while the first call is still in flight", async () => {
    let resolveUpdate: (value: { data: object; error: null }) => void = () => {};
    updateUserMock.mockImplementation(() => new Promise((resolve) => (resolveUpdate = resolve)));
    renderForm();
    fillAndSubmit();

    await waitFor(() => expect(updateUserMock).toHaveBeenCalledTimes(1));
    fireEvent.submit(screen.getByRole("button", { name: /updating/i }).closest("form")!);
    resolveUpdate({ data: {}, error: null });

    await waitFor(() => expect(updateUserMock).toHaveBeenCalledTimes(1));
  });
});
