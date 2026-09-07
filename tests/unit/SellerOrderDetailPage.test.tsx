import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { AuthUser } from "@/lib/auth/session";
import type { SellerOrderDetailResult, SellerOrderDetail } from "@/lib/seller/get-my-shop-order-detail";

const { getAuthUserMock, getMyShopOrderDetailMock, redirectMock, notFoundMock, refreshMock } = vi.hoisted(() => ({
  getAuthUserMock: vi.fn<() => Promise<AuthUser | null>>(),
  getMyShopOrderDetailMock: vi.fn<(code: string) => Promise<SellerOrderDetailResult>>(),
  redirectMock: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  notFoundMock: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  refreshMock: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  getAuthUser: getAuthUserMock,
}));

vi.mock("@/lib/seller/get-my-shop-order-detail", () => ({
  getMyShopOrderDetail: getMyShopOrderDetailMock,
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
  notFound: notFoundMock,
  useRouter: () => ({ refresh: refreshMock }),
}));

import SellerOrderDetailPage from "@/app/seller/orders/[publicCode]/page";

const params = Promise.resolve({ publicCode: "PSO-ABC12345" });

function sampleOrder(overrides: Partial<SellerOrderDetail> = {}): SellerOrderDetail {
  return {
    orderId: "order-uuid-1",
    orderPublicCode: "PSO-ABC12345",
    buyerDisplayName: "Jane D.",
    status: "pending" as const,
    fulfillmentMethod: "meetup" as const,
    buyerNote: null,
    createdAt: "2026-01-05T00:00:00.000Z",
    pendingCancellationRequestId: null,
    pendingCancellationReason: null,
    items: [
      {
        orderItemId: "item-uuid-1",
        listingId: "listing-uuid-1",
        listingPublicCode: "PLS-XYZ",
        title: "Uniqlo Airism Cotton T-Shirt",
        imageUrl: undefined,
        quantity: 2,
        priceCentsSnapshot: 45000,
        status: "pending" as const,
      },
    ],
    totalCents: 90000,
    ...overrides,
  };
}

describe("SellerOrderDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects a guest to sign-in with the order's own path preserved as next=", async () => {
    getAuthUserMock.mockResolvedValue(null);
    await expect(SellerOrderDetailPage({ params })).rejects.toThrow(
      `NEXT_REDIRECT:/sign-in?next=${encodeURIComponent("/seller/orders/PSO-ABC12345")}`,
    );
    expect(getMyShopOrderDetailMock).not.toHaveBeenCalled();
  });

  it("renders the seller's own order: code, status, buyer display name, date, items, fulfillment, total", async () => {
    getAuthUserMock.mockResolvedValue({ id: "seller-1", email: "seller@example.com" });
    getMyShopOrderDetailMock.mockResolvedValue({ status: "found", order: sampleOrder() });

    render(await SellerOrderDetailPage({ params }));

    expect(screen.getByRole("heading", { level: 1, name: "PSO-ABC12345" })).toBeInTheDocument();
    expect(screen.getAllByText("Pending").length).toBeGreaterThan(0);
    expect(screen.getByText("Jane D.")).toBeInTheDocument();
    expect(screen.getByText("Uniqlo Airism Cotton T-Shirt")).toBeInTheDocument();
    expect(screen.getByText("Meetup")).toBeInTheDocument();
  });

  it("shows the buyer note only when one exists", async () => {
    getAuthUserMock.mockResolvedValue({ id: "seller-1", email: "seller@example.com" });
    getMyShopOrderDetailMock.mockResolvedValue({ status: "found", order: sampleOrder({ buyerNote: "Please meet at the mall entrance." }) });

    render(await SellerOrderDetailPage({ params }));
    expect(screen.getByText("Please meet at the mall entrance.")).toBeInTheDocument();
  });

  it("never renders a raw order/item/listing UUID or a buyer email as visible text", async () => {
    getAuthUserMock.mockResolvedValue({ id: "seller-1", email: "seller@example.com" });
    getMyShopOrderDetailMock.mockResolvedValue({ status: "found", order: sampleOrder() });

    render(await SellerOrderDetailPage({ params }));
    expect(screen.queryByText(/order-uuid-1|item-uuid-1|listing-uuid-1/)).not.toBeInTheDocument();
    expect(screen.queryByText(/@example\.com/)).not.toBeInTheDocument();
  });

  it("calls Next's notFound() for a nonexistent order code, identical to another seller's order", async () => {
    getAuthUserMock.mockResolvedValue({ id: "seller-1", email: "seller@example.com" });
    getMyShopOrderDetailMock.mockResolvedValue({ status: "not_found" });

    await expect(SellerOrderDetailPage({ params })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFoundMock).toHaveBeenCalledTimes(1);
  });

  it("shows a safe error state (not a crash) on a backend read failure", async () => {
    getAuthUserMock.mockResolvedValue({ id: "seller-1", email: "seller@example.com" });
    getMyShopOrderDetailMock.mockResolvedValue({ status: "error" });

    render(await SellerOrderDetailPage({ params }));
    expect(screen.getByText(/unable to load this order right now/i)).toBeInTheDocument();
  });

  it("hides all lifecycle actions for a completed order", async () => {
    getAuthUserMock.mockResolvedValue({ id: "seller-1", email: "seller@example.com" });
    getMyShopOrderDetailMock.mockResolvedValue({
      status: "found",
      order: sampleOrder({ status: "completed", items: [{ ...sampleOrder().items[0], status: "accepted" }] }),
    });

    render(await SellerOrderDetailPage({ params }));
    expect(screen.queryByRole("button", { name: /accept order|save decisions|decline order|mark ready|mark shipped|mark handed over|cancel order/i })).not.toBeInTheDocument();
  });
});
