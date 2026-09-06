import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  usePathname: () => "/search",
}));

import { SellGate } from "@/components/auth/SellGate";

describe("SellGate", () => {
  it("guest click opens the auth gate with Sell-specific copy", () => {
    render(
      <SellGate isAuthenticated={false} className="test-class">
        Sell
      </SellGate>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Sell" }));
    expect(screen.getByRole("dialog", { name: "Sign in to start selling" })).toBeInTheDocument();
  });

  it("guest gate carries the current path as next", () => {
    render(
      <SellGate isAuthenticated={false} className="test-class">
        Sell
      </SellGate>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Sell" }));
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      `/sign-in?next=${encodeURIComponent("/search")}`,
    );
  });

  it("authenticated user sees an honest disabled control, not a fake sell destination", () => {
    render(
      <SellGate isAuthenticated className="test-class">
        Sell
      </SellGate>,
    );
    const control = screen.getByRole("button", { name: "Sell" });
    expect(control).toBeDisabled();
  });

  it("does not open a gate for an authenticated user", () => {
    render(
      <SellGate isAuthenticated className="test-class">
        Sell
      </SellGate>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Sell" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
