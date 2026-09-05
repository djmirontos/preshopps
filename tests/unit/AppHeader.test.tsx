import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AppHeader } from "@/components/layout/AppHeader";

describe("AppHeader", () => {
  it("renders the Preshopps wordmark linking home", () => {
    render(<AppHeader />);
    const logo = screen.getByRole("link", { name: "Preshopps" });
    expect(logo).toBeInTheDocument();
    expect(logo).toHaveAttribute("href", "/");
  });

  it("renders accessible labels for the core action icons", () => {
    render(<AppHeader />);
    expect(screen.getAllByLabelText("Notifications").length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText("Cart").length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText("Favorites").length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText("Messages").length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText("Account").length).toBeGreaterThan(0);
  });

  it("renders the Sell call-to-action", () => {
    render(<AppHeader />);
    expect(screen.getByRole("link", { name: /sell/i })).toBeInTheDocument();
  });

  it("renders an accessible search input", () => {
    render(<AppHeader />);
    expect(screen.getAllByRole("textbox", { name: /search for anything/i }).length).toBeGreaterThan(0);
  });

  it("submits search to /search via a plain GET form (no client JS required)", () => {
    render(<AppHeader />);
    const inputs = screen.getAllByRole("textbox", { name: /search for anything/i });
    for (const input of inputs) {
      expect(input).toHaveAttribute("name", "q");
      const form = input.closest("form");
      expect(form).toHaveAttribute("action", "/search");
    }
  });

  it("links the location control into /search", () => {
    render(<AppHeader />);
    expect(screen.getByRole("link", { name: "All Philippines" })).toHaveAttribute("href", "/search");
    expect(screen.getByRole("link", { name: "All PH" })).toHaveAttribute("href", "/search");
  });
});
