import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { AuthUser } from "@/lib/auth/session";

const { getAuthUserMock, getMyCartMock } = vi.hoisted(() => ({
  getAuthUserMock: vi.fn<() => Promise<AuthUser | null>>(),
  getMyCartMock: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  getAuthUser: getAuthUserMock,
}));

vi.mock("@/lib/cart/get-my-cart", () => ({
  getMyCart: getMyCartMock,
}));

vi.mock("@/components/cart/AuthenticatedCartClient", () => ({
  AuthenticatedCartClient: ({ initialLines }: { initialLines: unknown[] }) => (
    <div data-testid="authenticated-cart">{initialLines.length} lines</div>
  ),
}));

vi.mock("@/components/cart/GuestCartClient", () => ({
  GuestCartClient: () => <div data-testid="guest-cart">guest cart</div>,
}));

import CartPage from "@/app/cart/page";

describe("CartPage", () => {
  it("renders the guest cart client for a guest, without calling getMyCart", async () => {
    getAuthUserMock.mockResolvedValue(null);
    render(await CartPage());

    expect(screen.getByTestId("guest-cart")).toBeInTheDocument();
    expect(getMyCartMock).not.toHaveBeenCalled();
  });

  it("renders the authenticated cart client with server-fetched lines for a signed-in user", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: "buyer@example.com" });
    getMyCartMock.mockResolvedValue({ lines: [{ listingId: "l1" }], hadError: false });

    render(await CartPage());

    expect(screen.getByTestId("authenticated-cart")).toHaveTextContent("1 lines");
  });

  it("renders exactly one h1", async () => {
    getAuthUserMock.mockResolvedValue(null);
    render(await CartPage());
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });
});
