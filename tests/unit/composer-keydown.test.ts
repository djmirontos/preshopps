import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KeyboardEvent } from "react";
import { handleComposerKeyDown } from "@/lib/messaging/composer-keydown";

const DESKTOP_WIDTH = 1280;
const MOBILE_WIDTH = 375;

function setViewportWidth(width: number) {
  Object.defineProperty(window, "innerWidth", { writable: true, configurable: true, value: width });
}

function makeEvent(overrides: Partial<{ key: string; shiftKey: boolean; isComposing: boolean }> = {}) {
  const { key = "Enter", shiftKey = false, isComposing = false } = overrides;
  return {
    key,
    shiftKey,
    nativeEvent: { isComposing },
    preventDefault: vi.fn(),
  } as unknown as KeyboardEvent<HTMLTextAreaElement>;
}

beforeEach(() => {
  setViewportWidth(DESKTOP_WIDTH);
});

describe("handleComposerKeyDown", () => {
  it("desktop: plain Enter calls onSend and prevents the default newline", () => {
    const onSend = vi.fn();
    const event = makeEvent({ key: "Enter" });
    handleComposerKeyDown(event, onSend);
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
  });

  it("desktop: Shift+Enter never calls onSend -- the default newline proceeds", () => {
    const onSend = vi.fn();
    const event = makeEvent({ key: "Enter", shiftKey: true });
    handleComposerKeyDown(event, onSend);
    expect(onSend).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("desktop: Enter while an IME composition is active never calls onSend", () => {
    const onSend = vi.fn();
    const event = makeEvent({ key: "Enter", isComposing: true });
    handleComposerKeyDown(event, onSend);
    expect(onSend).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("desktop: a non-Enter key never calls onSend", () => {
    const onSend = vi.fn();
    const event = makeEvent({ key: "a" });
    handleComposerKeyDown(event, onSend);
    expect(onSend).not.toHaveBeenCalled();
  });

  it("mobile (< lg): plain Enter never calls onSend -- default newline behavior is preserved", () => {
    setViewportWidth(MOBILE_WIDTH);
    const onSend = vi.fn();
    const event = makeEvent({ key: "Enter" });
    handleComposerKeyDown(event, onSend);
    expect(onSend).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("does not itself validate whitespace/empty content -- that stays the caller's own responsibility (the same guard the Send button's disabled state already applies)", () => {
    // This is a documentation-style test: handleComposerKeyDown is a thin
    // dispatch, not a validator. Every real caller in this codebase wraps
    // its own onSend in an emptiness/whitespace check before this helper
    // ever sees it (ConversationThread's handleSend, ComposeMessageDialog's
    // canSend-gated onSend) -- covered by those components' own tests.
    const onSend = vi.fn();
    const event = makeEvent({ key: "Enter" });
    handleComposerKeyDown(event, onSend);
    expect(onSend).toHaveBeenCalledTimes(1);
  });
});
