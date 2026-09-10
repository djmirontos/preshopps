import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Footer } from "@/components/layout/Footer";

/**
 * Every footer link used to be a dead "#" placeholder. This proves each
 * one now points to a real route created for the P0 legal/public-pages
 * batch, and that the PRD 43.3 public contact email is shown.
 */
describe("Footer", () => {
  it("has no dead '#' links", () => {
    render(<Footer />);
    const links = screen.getAllByRole("link");
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link).not.toHaveAttribute("href", "#");
    }
  });

  it("links to every required public informational page", () => {
    render(<Footer />);
    expect(screen.getByRole("link", { name: "How It Works" })).toHaveAttribute("href", "/how-it-works");
    expect(screen.getByRole("link", { name: "Safety Tips" })).toHaveAttribute("href", "/safety");
    expect(screen.getByRole("link", { name: "Terms" })).toHaveAttribute("href", "/terms");
    expect(screen.getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/privacy");
    expect(screen.getByRole("link", { name: "Marketplace Rules" })).toHaveAttribute("href", "/marketplace-rules");
    expect(screen.getByRole("link", { name: "Prohibited Items" })).toHaveAttribute("href", "/prohibited-items");
    expect(screen.getByRole("link", { name: "Contact" })).toHaveAttribute("href", "/support");
  });

  it("shows the public support email (PRD 43.3)", () => {
    render(<Footer />);
    expect(screen.getByRole("link", { name: "support@preshopps.com" })).toHaveAttribute("href", "mailto:support@preshopps.com");
  });
});
