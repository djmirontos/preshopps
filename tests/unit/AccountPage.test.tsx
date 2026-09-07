import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { AuthUser } from "@/lib/auth/session";

const { getAuthUserMock, redirectMock, signOutActionMock } = vi.hoisted(() => ({
  getAuthUserMock: vi.fn<() => Promise<AuthUser | null>>(),
  redirectMock: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  signOutActionMock: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  getAuthUser: getAuthUserMock,
}));

vi.mock("@/lib/auth/actions", () => ({
  signOutAction: signOutActionMock,
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

import AccountPage from "@/app/account/page";

describe("AccountPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects a guest to sign-in with next=/account before rendering anything", async () => {
    getAuthUserMock.mockResolvedValue(null);
    await expect(AccountPage()).rejects.toThrow("NEXT_REDIRECT:/sign-in?next=%2Faccount");
  });

  it("renders the signed-in email and a Sign out control for an authenticated user", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: "buyer@example.com" });
    render(await AccountPage());

    expect(screen.getByText("buyer@example.com")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign out/i })).toBeInTheDocument();
  });

  it("renders a Favorites link pointing at /favorites for an authenticated user", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: "buyer@example.com" });
    render(await AccountPage());

    expect(screen.getByRole("link", { name: /favorites/i })).toHaveAttribute("href", "/favorites");
  });

  it("renders an Orders link pointing at /orders for an authenticated user", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: "buyer@example.com" });
    render(await AccountPage());

    expect(screen.getByRole("link", { name: "Orders" })).toHaveAttribute("href", "/orders");
  });

  it("renders a Seller Orders link pointing at /seller/orders for an authenticated user", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: "buyer@example.com" });
    render(await AccountPage());

    expect(screen.getByRole("link", { name: "Seller Orders" })).toHaveAttribute("href", "/seller/orders");
  });

  it("renders a My Shop link pointing at /seller/shop for an authenticated user", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: "buyer@example.com" });
    render(await AccountPage());

    expect(screen.getByRole("link", { name: "My Shop" })).toHaveAttribute("href", "/seller/shop");
  });

  it("never renders account content before the server auth check resolves negatively", async () => {
    getAuthUserMock.mockResolvedValue(null);
    await expect(AccountPage()).rejects.toThrow();
    // The redirect throws before any JSX is returned -- there is nothing
    // to render, so no account data could ever reach the client.
  });
});
