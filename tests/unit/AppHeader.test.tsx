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

  it("renders both the box icon and the wordmark as local image assets in one lockup", () => {
    render(<AppHeader user={null} />);
    const logo = screen.getByRole("link", { name: "Preshopps" });
    const images = logo.querySelectorAll("img");
    expect(images).toHaveLength(2);
    for (const image of images) {
      // Local /public asset -- no remote image host introduced.
      expect(image.getAttribute("src")).not.toMatch(/^https?:\/\//);
    }
  });

  it("carries exactly one accessible brand name, not one per image", () => {
    render(<AppHeader user={null} />);
    const logo = screen.getByRole("link", { name: "Preshopps" });
    // The accessible name comes from the link's own aria-label; both
    // images are decorative (alt="") so they never contribute a second
    // competing name/announcement.
    for (const image of logo.querySelectorAll("img")) {
      expect(image).toHaveAttribute("alt", "");
    }
    expect(screen.getAllByRole("link", { name: "Preshopps" })).toHaveLength(1);
  });

  it("still renders Bell and Cart controls in the mobile header alongside the logo", () => {
    render(<AppHeader user={null} />);
    expect(screen.getAllByLabelText("Notifications").length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText("Cart").length).toBeGreaterThan(0);
  });

  it("renders accessible labels for the core action icons", () => {
    render(<AppHeader user={null} />);
    expect(screen.getAllByLabelText("Notifications").length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText("Cart").length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText("Favorites").length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText("Messages").length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText("Account").length).toBeGreaterThan(0);
  });

  it("links the Favorites icon to the real /favorites route, not a placeholder", () => {
    render(<AppHeader user={null} />);
    expect(screen.getByLabelText("Favorites")).toHaveAttribute("href", "/favorites");
  });

  it("links the Cart icon to the real /cart route, not a placeholder", () => {
    render(<AppHeader user={null} />);
    for (const link of screen.getAllByLabelText("Cart")) {
      expect(link).toHaveAttribute("href", "/cart");
    }
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
