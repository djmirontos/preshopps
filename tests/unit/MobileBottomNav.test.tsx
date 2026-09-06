import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

import { MobileBottomNav } from "@/components/layout/MobileBottomNav";

describe("MobileBottomNav", () => {
  it("renders exactly the 5 canonical tabs for a guest", () => {
    render(<MobileBottomNav user={null} />);
    expect(screen.getByRole("link", { name: "Home" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Search" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sell" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Messages" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Account" })).toBeInTheDocument();
  });

  it("marks Home as the active tab on the homepage path", () => {
    render(<MobileBottomNav user={null} />);
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Search" })).not.toHaveAttribute("aria-current");
  });

  it("guest Account tab links to sign-in with the current path as next", () => {
    render(<MobileBottomNav user={null} />);
    expect(screen.getByRole("link", { name: "Account" })).toHaveAttribute("href", "/sign-in?next=%2F");
  });

  it("authenticated Account tab links directly to /account", () => {
    render(<MobileBottomNav user={{ id: "u1", email: "buyer@example.com" }} />);
    expect(screen.getByRole("link", { name: "Account" })).toHaveAttribute("href", "/account");
  });

  it("gives every tab's icon slot the same size, so all 5 labels sit at the same baseline", () => {
    render(<MobileBottomNav user={null} />);
    const tabs = [
      screen.getByRole("link", { name: "Home" }),
      screen.getByRole("link", { name: "Search" }),
      screen.getByRole("button", { name: "Sell" }),
      screen.getByRole("link", { name: "Messages" }),
      screen.getByRole("link", { name: "Account" }),
    ];
    for (const tab of tabs) {
      const slot = tab.querySelector("span.h-9.w-9");
      expect(slot, `${tab.getAttribute("aria-label") ?? tab.textContent} is missing its h-9 w-9 icon slot`).not.toBeNull();
    }
  });

  it("uses the same 22-24px icon size for every non-Sell tab", () => {
    render(<MobileBottomNav user={null} />);
    for (const name of ["Home", "Search", "Messages", "Account"]) {
      const tab = screen.getByRole("link", { name });
      const icon = tab.querySelector("svg");
      expect(icon?.getAttribute("class")).toContain("h-6");
      expect(icon?.getAttribute("class")).toContain("w-6");
    }
  });

  it("keeps Sell only modestly emphasized -- a ~36px circle, not an oversized floating action button", () => {
    render(<MobileBottomNav user={null} />);
    const sellButton = screen.getByRole("button", { name: "Sell" });
    const circle = sellButton.querySelector(".rounded-full");
    expect(circle?.className).toContain("h-9");
    expect(circle?.className).toContain("w-9");
  });

  it("uses identical label typography for all 5 tabs", () => {
    render(<MobileBottomNav user={null} />);
    const labels = ["Home", "Search", "Sell", "Messages", "Account"].map((name) => screen.getByText(name));
    const classes = labels.map((label) => label.className);
    expect(new Set(classes.map((c) => c.replace("text-brand-link", "").replace("text-ink-muted", "").trim())).size).toBe(1);
  });

  it("uses the shared brand-link (navy) token for the active tab's text/icon, not orange", () => {
    render(<MobileBottomNav user={null} />);
    const activeLabel = screen.getByText("Home");
    expect(activeLabel.className).toContain("text-brand-link");
  });
});
