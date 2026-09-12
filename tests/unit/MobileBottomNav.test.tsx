import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

import { MobileBottomNav } from "@/components/layout/MobileBottomNav";
import { NotificationsProvider } from "@/components/notifications/NotificationsProvider";

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

  it("authenticated without a shop: Sell links to /seller/shop", () => {
    render(<MobileBottomNav user={{ id: "u1", email: "seller@example.com" }} hasShop={false} />);
    expect(screen.getByRole("link", { name: "Sell" })).toHaveAttribute("href", "/seller/shop");
  });

  it("authenticated with a shop: Sell links directly to /sell", () => {
    render(<MobileBottomNav user={{ id: "u1", email: "seller@example.com" }} hasShop />);
    expect(screen.getByRole("link", { name: "Sell" })).toHaveAttribute("href", "/sell");
  });

  it("defaults hasShop to false when omitted, so an authenticated caller with no shop data still gets a safe destination", () => {
    render(<MobileBottomNav user={{ id: "u1", email: "seller@example.com" }} />);
    expect(screen.getByRole("link", { name: "Sell" })).toHaveAttribute("href", "/seller/shop");
  });

  it("shows no Messages badge when unreadMessageCount is 0 (the default, no Provider ancestor)", () => {
    render(<MobileBottomNav user={null} />);
    // The tab's own "Messages" text label is always visible; only the
    // numeric badge overlay is conditional on there being unread messages.
    expect(screen.getByRole("link", { name: "Messages" }).textContent).toBe("Messages");
  });

  it("shows a live Messages badge sourced from the shared NotificationsProvider, with an accessible unread label", () => {
    render(
      <NotificationsProvider isAuthenticated={false} userId={null} initialUnreadMessageCount={3} initialUnreadNotificationCount={0}>
        <MobileBottomNav user={null} />
      </NotificationsProvider>,
    );
    const messagesTab = screen.getByRole("link", { name: "Messages, 3 unread" });
    expect(messagesTab).toBeInTheDocument();
    expect(messagesTab.textContent).toContain("3");
  });

  it("caps the Messages badge at 99+ for a very large unread count", () => {
    render(
      <NotificationsProvider isAuthenticated={false} userId={null} initialUnreadMessageCount={150} initialUnreadNotificationCount={0}>
        <MobileBottomNav user={null} />
      </NotificationsProvider>,
    );
    expect(screen.getByText("99+")).toBeInTheDocument();
  });

  it("does not add a bell/notifications icon to the bottom nav -- still exactly 5 tabs", () => {
    render(
      <NotificationsProvider isAuthenticated={false} userId={null} initialUnreadMessageCount={0} initialUnreadNotificationCount={9}>
        <MobileBottomNav user={null} />
      </NotificationsProvider>,
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(5);
    expect(screen.queryByLabelText(/notification/i)).not.toBeInTheDocument();
    expect(screen.queryByText("9")).not.toBeInTheDocument();
  });

  it("adding the Messages badge introduces no layout shift -- every tab's icon slot is still the same h-9 w-9 size", () => {
    render(
      <NotificationsProvider isAuthenticated={false} userId={null} initialUnreadMessageCount={3} initialUnreadNotificationCount={0}>
        <MobileBottomNav user={null} />
      </NotificationsProvider>,
    );
    const tabs = [
      screen.getByRole("link", { name: "Home" }),
      screen.getByRole("link", { name: "Search" }),
      screen.getByRole("button", { name: "Sell" }),
      screen.getByRole("link", { name: "Messages, 3 unread" }),
      screen.getByRole("link", { name: "Account" }),
    ];
    for (const tab of tabs) {
      const slot = tab.querySelector("span.h-9.w-9");
      expect(slot, `${tab.getAttribute("aria-label") ?? tab.textContent} is missing its h-9 w-9 icon slot`).not.toBeNull();
    }
  });
});
