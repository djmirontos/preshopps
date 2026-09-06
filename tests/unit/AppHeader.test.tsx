import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

import { AppHeader } from "@/components/layout/AppHeader";

describe("AppHeader", () => {
  it("renders the Preshopps wordmark linking home", () => {
    render(<AppHeader user={null} />);
    const logo = screen.getByRole("link", { name: "Preshopps" });
    expect(logo).toBeInTheDocument();
    expect(logo).toHaveAttribute("href", "/");
  });

  it("renders accessible labels for the core action icons", () => {
    render(<AppHeader user={null} />);
    expect(screen.getAllByLabelText("Notifications").length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText("Cart").length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText("Favorites").length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText("Messages").length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText("Account").length).toBeGreaterThan(0);
  });

  it("renders the Sell call-to-action as a guest-gated control", () => {
    render(<AppHeader user={null} />);
    expect(screen.getByRole("button", { name: /sell/i })).toBeInTheDocument();
  });

  it("renders an accessible search input", () => {
    render(<AppHeader user={null} />);
    expect(screen.getAllByRole("textbox", { name: /search for anything/i }).length).toBeGreaterThan(0);
  });

  it("submits search to /search via a plain GET form (no client JS required)", () => {
    render(<AppHeader user={null} />);
    const inputs = screen.getAllByRole("textbox", { name: /search for anything/i });
    for (const input of inputs) {
      expect(input).toHaveAttribute("name", "q");
      const form = input.closest("form");
      expect(form).toHaveAttribute("action", "/search");
    }
  });

  it("links the location control into /search", () => {
    render(<AppHeader user={null} />);
    expect(screen.getByRole("link", { name: "All Philippines" })).toHaveAttribute("href", "/search");
    expect(screen.getByRole("link", { name: "All PH" })).toHaveAttribute("href", "/search");
  });

  it("links the guest Account icon to sign-in with the current path as next", () => {
    render(<AppHeader user={null} />);
    expect(screen.getByRole("link", { name: "Account" })).toHaveAttribute("href", "/sign-in?next=%2F");
  });

  it("renders an account menu instead of a sign-in link when authenticated", () => {
    render(<AppHeader user={{ id: "u1", email: "buyer@example.com" }} />);
    expect(screen.queryByRole("link", { name: "Account" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Account" })).toBeInTheDocument();
  });
});
