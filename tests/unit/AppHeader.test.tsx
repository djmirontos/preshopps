import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

import { AppHeader } from "@/components/layout/AppHeader";
import { NotificationsProvider } from "@/components/notifications/NotificationsProvider";

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

  it("links the Bell to the real /notifications route, not a placeholder", () => {
    render(<AppHeader user={null} />);
    for (const link of screen.getAllByLabelText("Notifications")) {
      expect(link).toHaveAttribute("href", "/notifications");
    }
  });

  it("renders no unread badge when rendered without a NotificationsProvider ancestor (context default is 0)", () => {
    render(<AppHeader user={null} />);
    for (const link of screen.getAllByLabelText("Notifications")) {
      expect(link.textContent).toBe("");
    }
  });

  it("renders an unread badge with the count and an accessible label when the notifications Provider is seeded with unread notifications", () => {
    render(
      <NotificationsProvider isAuthenticated={false} userId={null} initialUnreadMessageCount={0} initialUnreadNotificationCount={3}>
        <AppHeader user={{ id: "u1", email: "buyer@example.com" }} />
      </NotificationsProvider>,
    );
    expect(screen.getAllByLabelText("Notifications, 3 unread").length).toBeGreaterThan(0);
    expect(screen.getAllByText("3").length).toBeGreaterThan(0);
  });

  it("caps the displayed badge at 99+ for a very large unread count", () => {
    render(
      <NotificationsProvider isAuthenticated={false} userId={null} initialUnreadMessageCount={0} initialUnreadNotificationCount={150}>
        <AppHeader user={{ id: "u1", email: "buyer@example.com" }} />
      </NotificationsProvider>,
    );
    expect(screen.getAllByText("99+").length).toBeGreaterThan(0);
  });

  it("desktop Messages icon shows its own unreadMessageCount badge, independent of the Bell", () => {
    render(
      <NotificationsProvider isAuthenticated={false} userId={null} initialUnreadMessageCount={4} initialUnreadNotificationCount={0}>
        <AppHeader user={{ id: "u1", email: "buyer@example.com" }} />
      </NotificationsProvider>,
    );
    expect(screen.getByLabelText("Messages, 4 unread")).toBeInTheDocument();
    // The Bell stays badge-less since unreadNotificationCount is 0.
    for (const link of screen.getAllByLabelText("Notifications")) {
      expect(link.textContent).toBe("");
    }
  });

  it("a new_message-driven unreadMessageCount never shows up on the Bell, and vice versa", () => {
    render(
      <NotificationsProvider isAuthenticated={false} userId={null} initialUnreadMessageCount={2} initialUnreadNotificationCount={5}>
        <AppHeader user={{ id: "u1", email: "buyer@example.com" }} />
      </NotificationsProvider>,
    );
    expect(screen.getByLabelText("Messages, 2 unread")).toBeInTheDocument();
    expect(screen.getAllByLabelText("Notifications, 5 unread").length).toBeGreaterThan(0);
    // Never merged/summed into a single number anywhere.
    expect(screen.queryByLabelText("Messages, 7 unread")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Notifications, 7 unread")).not.toBeInTheDocument();
  });

  it("Messages icon shows no badge when rendered without a NotificationsProvider ancestor (context default is 0)", () => {
    render(<AppHeader user={null} />);
    expect(screen.getByLabelText("Messages").textContent).toBe("");
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

  it("authenticated without a shop: Sell links to /seller/shop", () => {
    render(<AppHeader user={{ id: "u1", email: "seller@example.com" }} hasShop={false} />);
    expect(screen.getByRole("link", { name: /sell/i })).toHaveAttribute("href", "/seller/shop");
  });

  it("authenticated with a shop: Sell links directly to /sell", () => {
    render(<AppHeader user={{ id: "u1", email: "seller@example.com" }} hasShop />);
    expect(screen.getByRole("link", { name: /sell/i })).toHaveAttribute("href", "/sell");
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

  it("does not render an 'All Philippines'/'All PH' location control -- nationwide is already the default scope", () => {
    render(<AppHeader user={null} />);
    expect(screen.queryByText("All Philippines")).not.toBeInTheDocument();
    expect(screen.queryByText("All PH")).not.toBeInTheDocument();
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
