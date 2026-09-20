import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { ComposeMessageDialog } from "@/components/messaging/ComposeMessageDialog";

function setViewportWidth(width: number) {
  Object.defineProperty(window, "innerWidth", { writable: true, configurable: true, value: width });
}

const DESKTOP_WIDTH = 1280;
const MOBILE_WIDTH = 375;

function renderDialog(overrides: Partial<React.ComponentProps<typeof ComposeMessageDialog>> = {}) {
  return render(
    <ComposeMessageDialog title="Message Seller" isPending={false} onSend={vi.fn()} onClose={vi.fn()} {...overrides} />,
  );
}

describe("ComposeMessageDialog -- desktop Enter-to-send / Shift+Enter-newline", () => {
  it("desktop (>= lg): Enter sends the trimmed body", () => {
    setViewportWidth(DESKTOP_WIDTH);
    const onSend = vi.fn();
    renderDialog({ onSend });

    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "  Is this still available?  " } });
    fireEvent.keyDown(screen.getByLabelText("Message"), { key: "Enter" });

    expect(onSend).toHaveBeenCalledWith("Is this still available?");
  });

  it("desktop (>= lg): Shift+Enter never sends", () => {
    setViewportWidth(DESKTOP_WIDTH);
    const onSend = vi.fn();
    renderDialog({ onSend });

    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Hello" } });
    fireEvent.keyDown(screen.getByLabelText("Message"), { key: "Enter", shiftKey: true });

    expect(onSend).not.toHaveBeenCalled();
  });

  it("desktop (>= lg): Enter on an empty/whitespace-only draft never sends", () => {
    setViewportWidth(DESKTOP_WIDTH);
    const onSend = vi.fn();
    renderDialog({ onSend });

    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "   " } });
    fireEvent.keyDown(screen.getByLabelText("Message"), { key: "Enter" });

    expect(onSend).not.toHaveBeenCalled();
  });

  it("desktop (>= lg): Enter while an IME composition is active never sends", () => {
    setViewportWidth(DESKTOP_WIDTH);
    const onSend = vi.fn();
    renderDialog({ onSend });

    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "こんにちは" } });
    fireEvent.keyDown(screen.getByLabelText("Message"), { key: "Enter", isComposing: true });

    expect(onSend).not.toHaveBeenCalled();
  });

  it("mobile (< lg): Enter never sends -- it remains a plain newline", () => {
    setViewportWidth(MOBILE_WIDTH);
    const onSend = vi.fn();
    renderDialog({ onSend });

    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Hello" } });
    fireEvent.keyDown(screen.getByLabelText("Message"), { key: "Enter" });

    expect(onSend).not.toHaveBeenCalled();
  });

  it("mobile (< lg): the Send button still works", () => {
    setViewportWidth(MOBILE_WIDTH);
    const onSend = vi.fn();
    renderDialog({ onSend });

    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Hello" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(onSend).toHaveBeenCalledWith("Hello");
  });
});

describe("ComposeMessageDialog -- baseline (no errorDetail/errorLink) regression", () => {
  it("renders title, composer, and Send/Cancel buttons with no error/detail/link by default", () => {
    renderDialog();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Message Seller")).toBeInTheDocument();
    expect(screen.getByLabelText("Message")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("renders errorMessage but no link when errorDetail/errorLink are not provided", () => {
    renderDialog({ errorMessage: "You can't message this seller right now." });
    expect(screen.getByText("You can't message this seller right now.")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("Send is disabled until the composer has non-whitespace content, and calls onSend with the trimmed body", () => {
    const onSend = vi.fn();
    renderDialog({ onSend });
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "  Hello there  " } });
    expect(screen.getByRole("button", { name: "Send" })).not.toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onSend).toHaveBeenCalledWith("Hello there");
  });

  it("clicking Cancel calls onClose", () => {
    const onClose = vi.fn();
    renderDialog({ onClose });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("clicking the Close (X) button calls onClose", () => {
    const onClose = vi.fn();
    renderDialog({ onClose });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("pressing Escape calls onClose", () => {
    const onClose = vi.fn();
    renderDialog({ onClose });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("clicking the backdrop calls onClose", () => {
    const onClose = vi.fn();
    const { container } = renderDialog({ onClose });
    const backdrop = container.querySelector('[aria-hidden="true"]');
    expect(backdrop).not.toBeNull();
    fireEvent.click(backdrop as Element);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("while isPending, Close/Cancel are disabled, Send reads 'Sending…', and the backdrop no longer closes the dialog", () => {
    const onClose = vi.fn();
    const { container } = renderDialog({ isPending: true, onClose });
    expect(screen.getByRole("button", { name: "Sending…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Close" })).toBeDisabled();
    const backdrop = container.querySelector('[aria-hidden="true"]');
    fireEvent.click(backdrop as Element);
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("ComposeMessageDialog -- errorDetail/errorLink (A2.2.2f.1, generic optional props)", () => {
  it("errorDetail can be provided independently of errorLink", () => {
    renderDialog({ errorDetail: "Your buying access is currently restricted." });
    expect(screen.getByText("Your buying access is currently restricted.")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("errorLink can be provided independently of errorDetail", () => {
    renderDialog({ errorLink: { label: "View account status", href: "/account#account-status" } });
    expect(screen.getByRole("link", { name: "View account status" })).toHaveAttribute("href", "/account#account-status");
  });

  it("renders errorMessage, then errorDetail, then errorLink in that order when all three are present", () => {
    renderDialog({
      errorMessage: "You can't message this seller right now.",
      errorDetail: "Your buying access is currently restricted.",
      errorLink: { label: "View account status", href: "/account#account-status" },
    });

    const dialog = screen.getByRole("dialog");
    const text = dialog.textContent ?? "";
    const messageIndex = text.indexOf("You can't message this seller right now.");
    const detailIndex = text.indexOf("Your buying access is currently restricted.");
    const linkIndex = text.indexOf("View account status");

    expect(messageIndex).toBeGreaterThan(-1);
    expect(detailIndex).toBeGreaterThan(messageIndex);
    expect(linkIndex).toBeGreaterThan(detailIndex);
  });

  it("the link is a real, focusable anchor inside the dialog's own focus scope, and carries no moderation-specific language of the dialog's own", () => {
    renderDialog({
      errorMessage: "You can't message this seller right now.",
      errorLink: { label: "View account status", href: "/account#account-status" },
    });

    const dialog = screen.getByRole("dialog");
    const link = within(dialog).getByRole("link", { name: "View account status" });
    link.focus();
    expect(link).toHaveFocus();
  });
});

describe("ComposeMessageDialog -- focus trap boundaries exclude disabled controls (A2.2.2f.1)", () => {
  function renderWithLink(overrides: Partial<React.ComponentProps<typeof ComposeMessageDialog>> = {}) {
    return renderDialog({
      errorMessage: "You can't message this seller right now.",
      errorDetail: "Your buying access is currently restricted.",
      errorLink: { label: "View account status", href: "/account#account-status" },
      ...overrides,
    });
  }

  describe("normal dialog, no errorLink", () => {
    it("Tab from the last enabled control (Cancel) wraps to the first (Close)", () => {
      renderDialog();
      const closeButton = screen.getByRole("button", { name: "Close" });
      const cancelButton = screen.getByRole("button", { name: "Cancel" });

      cancelButton.focus();
      fireEvent.keyDown(document, { key: "Tab" });

      expect(closeButton).toHaveFocus();
    });

    it("Shift+Tab from the first control (Close) wraps to the last enabled control (Cancel)", () => {
      renderDialog();
      const closeButton = screen.getByRole("button", { name: "Close" });
      const cancelButton = screen.getByRole("button", { name: "Cancel" });

      closeButton.focus();
      fireEvent.keyDown(document, { key: "Tab", shiftKey: true });

      expect(cancelButton).toHaveFocus();
    });
  });

  describe("dialog with errorLink, not pending", () => {
    it("Tab from the last enabled control (Cancel) wraps to the first (Close), never landing on the link out of turn", () => {
      renderWithLink();
      const closeButton = screen.getByRole("button", { name: "Close" });
      const cancelButton = screen.getByRole("button", { name: "Cancel" });

      cancelButton.focus();
      fireEvent.keyDown(document, { key: "Tab" });

      expect(closeButton).toHaveFocus();
    });

    it("Shift+Tab from the first control (Close) wraps to the last enabled control (Cancel), with the link still present and reachable via ordinary DOM order", () => {
      renderWithLink();
      const closeButton = screen.getByRole("button", { name: "Close" });
      const cancelButton = screen.getByRole("button", { name: "Cancel" });
      const link = screen.getByRole("link", { name: "View account status" });

      closeButton.focus();
      fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
      expect(cancelButton).toHaveFocus();

      expect(link).toBeInTheDocument();
      expect(link).toHaveAttribute("href", "/account#account-status");
    });
  });

  describe("pending dialog: Close/Send/Cancel disabled; the composer textarea and errorLink remain enabled", () => {
    it("disabled Close/Send/Cancel are excluded from the trap -- only the textarea and the link remain", () => {
      renderWithLink({ isPending: true });

      expect(screen.getByRole("button", { name: "Close" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Sending…" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();

      const panel = screen.getByRole("dialog");
      const focusable = panel.querySelectorAll('button:not([disabled]), [href], textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
      expect(focusable).toHaveLength(2);
      expect(Array.from(focusable)).toEqual([screen.getByLabelText("Message"), screen.getByRole("link", { name: "View account status" })]);
    });

    it("Tab from the link (the last enabled control) wraps to the textarea (the first enabled control)", () => {
      renderWithLink({ isPending: true });
      const textarea = screen.getByLabelText("Message");
      const link = screen.getByRole("link", { name: "View account status" });

      link.focus();
      expect(link).toHaveFocus();

      fireEvent.keyDown(document, { key: "Tab" });

      expect(textarea).toHaveFocus();
    });

    it("Shift+Tab from the textarea (the first enabled control) wraps to the link (the last enabled control) -- focus cannot escape the dialog", () => {
      renderWithLink({ isPending: true });
      const textarea = screen.getByLabelText("Message");
      const link = screen.getByRole("link", { name: "View account status" });

      textarea.focus();
      expect(textarea).toHaveFocus();

      fireEvent.keyDown(document, { key: "Tab", shiftKey: true });

      expect(link).toHaveFocus();
    });
  });

  describe("pending dialog with no errorLink -- only the always-enabled textarea remains", () => {
    it("Tab and Shift+Tab never throw, even with every button disabled", () => {
      renderDialog({ isPending: true });

      expect(() => fireEvent.keyDown(document, { key: "Tab" })).not.toThrow();
      expect(() => fireEvent.keyDown(document, { key: "Tab", shiftKey: true })).not.toThrow();
    });
  });
});
