import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AuthGate } from "@/components/auth/AuthGate";

describe("AuthGate", () => {
  it("renders as an accessible dialog with the given title and reason", () => {
    render(
      <AuthGate title="Sign in to save items" reason="Create a free account." next="/" onClose={vi.fn()} />,
    );
    const dialog = screen.getByRole("dialog", { name: "Sign in to save items" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByText("Create a free account.")).toBeInTheDocument();
  });

  it("carries the given safe next path into both Sign in and Create account links", () => {
    render(<AuthGate title="t" reason="r" next="/item/PSO-ABC" onClose={vi.fn()} />);
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      `/sign-in?next=${encodeURIComponent("/item/PSO-ABC")}`,
    );
    expect(screen.getByRole("link", { name: "Create account" })).toHaveAttribute(
      "href",
      `/sign-up?next=${encodeURIComponent("/item/PSO-ABC")}`,
    );
  });

  it("calls onClose when Escape is pressed", () => {
    const onClose = vi.fn();
    render(<AuthGate title="t" reason="r" next="/" onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when the visible close button is clicked", () => {
    const onClose = vi.fn();
    render(<AuthGate title="t" reason="r" next="/" onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when the backdrop is clicked", () => {
    const onClose = vi.fn();
    const { container } = render(<AuthGate title="t" reason="r" next="/" onClose={onClose} />);
    const backdrop = container.querySelector('[aria-hidden="true"]');
    expect(backdrop).not.toBeNull();
    fireEvent.click(backdrop!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("moves initial focus into the dialog panel", () => {
    render(<AuthGate title="t" reason="r" next="/" onClose={vi.fn()} />);
    expect(screen.getByRole("dialog")).toHaveFocus();
  });

  it("traps Tab focus within the dialog", () => {
    render(<AuthGate title="t" reason="r" next="/" onClose={vi.fn()} />);
    const closeButton = screen.getByRole("button", { name: "Close" });
    const createAccountLink = screen.getByRole("link", { name: "Create account" });

    createAccountLink.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(closeButton).toHaveFocus();
  });

  it("returns focus to the previously focused element on close", () => {
    const trigger = document.createElement("button");
    trigger.textContent = "Open";
    document.body.appendChild(trigger);
    trigger.focus();

    const { unmount } = render(<AuthGate title="t" reason="r" next="/" onClose={vi.fn()} />);
    unmount();

    expect(trigger).toHaveFocus();
    trigger.remove();
  });
});
