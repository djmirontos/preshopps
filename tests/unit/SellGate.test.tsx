import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  usePathname: () => "/search",
}));

import { SellGate } from "@/components/auth/SellGate";

describe("SellGate", () => {
  it("guest click opens the auth gate with Sell-specific copy", () => {
    render(
      <SellGate isAuthenticated={false} hasShop={false} className="test-class">
        Sell
      </SellGate>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Sell" }));
    expect(screen.getByRole("dialog", { name: "Sign in to start selling" })).toBeInTheDocument();
  });

  it("guest gate carries the current path as next", () => {
    render(
      <SellGate isAuthenticated={false} hasShop={false} className="test-class">
        Sell
      </SellGate>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Sell" }));
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      `/sign-in?next=${encodeURIComponent("/search")}`,
    );
  });

  it("authenticated without a shop links to /seller/shop -- a listing always needs a shop first", () => {
    render(
      <SellGate isAuthenticated hasShop={false} className="test-class">
        Sell
      </SellGate>,
    );
    expect(screen.getByRole("link", { name: "Sell" })).toHaveAttribute("href", "/seller/shop");
  });

  it("authenticated with a shop links directly to /sell", () => {
    render(
      <SellGate isAuthenticated hasShop className="test-class">
        Sell
      </SellGate>,
    );
    expect(screen.getByRole("link", { name: "Sell" })).toHaveAttribute("href", "/sell");
  });

  it("never shows the auth gate for an authenticated user, regardless of shop state", () => {
    render(
      <SellGate isAuthenticated hasShop={false} className="test-class">
        Sell
      </SellGate>,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
