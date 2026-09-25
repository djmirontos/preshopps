import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { BuyNowOrderSubmittedNotice } from "@/components/orders/BuyNowOrderSubmittedNotice";
import { BUY_NOW_SUCCESS_STORAGE_KEY, markBuyNowOrderSubmitted } from "@/lib/cart/buy-now-success-flag";

/** Strips comments before a "must NOT contain X" source assertion, so it
 * can't false-positive on this file's own doc comments explaining (by
 * name) the mechanisms it deliberately does NOT use. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

/**
 * Actually lets the component's deferred mount-time microtask
 * (Promise.resolve().then(...) inside its useEffect) run before a test
 * asserts anything about the outcome. A bare `waitFor(() =>
 * expect(...).not.toBeInTheDocument())` "passes" trivially on its very
 * first synchronous check -- before the effect has had any chance to call
 * consumeBuyNowSuccessFlagFor or setShowNotice at all -- which would prove
 * nothing about what the effect actually decided. Every negative
 * ("does NOT show") assertion in this file must flush through this first.
 */
async function flushDeferredRead() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  sessionStorage.clear();
});

describe("BuyNowOrderSubmittedNotice", () => {
  it("shows the confirmation when the flag matches this exact order's public code", async () => {
    markBuyNowOrderSubmitted("PSO-1");

    render(<BuyNowOrderSubmittedNotice orderPublicCode="PSO-1" />);

    expect(await screen.findByRole("status")).toHaveTextContent("Order submitted successfully.");
  });

  it("renders nothing on the ordinary order-page visit -- no flag was ever set", async () => {
    render(<BuyNowOrderSubmittedNotice orderPublicCode="PSO-1" />);
    await flushDeferredRead();

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(sessionStorage.getItem(BUY_NOW_SUCCESS_STORAGE_KEY)).toBeNull();
  });

  it("order-code mismatch: never shows the confirmation when the flag is for a DIFFERENT order -- an older order visited in the same tab, or a second Buy Now for a different listing -- and leaves that other order's own flag untouched for when it IS visited", async () => {
    markBuyNowOrderSubmitted("PSO-2");

    render(<BuyNowOrderSubmittedNotice orderPublicCode="PSO-1" />);
    await flushDeferredRead();

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    // The mismatched read must never consume PSO-2's own, still-genuine flag.
    expect(sessionStorage.getItem(BUY_NOW_SUCCESS_STORAGE_KEY)).toBe("PSO-2");
  });

  it("concern (spoofable marker): a manually entered/shared URL alone can never trigger this -- the component reads no query string or route param beyond the prop the server already authorized, only sessionStorage", async () => {
    // Simulates someone typing/sharing /orders/PSO-1 with no real Buy Now
    // ever having happened in this browser tab.
    render(<BuyNowOrderSubmittedNotice orderPublicCode="PSO-1" />);
    await flushDeferredRead();

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(sessionStorage.getItem(BUY_NOW_SUCCESS_STORAGE_KEY)).toBeNull();
  });

  it("clears the sessionStorage flag after showing the confirmation", async () => {
    markBuyNowOrderSubmitted("PSO-1");

    render(<BuyNowOrderSubmittedNotice orderPublicCode="PSO-1" />);

    await screen.findByRole("status");
    expect(sessionStorage.getItem(BUY_NOW_SUCCESS_STORAGE_KEY)).toBeNull();
  });

  it("does not reappear on a fresh mount once the flag has already been cleared -- proves a later reload/revisit of this same order's page in the same tab never repeats it", async () => {
    markBuyNowOrderSubmitted("PSO-1");
    const { unmount } = render(<BuyNowOrderSubmittedNotice orderPublicCode="PSO-1" />);
    await screen.findByRole("status");
    unmount();
    expect(sessionStorage.getItem(BUY_NOW_SUCCESS_STORAGE_KEY)).toBeNull();

    render(<BuyNowOrderSubmittedNotice orderPublicCode="PSO-1" />);
    await flushDeferredRead();

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("stays visible across later, unrelated re-renders of the same mounted instance, even though the underlying sessionStorage flag has already been cleared", async () => {
    markBuyNowOrderSubmitted("PSO-1");
    const { rerender } = render(<BuyNowOrderSubmittedNotice orderPublicCode="PSO-1" />);

    await screen.findByRole("status");
    expect(sessionStorage.getItem(BUY_NOW_SUCCESS_STORAGE_KEY)).toBeNull();

    rerender(<BuyNowOrderSubmittedNotice orderPublicCode="PSO-1" />);
    rerender(<BuyNowOrderSubmittedNotice orderPublicCode="PSO-1" />);

    expect(screen.getByRole("status")).toHaveTextContent("Order submitted successfully.");
  });

  it("an arbitrary/forged sessionStorage value (never the exact code markBuyNowOrderSubmitted writes) never shows the confirmation, and is left untouched rather than consumed", async () => {
    sessionStorage.setItem(BUY_NOW_SUCCESS_STORAGE_KEY, "not-a-real-code");

    render(<BuyNowOrderSubmittedNotice orderPublicCode="PSO-1" />);
    await flushDeferredRead();

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(sessionStorage.getItem(BUY_NOW_SUCCESS_STORAGE_KEY)).toBe("not-a-real-code");
  });

  it("React Strict Mode's dev-only double-invoke of the mount effect never double-shows the confirmation and never leaves the flag uncleared", async () => {
    markBuyNowOrderSubmitted("PSO-1");

    render(
      <StrictMode>
        <BuyNowOrderSubmittedNotice orderPublicCode="PSO-1" />
      </StrictMode>,
    );

    expect(await screen.findByRole("status")).toBeInTheDocument();
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(sessionStorage.getItem(BUY_NOW_SUCCESS_STORAGE_KEY)).toBeNull();
  });

  it("unmounting before the deferred mount-time read resolves never consumes the flag -- a later, real visit still shows (and then clears) it exactly once", async () => {
    markBuyNowOrderSubmitted("PSO-1");
    const { unmount } = render(<BuyNowOrderSubmittedNotice orderPublicCode="PSO-1" />);
    unmount();

    await Promise.resolve();
    await Promise.resolve();

    expect(sessionStorage.getItem(BUY_NOW_SUCCESS_STORAGE_KEY)).toBe("PSO-1");

    render(<BuyNowOrderSubmittedNotice orderPublicCode="PSO-1" />);
    expect(await screen.findByRole("status")).toBeInTheDocument();
    expect(sessionStorage.getItem(BUY_NOW_SUCCESS_STORAGE_KEY)).toBeNull();
  });

  it("a full storage-access denial (sessionStorage.getItem itself throwing, e.g. a privacy-mode/embedding restriction) never crashes this component or blanks the rest of the order page -- it just renders nothing, same as no flag at all", async () => {
    markBuyNowOrderSubmitted("PSO-1");
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });

    let renderResult: ReturnType<typeof render>;
    expect(() => {
      renderResult = render(<BuyNowOrderSubmittedNotice orderPublicCode="PSO-1" />);
    }).not.toThrow();
    await flushDeferredRead();

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(renderResult!.container).toBeInTheDocument();
    spy.mockRestore();
  });

  it("getItem succeeds and matches, but removeItem itself throws: the confirmation is NOT shown (consumption wasn't confirmed), and the page never crashes or blanks", async () => {
    markBuyNowOrderSubmitted("PSO-1");
    const spy = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });

    let renderResult: ReturnType<typeof render>;
    expect(() => {
      renderResult = render(<BuyNowOrderSubmittedNotice orderPublicCode="PSO-1" />);
    }).not.toThrow();
    await flushDeferredRead();

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(renderResult!.container).toBeInTheDocument();
    spy.mockRestore();
    // The mocked removeItem never actually deleted the real value, so it's
    // still there, unconsumed, exactly as markBuyNowOrderSubmitted left it.
    expect(sessionStorage.getItem(BUY_NOW_SUCCESS_STORAGE_KEY)).toBe("PSO-1");
  });

  it("a removeItem failure is not permanent: once storage access recovers, a later mount shows the confirmation exactly once (normal one-time display, after transient recovery)", async () => {
    markBuyNowOrderSubmitted("PSO-1");
    const spy = vi.spyOn(Storage.prototype, "removeItem").mockImplementationOnce(() => {
      throw new Error("SecurityError");
    });

    const { unmount } = render(<BuyNowOrderSubmittedNotice orderPublicCode="PSO-1" />);
    await flushDeferredRead();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    unmount();
    spy.mockRestore();

    render(<BuyNowOrderSubmittedNotice orderPublicCode="PSO-1" />);
    expect(await screen.findByRole("status")).toHaveTextContent("Order submitted successfully.");
    expect(sessionStorage.getItem(BUY_NOW_SUCCESS_STORAGE_KEY)).toBeNull();

    // And it truly was one-time: a further remount finds nothing left to show.
    render(<BuyNowOrderSubmittedNotice orderPublicCode="PSO-1" />);
    await flushDeferredRead();
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });

  it("never imports next/navigation or reads the URL at all -- structurally cannot be driven by a shared/bookmarked link's query string", () => {
    const source = stripComments(readFileSync(path.join(process.cwd(), "components/orders/BuyNowOrderSubmittedNotice.tsx"), "utf-8"));
    expect(source).not.toMatch(/from ["']next\/navigation["']/);
    expect(source).not.toMatch(/router\.replace/);
    expect(source).not.toMatch(/\blocation\.search\b/);
  });

  it("never subscribes to sessionStorage as a live external store (no useSyncExternalStore) -- the rendered value is captured once, not re-derived on every render", () => {
    const source = stripComments(readFileSync(path.join(process.cwd(), "components/orders/BuyNowOrderSubmittedNotice.tsx"), "utf-8"));
    expect(source).not.toMatch(/useSyncExternalStore/);
  });
});
