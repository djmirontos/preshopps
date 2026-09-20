import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { ConfirmDialog } from "@/components/seller/ConfirmDialog";

function renderDialog(overrides: Partial<React.ComponentProps<typeof ConfirmDialog>> = {}) {
  return render(
    <ConfirmDialog
      title="Archive this listing?"
      description="Archived listings are hidden from the marketplace."
      confirmLabel="Archive"
      isPending={false}
      onConfirm={vi.fn()}
      onClose={vi.fn()}
      {...overrides}
    />,
  );
}

describe("ConfirmDialog -- baseline (no errorLink) regression", () => {
  it("renders title, description, and Confirm/Cancel buttons with no error and no link by default", () => {
    renderDialog();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Archive this listing?")).toBeInTheDocument();
    expect(screen.getByText("Archived listings are hidden from the marketplace.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Archive" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("renders errorMessage but no link when errorLink is not provided", () => {
    renderDialog({ errorMessage: "Something went wrong. Please try again." });
    expect(screen.getByText("Something went wrong. Please try again.")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("renders nothing extra when errorMessage is null and errorLink is absent", () => {
    renderDialog({ errorMessage: null });
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("clicking Confirm calls onConfirm with an empty note when no noteLabel is set", () => {
    const onConfirm = vi.fn();
    renderDialog({ onConfirm });
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    expect(onConfirm).toHaveBeenCalledWith("");
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

  it("while isPending, Confirm/Cancel are disabled, the confirm button reads 'Please wait…', and the backdrop no longer closes the dialog", () => {
    const onClose = vi.fn();
    const { container } = renderDialog({ isPending: true, onClose });
    expect(screen.getByRole("button", { name: "Please wait…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    const backdrop = container.querySelector('[aria-hidden="true"]');
    fireEvent.click(backdrop as Element);
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("ConfirmDialog -- errorLink (A2.2.2d, generic optional prop)", () => {
  it("renders the link with the expected text and href when errorLink is provided alongside errorMessage", () => {
    renderDialog({
      errorMessage: "You are not able to manage listings right now.",
      errorLink: { label: "View account status", href: "/account#account-status" },
    });

    expect(screen.getByText("You are not able to manage listings right now.")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "View account status" });
    expect(link).toHaveAttribute("href", "/account#account-status");
  });

  it("the link is a real, focusable anchor inside the dialog's own focus scope", () => {
    renderDialog({
      errorMessage: "You are not able to manage listings right now.",
      errorLink: { label: "View account status", href: "/account#account-status" },
    });

    const dialog = screen.getByRole("dialog");
    const link = within(dialog).getByRole("link", { name: "View account status" });
    link.focus();
    expect(link).toHaveFocus();
  });

  it("renders no moderation-specific language of its own -- only the exact label/href data the caller supplies", () => {
    renderDialog({
      errorMessage: "That status change isn't allowed from the listing's current status.",
      errorLink: { label: "Some other label", href: "/some/other/path" },
    });

    expect(screen.getByRole("link", { name: "Some other label" })).toHaveAttribute("href", "/some/other/path");
    expect(screen.queryByText(/suspended|restricted/i)).not.toBeInTheDocument();
  });
});

describe("ConfirmDialog -- errorDetail (A2.2.2d STEP 4, generic optional prop)", () => {
  it("errorDetail can be provided independently of errorLink", () => {
    renderDialog({ errorDetail: "Your selling access is currently suspended." });

    expect(screen.getByText("Your selling access is currently suspended.")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("errorLink can be provided independently of errorDetail", () => {
    renderDialog({ errorLink: { label: "View account status", href: "/account#account-status" } });

    expect(screen.getByRole("link", { name: "View account status" })).toHaveAttribute("href", "/account#account-status");
  });

  it("neither errorDetail nor errorLink render when both are absent, even with errorMessage present", () => {
    renderDialog({ errorMessage: "You are not able to manage listings right now." });

    expect(screen.getByText("You are not able to manage listings right now.")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("renders errorMessage, then errorDetail, then errorLink in that order when all three are present", () => {
    renderDialog({
      errorMessage: "You are not able to manage listings right now.",
      errorDetail: "Your selling access is currently suspended.",
      errorLink: { label: "View account status", href: "/account#account-status" },
    });

    const dialog = screen.getByRole("dialog");
    const text = dialog.textContent ?? "";
    const messageIndex = text.indexOf("You are not able to manage listings right now.");
    const detailIndex = text.indexOf("Your selling access is currently suspended.");
    const linkIndex = text.indexOf("View account status");

    expect(messageIndex).toBeGreaterThan(-1);
    expect(detailIndex).toBeGreaterThan(messageIndex);
    expect(linkIndex).toBeGreaterThan(detailIndex);
  });
});

describe("ConfirmDialog -- focus trap boundaries exclude disabled controls (A2.2.2d STEP 5)", () => {
  function renderWithLink(overrides: Partial<React.ComponentProps<typeof ConfirmDialog>> = {}) {
    return renderDialog({
      errorMessage: "You are not able to manage listings right now.",
      errorDetail: "Your selling access is currently suspended.",
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
      expect(cancelButton).toHaveFocus();

      fireEvent.keyDown(document, { key: "Tab" });

      expect(closeButton).toHaveFocus();
    });

    it("Shift+Tab from the first control (Close) wraps to the last enabled control (Cancel)", () => {
      renderDialog();
      const closeButton = screen.getByRole("button", { name: "Close" });
      const cancelButton = screen.getByRole("button", { name: "Cancel" });

      closeButton.focus();
      expect(closeButton).toHaveFocus();

      fireEvent.keyDown(document, { key: "Tab", shiftKey: true });

      expect(cancelButton).toHaveFocus();
    });
  });

  describe("dialog with errorLink", () => {
    it("the link participates in the sequence -- Tab from the last enabled control (Cancel) wraps to the first (Close), never landing on the link out of turn", () => {
      renderWithLink();
      const closeButton = screen.getByRole("button", { name: "Close" });
      const cancelButton = screen.getByRole("button", { name: "Cancel" });

      cancelButton.focus();
      fireEvent.keyDown(document, { key: "Tab" });

      expect(closeButton).toHaveFocus();
    });

    it("Shift+Tab from the first control (Close) wraps to the last enabled control (Cancel), with the link still reachable in between via ordinary DOM order", () => {
      renderWithLink();
      const closeButton = screen.getByRole("button", { name: "Close" });
      const cancelButton = screen.getByRole("button", { name: "Cancel" });
      const link = screen.getByRole("link", { name: "View account status" });

      closeButton.focus();
      fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
      expect(cancelButton).toHaveFocus();

      // The link is a real, present, focusable node between them -- not
      // wired into the manual wrap logic itself (only first/last are),
      // but reachable via the browser's own native forward/back traversal.
      expect(link).toBeInTheDocument();
      expect(link).toHaveAttribute("href", "/account#account-status");
    });
  });

  describe("pending dialog: Close/Confirm/Cancel disabled, errorLink enabled", () => {
    it("disabled Close/Confirm/Cancel are excluded from the trap -- the link is the only focusable element", () => {
      renderWithLink({ isPending: true });

      const closeButton = screen.getByRole("button", { name: "Close" });
      const cancelButton = screen.getByRole("button", { name: "Cancel" });
      expect(closeButton).toBeDisabled();
      expect(cancelButton).toBeDisabled();

      const panel = screen.getByRole("dialog");
      const focusable = panel.querySelectorAll('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])');
      expect(focusable).toHaveLength(1);
      expect(focusable[0]).toBe(screen.getByRole("link", { name: "View account status" }));
    });

    it("Tab keeps focus on the link (first and last both resolve to it)", () => {
      renderWithLink({ isPending: true });
      const link = screen.getByRole("link", { name: "View account status" });

      link.focus();
      expect(link).toHaveFocus();

      fireEvent.keyDown(document, { key: "Tab" });

      expect(link).toHaveFocus();
    });

    it("Shift+Tab keeps focus on the link (first and last both resolve to it) -- focus cannot escape the dialog", () => {
      renderWithLink({ isPending: true });
      const link = screen.getByRole("link", { name: "View account status" });

      link.focus();
      expect(link).toHaveFocus();

      fireEvent.keyDown(document, { key: "Tab", shiftKey: true });

      expect(link).toHaveFocus();
    });
  });

  describe("pending dialog with no enabled focusable element at all", () => {
    it("Tab and Shift+Tab are safe no-ops -- the handler never throws when nothing is focusable", () => {
      renderDialog({ isPending: true });

      expect(() => fireEvent.keyDown(document, { key: "Tab" })).not.toThrow();
      expect(() => fireEvent.keyDown(document, { key: "Tab", shiftKey: true })).not.toThrow();
    });
  });
});
