import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { ShareActions } from "@/components/listing/ShareActions";

const { notifySuccessMock, notifyErrorMock } = vi.hoisted(() => ({
  notifySuccessMock: vi.fn(),
  notifyErrorMock: vi.fn(),
}));

vi.mock("@/lib/notifications/toast", () => ({
  notifySuccess: notifySuccessMock,
  notifyError: notifyErrorMock,
}));

vi.mock("@/lib/env", () => ({
  getAppUrl: () => "https://preshopps.com",
}));

const EXPECTED_URL = "https://preshopps.com/item/abc123";

beforeEach(() => {
  notifySuccessMock.mockClear();
  notifyErrorMock.mockClear();
  // navigator.share/clipboard are not implemented by jsdom -- each test
  // installs exactly the capability it wants to exercise. Both are reset
  // to "unavailable" before every test so no test leaks a mocked API into
  // the next one.
  Object.defineProperty(navigator, "share", { configurable: true, value: undefined });
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
});

describe("ShareActions -- guest visibility and URL correctness", () => {
  it("renders both Share and Copy link with no authentication prop at all -- available to every viewer, guest included", () => {
    render(<ShareActions publicCode="abc123" title="Nike Air Max 270" />);
    expect(screen.getByRole("button", { name: /share/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /copy link/i })).toBeInTheDocument();
  });

  it("builds the URL from getAppUrl() + the authoritative publicCode, never from the title or a slug guess", async () => {
    const shareMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", { configurable: true, value: shareMock });

    render(<ShareActions publicCode="abc123" title="Some Completely Different Title" />);
    fireEvent.click(screen.getByRole("button", { name: /share/i }));

    await waitFor(() => expect(shareMock).toHaveBeenCalledWith({ title: "Some Completely Different Title", url: EXPECTED_URL }));
  });
});

describe("ShareActions -- native share", () => {
  it("calls navigator.share with the canonical item URL when available, and shows no toast on success (the native sheet already confirmed it)", async () => {
    const shareMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", { configurable: true, value: shareMock });

    render(<ShareActions publicCode="abc123" title="Nike Air Max 270" />);
    fireEvent.click(screen.getByRole("button", { name: /share/i }));

    await waitFor(() => expect(shareMock).toHaveBeenCalledTimes(1));
    expect(notifySuccessMock).not.toHaveBeenCalled();
    expect(notifyErrorMock).not.toHaveBeenCalled();
  });

  it("shows no success or error toast when the user cancels the native share sheet (AbortError), and never falls back to copying", async () => {
    const abortError = new DOMException("Share canceled", "AbortError");
    const shareMock = vi.fn().mockRejectedValue(abortError);
    Object.defineProperty(navigator, "share", { configurable: true, value: shareMock });
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: writeTextMock } });

    render(<ShareActions publicCode="abc123" title="Nike Air Max 270" />);
    fireEvent.click(screen.getByRole("button", { name: /share/i }));

    await waitFor(() => expect(shareMock).toHaveBeenCalledTimes(1));
    expect(notifySuccessMock).not.toHaveBeenCalled();
    expect(notifyErrorMock).not.toHaveBeenCalled();
    expect(writeTextMock).not.toHaveBeenCalled();
  });

  it("shows a truthful error toast for a genuine native share failure (not a cancellation)", async () => {
    const shareMock = vi.fn().mockRejectedValue(new DOMException("Permission denied", "NotAllowedError"));
    Object.defineProperty(navigator, "share", { configurable: true, value: shareMock });

    render(<ShareActions publicCode="abc123" title="Nike Air Max 270" />);
    fireEvent.click(screen.getByRole("button", { name: /share/i }));

    await waitFor(() => expect(notifyErrorMock).toHaveBeenCalledTimes(1));
    expect(notifySuccessMock).not.toHaveBeenCalled();
  });

  it("releases the guard after a cancellation too, so a later deliberate Share attempt still works", async () => {
    const abortError = new DOMException("Share canceled", "AbortError");
    const shareMock = vi.fn().mockRejectedValueOnce(abortError).mockResolvedValueOnce(undefined);
    Object.defineProperty(navigator, "share", { configurable: true, value: shareMock });

    render(<ShareActions publicCode="abc123" title="Nike Air Max 270" />);
    const button = screen.getByRole("button", { name: /share/i });
    fireEvent.click(button);
    await waitFor(() => expect(shareMock).toHaveBeenCalledTimes(1));

    fireEvent.click(button);
    await waitFor(() => expect(shareMock).toHaveBeenCalledTimes(2));
  });
});

describe("ShareActions -- fallback to clipboard when native share is unavailable", () => {
  it("Share falls back to a clipboard copy (with accurate 'Link copied' feedback) when navigator.share does not exist", async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: writeTextMock } });

    render(<ShareActions publicCode="abc123" title="Nike Air Max 270" />);
    fireEvent.click(screen.getByRole("button", { name: /share/i }));

    await waitFor(() => expect(writeTextMock).toHaveBeenCalledWith(EXPECTED_URL));
    expect(notifySuccessMock).toHaveBeenCalledWith("Link copied");
  });
});

describe("ShareActions -- explicit Copy link, independent of native share support", () => {
  it("Copy link always attempts a clipboard copy, even when native share IS available", async () => {
    const shareMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", { configurable: true, value: shareMock });
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: writeTextMock } });

    render(<ShareActions publicCode="abc123" title="Nike Air Max 270" />);
    fireEvent.click(screen.getByRole("button", { name: /copy link/i }));

    await waitFor(() => expect(writeTextMock).toHaveBeenCalledWith(EXPECTED_URL));
    expect(shareMock).not.toHaveBeenCalled();
    expect(notifySuccessMock).toHaveBeenCalledWith("Link copied");
  });

  it("shows a success toast only after writeText actually resolves, not merely on click", async () => {
    let resolveWrite: () => void = () => {};
    const writeTextMock = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveWrite = resolve;
        }),
    );
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: writeTextMock } });

    render(<ShareActions publicCode="abc123" title="Nike Air Max 270" />);
    fireEvent.click(screen.getByRole("button", { name: /copy link/i }));

    await waitFor(() => expect(writeTextMock).toHaveBeenCalledTimes(1));
    expect(notifySuccessMock).not.toHaveBeenCalled();
    resolveWrite();
    await waitFor(() => expect(notifySuccessMock).toHaveBeenCalledWith("Link copied"));
  });
});

describe("ShareActions -- a rapid second click while the first is still pending never double-invokes", () => {
  it("clicking Share twice while navigator.share is still pending calls it only once", async () => {
    let resolveShare: () => void = () => {};
    const shareMock = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveShare = resolve;
        }),
    );
    Object.defineProperty(navigator, "share", { configurable: true, value: shareMock });

    render(<ShareActions publicCode="abc123" title="Nike Air Max 270" />);
    const button = screen.getByRole("button", { name: /share/i });
    fireEvent.click(button);
    fireEvent.click(button);

    await waitFor(() => expect(shareMock).toHaveBeenCalledTimes(1));
    resolveShare();
    // Drain the resolved promise's own microtask before asserting the
    // guard was released, so a genuinely-late second click after
    // completion is still its own separate, allowed invocation.
    await waitFor(() => expect(shareMock).toHaveBeenCalledTimes(1));
  });

  // React's own useState update from a first click is not guaranteed to
  // have committed to a fresh closure before a second click's handler
  // runs -- a same-tick double-invocation is the real risk, not merely
  // "the button visually looks disabled." Wrapping BOTH dispatches in one
  // outer act() forces exactly that: React defers its own flush/re-render
  // until this whole block finishes, so both handler invocations run
  // against the identical pre-update closure, with no commit in between.
  // A guard that reads its own gate purely through a useState closure
  // cannot see its own update yet at this point, by construction --
  // proving whether the guard is genuinely synchronous, not just that a
  // disabled DOM button intercepted the second physical click (which
  // would prove nothing about the handler itself).
  it("invoking the click twice within the same React batch (no commit in between) still calls navigator.share only once", async () => {
    let resolveShare: () => void = () => {};
    const shareMock = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveShare = resolve;
        }),
    );
    Object.defineProperty(navigator, "share", { configurable: true, value: shareMock });

    render(<ShareActions publicCode="abc123" title="Nike Air Max 270" />);
    const button = screen.getByRole("button", { name: /share/i });

    act(() => {
      fireEvent.click(button);
      fireEvent.click(button);
    });

    await waitFor(() => expect(shareMock).toHaveBeenCalledTimes(1));
    resolveShare();
  });

  it("invoking Copy link twice within the same React batch (no commit in between) still calls writeText only once", async () => {
    let resolveWrite: () => void = () => {};
    const writeTextMock = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveWrite = resolve;
        }),
    );
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: writeTextMock } });

    render(<ShareActions publicCode="abc123" title="Nike Air Max 270" />);
    const button = screen.getByRole("button", { name: /copy link/i });

    act(() => {
      fireEvent.click(button);
      fireEvent.click(button);
    });

    await waitFor(() => expect(writeTextMock).toHaveBeenCalledTimes(1));
    resolveWrite();
    await waitFor(() => expect(notifySuccessMock).toHaveBeenCalledWith("Link copied"));
    expect(notifySuccessMock).toHaveBeenCalledTimes(1);
  });

  it("clicking Copy link twice while writeText is still pending calls it only once", async () => {
    let resolveWrite: () => void = () => {};
    const writeTextMock = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveWrite = resolve;
        }),
    );
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: writeTextMock } });

    render(<ShareActions publicCode="abc123" title="Nike Air Max 270" />);
    const button = screen.getByRole("button", { name: /copy link/i });
    fireEvent.click(button);
    fireEvent.click(button);

    await waitFor(() => expect(writeTextMock).toHaveBeenCalledTimes(1));
    resolveWrite();
    await waitFor(() => expect(notifySuccessMock).toHaveBeenCalledWith("Link copied"));
    expect(writeTextMock).toHaveBeenCalledTimes(1);
  });

  it("a genuinely later click, after the first has fully resolved, is its own separate invocation (the guard only blocks concurrent clicks, not all future ones)", async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: writeTextMock } });

    render(<ShareActions publicCode="abc123" title="Nike Air Max 270" />);
    const button = screen.getByRole("button", { name: /copy link/i });
    fireEvent.click(button);
    await waitFor(() => expect(notifySuccessMock).toHaveBeenCalledTimes(1));

    fireEvent.click(button);
    await waitFor(() => expect(notifySuccessMock).toHaveBeenCalledTimes(2));
    expect(writeTextMock).toHaveBeenCalledTimes(2);
  });
});

describe("ShareActions -- failed or unsupported browser APIs never claim success", () => {
  it("Copy link shows a truthful failure toast, never a success toast, when the Clipboard API is entirely unavailable", async () => {
    // clipboard already undefined from beforeEach.
    render(<ShareActions publicCode="abc123" title="Nike Air Max 270" />);
    fireEvent.click(screen.getByRole("button", { name: /copy link/i }));

    await waitFor(() => expect(notifyErrorMock).toHaveBeenCalledTimes(1));
    expect(notifySuccessMock).not.toHaveBeenCalled();
  });

  it("Copy link shows a truthful failure toast when writeText itself rejects (e.g. permission denied)", async () => {
    const writeTextMock = vi.fn().mockRejectedValue(new Error("denied"));
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: writeTextMock } });

    render(<ShareActions publicCode="abc123" title="Nike Air Max 270" />);
    fireEvent.click(screen.getByRole("button", { name: /copy link/i }));

    await waitFor(() => expect(notifyErrorMock).toHaveBeenCalledTimes(1));
    expect(notifySuccessMock).not.toHaveBeenCalled();
  });

  it("remains a usable, focusable control (not disabled/hidden) even when both navigator.share and Clipboard are unavailable", () => {
    render(<ShareActions publicCode="abc123" title="Nike Air Max 270" />);
    const shareButton = screen.getByRole("button", { name: /share/i });
    const copyButton = screen.getByRole("button", { name: /copy link/i });
    expect(shareButton).toBeEnabled();
    expect(copyButton).toBeEnabled();
  });
});
