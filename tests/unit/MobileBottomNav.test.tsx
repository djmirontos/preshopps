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
});
