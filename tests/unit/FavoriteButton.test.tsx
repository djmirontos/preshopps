import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// Overrides the guest-default global mock from tests/setup/vitest.setup.ts
// with the real hook -- it now just reads AuthStatusProvider's context, so
// these tests can exercise both cases by wrapping in a real provider
// instead of mocking the hook itself.
vi.mock("@/lib/auth/use-is-authenticated", async (importOriginal) => importOriginal());

import { AuthStatusProvider } from "@/components/auth/AuthStatusProvider";
import { FavoriteButton } from "@/components/marketplace/FavoriteButton";

describe("FavoriteButton", () => {
  it("guest click opens the auth gate instead of toggling favorited state", () => {
    render(
      <AuthStatusProvider isAuthenticated={false}>
        <FavoriteButton label="Favorite Test Item" next="/item/PSO-ABC" />
      </AuthStatusProvider>,
    );

    const button = screen.getByRole("button", { name: "Favorite Test Item" });
    fireEvent.click(button);

    expect(screen.getByRole("dialog", { name: "Sign in to save items" })).toBeInTheDocument();
    expect(button).toHaveAttribute("aria-pressed", "false");
  });

  it("guest gate carries the given next path", () => {
    render(
      <AuthStatusProvider isAuthenticated={false}>
        <FavoriteButton label="Favorite Test Item" next="/item/PSO-ABC" />
      </AuthStatusProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Favorite Test Item" }));

    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      `/sign-in?next=${encodeURIComponent("/item/PSO-ABC")}`,
    );
  });

  it("authenticated click toggles local favorited state without opening the gate", () => {
    render(
      <AuthStatusProvider isAuthenticated={true}>
        <FavoriteButton label="Favorite Test Item" next="/item/PSO-ABC" />
      </AuthStatusProvider>,
    );

    const button = screen.getByRole("button", { name: "Favorite Test Item" });
    fireEvent.click(button);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(button).toHaveAttribute("aria-pressed", "true");
  });

  it("multiple FavoriteButtons under one provider all consume the same shared auth status", () => {
    render(
      <AuthStatusProvider isAuthenticated={true}>
        <FavoriteButton label="Item A" next="/item/PSO-A" />
        <FavoriteButton label="Item B" next="/item/PSO-B" />
      </AuthStatusProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Item A" }));
    fireEvent.click(screen.getByRole("button", { name: "Item B" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Item A" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Item B" })).toHaveAttribute("aria-pressed", "true");
  });
});
