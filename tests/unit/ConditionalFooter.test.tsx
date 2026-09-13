import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const { usePathnameMock } = vi.hoisted(() => ({ usePathnameMock: vi.fn() }));

vi.mock("next/navigation", () => ({
  usePathname: usePathnameMock,
}));

import { ConditionalFooter } from "@/components/layout/ConditionalFooter";

describe("ConditionalFooter", () => {
  it("renders the normal, always-visible Footer on an ordinary route", () => {
    usePathnameMock.mockReturnValue("/search");
    const { container } = render(<ConditionalFooter />);
    expect(screen.getByRole("link", { name: "How It Works" })).toBeInTheDocument();
    // No hidden/lg:block wrapper on the ordinary-route path.
    expect(container.querySelector(".hidden.lg\\:block")).not.toBeInTheDocument();
  });

  it("renders the normal, always-visible Footer on the messages LIST route (/messages) -- only the conversation-detail screen is a mobile fullscreen chat", () => {
    usePathnameMock.mockReturnValue("/messages");
    const { container } = render(<ConditionalFooter />);
    expect(screen.getByRole("link", { name: "How It Works" })).toBeInTheDocument();
    expect(container.querySelector(".hidden.lg\\:block")).not.toBeInTheDocument();
  });

  it("wraps the Footer in `hidden lg:block` on the conversation-detail route (/messages/[id]) -- hidden below lg, still shown at lg and up", () => {
    usePathnameMock.mockReturnValue("/messages/conv-123");
    const { container } = render(<ConditionalFooter />);
    // The Footer itself is still rendered (desktop's own unaffected
    // treatment keeps showing it) -- only its wrapper's visibility changes.
    expect(screen.getByRole("link", { name: "How It Works" })).toBeInTheDocument();
    const wrapper = container.querySelector(".hidden.lg\\:block");
    expect(wrapper).toBeInTheDocument();
    expect(wrapper?.querySelector("footer")).toBeInTheDocument();
  });

  it("does not match a route nested deeper than /messages/[id]", () => {
    usePathnameMock.mockReturnValue("/messages/conv-123/somewhere-else");
    const { container } = render(<ConditionalFooter />);
    expect(container.querySelector(".hidden.lg\\:block")).not.toBeInTheDocument();
  });
});
