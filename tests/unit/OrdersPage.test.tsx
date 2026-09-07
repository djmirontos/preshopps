import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { AuthUser } from "@/lib/auth/session";
import type { OrderSummary, GetMyOrdersResult } from "@/lib/orders/get-my-orders";

const { getAuthUserMock, getMyOrdersMock, redirectMock } = vi.hoisted(() => ({
  getAuthUserMock: vi.fn<() => Promise<AuthUser | null>>(),
  getMyOrdersMock: vi.fn<() => Promise<GetMyOrdersResult>>(),
  redirectMock: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

vi.mock("@/lib/auth/session", () => ({
  getAuthUser: getAuthUserMock,
}));

vi.mock("@/lib/orders/get-my-orders", () => ({
  getMyOrders: getMyOrdersMock,
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

import OrdersPage from "@/app/orders/page";

function makeOrder(overrides: Partial<OrderSummary> = {}): OrderSummary {
  return {
    orderId: "11111111-1111-1111-1111-111111111111",
    orderPublicCode: "PSO-ABC12345",
    shopId: "shop-1",
    shopSlug: "annes-closet",
    shopName: "Anne's Closet",
    status: "pending",
    fulfillmentMethod: "meetup",
    createdAt: "2026-01-05T00:00:00.000Z",
    itemCount: 2,
    totalCents: 90000,
    ...overrides,
  };
}

describe("OrdersPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects a guest to sign-in with next=/orders before fetching any order data", async () => {
    getAuthUserMock.mockResolvedValue(null);
    await expect(OrdersPage()).rejects.toThrow("NEXT_REDIRECT:/sign-in?next=%2Forders");
    expect(getMyOrdersMock).not.toHaveBeenCalled();
  });

  it("shows the empty state for an authenticated buyer with no orders", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: "buyer@example.com" });
    getMyOrdersMock.mockResolvedValue({ orders: [], hadError: false, nextCursor: null });

    render(await OrdersPage());

    expect(screen.getByText("No orders yet.")).toBeInTheDocument();
    expect(screen.getByText("Orders you place will appear here.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /browse listings/i })).toHaveAttribute("href", "/search");
  });

  it("renders one h1 and the populated order list with public codes visible", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: "buyer@example.com" });
    getMyOrdersMock.mockResolvedValue({
      orders: [makeOrder({ orderPublicCode: "PSO-NEWEST", createdAt: "2026-01-10T00:00:00.000Z" })],
      hadError: false,
      nextCursor: null,
    });

    render(await OrdersPage());

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1, name: "Orders" })).toBeInTheDocument();
    expect(screen.getByText("PSO-NEWEST")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /PSO-NEWEST/ })).toHaveAttribute("href", "/orders/PSO-NEWEST");
  });

  it("renders orders in whatever order the RPC returns (newest-first is the RPC's own contract) without reordering client-side", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: "buyer@example.com" });
    getMyOrdersMock.mockResolvedValue({
      orders: [
        makeOrder({ orderId: "id-1", orderPublicCode: "PSO-NEWER", createdAt: "2026-01-10T00:00:00.000Z" }),
        makeOrder({ orderId: "id-2", orderPublicCode: "PSO-OLDER", createdAt: "2026-01-01T00:00:00.000Z" }),
      ],
      hadError: false,
      nextCursor: null,
    });

    render(await OrdersPage());

    const codes = screen.getAllByText(/^PSO-/).map((el) => el.textContent);
    expect(codes).toEqual(["PSO-NEWER", "PSO-OLDER"]);
  });

  it("never renders a raw order UUID as visible text", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: "buyer@example.com" });
    getMyOrdersMock.mockResolvedValue({
      orders: [makeOrder({ orderId: "11111111-1111-1111-1111-111111111111" })],
      hadError: false,
      nextCursor: null,
    });

    render(await OrdersPage());

    expect(screen.queryByText(/11111111-1111-1111-1111-111111111111/)).not.toBeInTheDocument();
  });

  it("shows a safe error state (not a crash) when the RPC fails", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: "buyer@example.com" });
    getMyOrdersMock.mockResolvedValue({ orders: [], hadError: true, nextCursor: null });

    render(await OrdersPage());
    expect(screen.getByText(/unable to load your orders right now/i)).toBeInTheDocument();
  });
});
