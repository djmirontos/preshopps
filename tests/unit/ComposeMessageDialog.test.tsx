import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ComposeMessageDialog } from "@/components/messaging/ComposeMessageDialog";

function setViewportWidth(width: number) {
  Object.defineProperty(window, "innerWidth", { writable: true, configurable: true, value: width });
}

const DESKTOP_WIDTH = 1280;
const MOBILE_WIDTH = 375;

function renderDialog(onSend = vi.fn(), onClose = vi.fn()) {
  render(<ComposeMessageDialog title="Message Seller" isPending={false} errorMessage={null} onSend={onSend} onClose={onClose} />);
  return { onSend, onClose };
}

describe("ComposeMessageDialog -- desktop Enter-to-send / Shift+Enter-newline", () => {
  it("desktop (>= lg): Enter sends the trimmed body", () => {
    setViewportWidth(DESKTOP_WIDTH);
    const { onSend } = renderDialog();

    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "  Is this still available?  " } });
    fireEvent.keyDown(screen.getByLabelText("Message"), { key: "Enter" });

    expect(onSend).toHaveBeenCalledWith("Is this still available?");
  });

  it("desktop (>= lg): Shift+Enter never sends", () => {
    setViewportWidth(DESKTOP_WIDTH);
    const { onSend } = renderDialog();

    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Hello" } });
    fireEvent.keyDown(screen.getByLabelText("Message"), { key: "Enter", shiftKey: true });

    expect(onSend).not.toHaveBeenCalled();
  });

  it("desktop (>= lg): Enter on an empty/whitespace-only draft never sends", () => {
    setViewportWidth(DESKTOP_WIDTH);
    const { onSend } = renderDialog();

    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "   " } });
    fireEvent.keyDown(screen.getByLabelText("Message"), { key: "Enter" });

    expect(onSend).not.toHaveBeenCalled();
  });

  it("desktop (>= lg): Enter while an IME composition is active never sends", () => {
    setViewportWidth(DESKTOP_WIDTH);
    const { onSend } = renderDialog();

    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "こんにちは" } });
    fireEvent.keyDown(screen.getByLabelText("Message"), { key: "Enter", isComposing: true });

    expect(onSend).not.toHaveBeenCalled();
  });

  it("mobile (< lg): Enter never sends -- it remains a plain newline", () => {
    setViewportWidth(MOBILE_WIDTH);
    const { onSend } = renderDialog();

    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Hello" } });
    fireEvent.keyDown(screen.getByLabelText("Message"), { key: "Enter" });

    expect(onSend).not.toHaveBeenCalled();
  });

  it("mobile (< lg): the Send button still works", () => {
    setViewportWidth(MOBILE_WIDTH);
    const { onSend } = renderDialog();

    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Hello" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(onSend).toHaveBeenCalledWith("Hello");
  });
});
