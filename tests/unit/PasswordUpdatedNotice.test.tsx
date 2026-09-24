import { StrictMode } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PasswordUpdatedNotice } from "@/components/auth/PasswordUpdatedNotice";
import { PASSWORD_UPDATED_STORAGE_KEY, markPasswordJustUpdated } from "@/lib/auth/password-updated-flag";

/** Strips comments before a "must NOT contain X" source assertion, so it
 * can't false-positive on this file's own doc comments explaining (by
 * name) the mechanisms it deliberately does NOT use. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

beforeEach(() => {
  sessionStorage.clear();
});

describe("PasswordUpdatedNotice", () => {
  it("shows the explanation when ChangePasswordForm's own flag was set in this tab", async () => {
    markPasswordJustUpdated();

    render(<PasswordUpdatedNotice />);

    expect(await screen.findByRole("status")).toHaveTextContent("Password updated. Sign in with your new password.");
  });

  it("renders nothing on the ordinary sign-in pageview -- no flag was ever set", async () => {
    render(<PasswordUpdatedNotice />);

    // Give the mount-time check a chance to actually run before asserting
    // absence is meaningful, not just "hasn't happened yet".
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
  });

  it("clears the sessionStorage flag after showing the explanation", async () => {
    markPasswordJustUpdated();

    render(<PasswordUpdatedNotice />);

    await screen.findByRole("status");
    expect(sessionStorage.getItem(PASSWORD_UPDATED_STORAGE_KEY)).toBeNull();
  });

  it("does not reappear on a fresh mount once the flag has already been cleared -- proves a later reload/revisit of /sign-in in the same tab never repeats it", async () => {
    markPasswordJustUpdated();
    const { unmount } = render(<PasswordUpdatedNotice />);
    await screen.findByRole("status");
    unmount();

    // A second mount, same tab/session, with nothing re-setting the flag.
    render(<PasswordUpdatedNotice />);

    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
  });

  it("concern 2 (does not disappear after cleanup): the explanation stays visible across later, unrelated re-renders of the same mounted instance, even though the underlying sessionStorage flag has already been cleared", async () => {
    markPasswordJustUpdated();
    const { rerender } = render(<PasswordUpdatedNotice />);

    await screen.findByRole("status");
    expect(sessionStorage.getItem(PASSWORD_UPDATED_STORAGE_KEY)).toBeNull();

    // Several unrelated re-renders of the exact same instance -- nothing
    // about this should ever re-consult sessionStorage or hide the
    // already-shown banner.
    rerender(<PasswordUpdatedNotice />);
    rerender(<PasswordUpdatedNotice />);
    rerender(<PasswordUpdatedNotice />);

    expect(screen.getByRole("status")).toHaveTextContent("Password updated. Sign in with your new password.");
  });

  it("an arbitrary/forged sessionStorage value (never the exact flag markPasswordJustUpdated writes) never shows the explanation", async () => {
    sessionStorage.setItem(PASSWORD_UPDATED_STORAGE_KEY, "true");

    render(<PasswordUpdatedNotice />);

    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
  });

  it("concern 1 (spoofable marker): visiting /sign-in?passwordUpdated=1 directly, with no real completed flow (no sessionStorage flag), never shows the explanation", async () => {
    window.history.pushState({}, "", "/sign-in?passwordUpdated=1");

    render(<PasswordUpdatedNotice />);

    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
  });

  it("never imports next/navigation or reads the URL at all -- structurally cannot be driven by a shared/bookmarked link's query string", () => {
    const source = stripComments(readFileSync(path.join(process.cwd(), "components/auth/PasswordUpdatedNotice.tsx"), "utf-8"));
    expect(source).not.toMatch(/from ["']next\/navigation["']/);
    expect(source).not.toMatch(/router\.replace/);
    expect(source).not.toMatch(/\blocation\.search\b/);
  });

  it("never subscribes to sessionStorage as a live external store (no useSyncExternalStore) -- the rendered value is captured once, not re-derived on every render", () => {
    const source = stripComments(readFileSync(path.join(process.cwd(), "components/auth/PasswordUpdatedNotice.tsx"), "utf-8"));
    expect(source).not.toMatch(/useSyncExternalStore/);
  });

  it("React Strict Mode's dev-only double-invoke of the mount effect never double-shows the banner and never leaves the flag uncleared", async () => {
    markPasswordJustUpdated();

    render(
      <StrictMode>
        <PasswordUpdatedNotice />
      </StrictMode>,
    );

    expect(await screen.findByRole("status")).toBeInTheDocument();
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(sessionStorage.getItem(PASSWORD_UPDATED_STORAGE_KEY)).toBeNull();
  });

  it("unmounting before the deferred mount-time read resolves never consumes the flag -- a later, real visit still shows (and then clears) it exactly once", async () => {
    markPasswordJustUpdated();
    const { unmount } = render(<PasswordUpdatedNotice />);
    // Unmount synchronously, before the Promise.resolve().then(...)
    // deferred read has any chance to run -- simulates navigating away
    // from /sign-in faster than this component's own mount-time check.
    unmount();

    // Flush any pending microtask from that aborted mount so its own
    // `cancelled` guard has definitely had a chance to fire.
    await Promise.resolve();
    await Promise.resolve();

    // The aborted mount must never have consumed the flag -- it bailed via
    // `cancelled` before ever reading/clearing it.
    expect(sessionStorage.getItem(PASSWORD_UPDATED_STORAGE_KEY)).toBe("1");

    // A later, real mount (nothing re-sets the flag) still shows it --
    // deferred, not lost -- and this time actually clears it.
    render(<PasswordUpdatedNotice />);
    expect(await screen.findByRole("status")).toBeInTheDocument();
    expect(sessionStorage.getItem(PASSWORD_UPDATED_STORAGE_KEY)).toBeNull();
  });
});
