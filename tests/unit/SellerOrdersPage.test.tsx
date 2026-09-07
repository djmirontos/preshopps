import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { AuthUser } from "@/lib/auth/session";
import type { MyShop } from "@/lib/seller/get-my-shop";
import type { SellerOrderSummary, GetMyShopOrdersResult } from "@/lib/seller/get-my-shop-orders";

const { getAuthUserMock, getMyShopMock, getMyShopOrdersMock, redirectMock } = vi.hoisted(() => ({
  getAuthUserMock: vi.fn<() => Promise<AuthUser | null>>(),
  getMyShopMock: vi.fn<() => Promise<MyShop | null>>(),
  getMyShopOrdersMock: vi.fn<() => Promise<GetMyShopOrdersResult>>(),
  redirectMock: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

vi.mock("@/lib/auth/session", () => ({
  getAuthUser: getAuthUserMock,
}));

vi.mock("@/lib/seller/get-my-shop", () => ({
  getMyShop: getMyShopMock,
}));

vi.mock("@/lib/seller/get-my-shop-orders", () => ({
  getMyShopOrders: getMyShopOrdersMock,
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

import SellerOrdersPage from "@/app/seller/orders/page";

function makeOrder(overrides: Partial<SellerOrderSummary> = {}): SellerOrderSummary {
  return {
    orderId: "11111111-1111-1111-1111-111111111111",
    orderPublicCode: "PSO-ABC12345",
    buyerDisplayName: "Jane D.",
    status: "pending",
    fulfillmentMethod: "meetup",
    createdAt: "2026-01-05T00:00:00.000Z",
    itemCount: 2,
    totalCents: 90000,
    ...overrides,
  };
}

describe("SellerOrdersPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects a guest to sign-in with next=/seller/orders before checking for a shop or fetching orders", async () => {
    getAuthUserMock.mockResolvedValue(null);
    await expect(SellerOrdersPage()).rejects.toThrow("NEXT_REDIRECT:/sign-in?next=%2Fseller%2Forders");
    expect(getMyShopMock).not.toHaveBeenCalled();
    expect(getMyShopOrdersMock).not.toHaveBeenCalled();
  });

  it("shows a simple explanatory state (not an error) for an authenticated user with no shop", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: "seller@example.com" });
    getMyShopMock.mockResolvedValue(null);

    render(await SellerOrdersPage());

    expect(screen.getByText(/don't have a shop yet/i)).toBeInTheDocument();
    expect(getMyShopOrdersMock).not.toHaveBeenCalled();
  });

  it("shows the empty state for a shop owner with no orders yet", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: "seller@example.com" });
    getMyShopMock.mockResolvedValue({ id: "shop-1", slug: "annes-closet", name: "Anne's Closet" });
    getMyShopOrdersMock.mockResolvedValue({ orders: [], hadError: false, nextCursor: null });

    render(await SellerOrdersPage());

    expect(screen.getByText("No orders yet.")).toBeInTheDocument();
  });

  it("renders one h1 and the shop's own orders with buyer display name and public code", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: "seller@example.com" });
    getMyShopMock.mockResolvedValue({ id: "shop-1", slug: "annes-closet", name: "Anne's Closet" });
    getMyShopOrdersMock.mockResolvedValue({
      orders: [makeOrder({ orderPublicCode: "PSO-NEWEST", createdAt: "2026-01-10T00:00:00.000Z" })],
      hadError: false,
      nextCursor: null,
    });

    render(await SellerOrdersPage());

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1, name: "Seller Orders" })).toBeInTheDocument();
    expect(screen.getByText("PSO-NEWEST")).toBeInTheDocument();
    expect(screen.getByText("Jane D.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /PSO-NEWEST/ })).toHaveAttribute("href", "/seller/orders/PSO-NEWEST");
  });

  it("never renders a raw order UUID or a buyer email as visible text", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: "seller@example.com" });
    getMyShopMock.mockResolvedValue({ id: "shop-1", slug: "annes-closet", name: "Anne's Closet" });
    getMyShopOrdersMock.mockResolvedValue({
      orders: [makeOrder({ orderId: "11111111-1111-1111-1111-111111111111" })],
      hadError: false,
      nextCursor: null,
    });

    render(await SellerOrdersPage());

    expect(screen.queryByText(/11111111-1111-1111-1111-111111111111/)).not.toBeInTheDocument();
    expect(screen.queryByText(/@example\.com/)).not.toBeInTheDocument();
  });

  it("shows a safe error state (not a crash) when the RPC fails", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: "seller@example.com" });
    getMyShopMock.mockResolvedValue({ id: "shop-1", slug: "annes-closet", name: "Anne's Closet" });
    getMyShopOrdersMock.mockResolvedValue({ orders: [], hadError: true, nextCursor: null });

    render(await SellerOrdersPage());
    expect(screen.getByText(/unable to load your shop's orders right now/i)).toBeInTheDocument();
  });
});
