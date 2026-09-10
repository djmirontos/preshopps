import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { AuthUser } from "@/lib/auth/session";
import type { OrderDetailResult, OrderDetail } from "@/lib/orders/get-my-order-detail";
import type { OrderReviewResult } from "@/lib/reviews/get-order-review";
import type { GetOrderDisputeSummaryResult } from "@/lib/disputes/get-order-dispute-summary";

const { getAuthUserMock, getMyOrderDetailMock, getOrderReviewMock, getOrderDisputeSummaryMock, redirectMock, notFoundMock, refreshMock } =
  vi.hoisted(() => ({
    getAuthUserMock: vi.fn<() => Promise<AuthUser | null>>(),
    getMyOrderDetailMock: vi.fn<(code: string) => Promise<OrderDetailResult>>(),
    getOrderReviewMock: vi.fn<(orderId: string) => Promise<OrderReviewResult>>(),
    getOrderDisputeSummaryMock: vi.fn<(orderId: string) => Promise<GetOrderDisputeSummaryResult>>(),
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

vi.mock("@/lib/orders/get-my-order-detail", () => ({
  getMyOrderDetail: getMyOrderDetailMock,
}));

vi.mock("@/lib/reviews/get-order-review", () => ({
  getOrderReview: getOrderReviewMock,
}));

vi.mock("@/lib/disputes/get-order-dispute-summary", () => ({
  getOrderDisputeSummary: getOrderDisputeSummaryMock,
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
  notFound: notFoundMock,
  useRouter: () => ({ refresh: refreshMock }),
}));

import OrderDetailPage from "@/app/orders/[publicCode]/page";

const params = Promise.resolve({ publicCode: "PSO-ABC12345" });

function sampleOrder(overrides: Partial<OrderDetail> = {}): OrderDetail {
  return {
    orderId: "order-uuid-1",
    orderPublicCode: "PSO-ABC12345",
    shopId: "shop-1",
    shopSlug: "annes-closet",
    shopName: "Anne's Closet",
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

describe("OrderDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getOrderReviewMock.mockResolvedValue({ status: "not_found" });
    getOrderDisputeSummaryMock.mockResolvedValue({ status: "found", summary: null });
  });

  it("redirects a guest to sign-in with the order's own path preserved as next=", async () => {
    getAuthUserMock.mockResolvedValue(null);
    await expect(OrderDetailPage({ params })).rejects.toThrow(
      `NEXT_REDIRECT:/sign-in?next=${encodeURIComponent("/orders/PSO-ABC12345")}`,
    );
    expect(getMyOrderDetailMock).not.toHaveBeenCalled();
  });

  it("renders the buyer's own order: code, status, seller, date, items, fulfillment, total", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: "buyer@example.com" });
    getMyOrderDetailMock.mockResolvedValue({ status: "found", order: sampleOrder() });

    render(await OrderDetailPage({ params }));

    expect(screen.getByRole("heading", { level: 1, name: "PSO-ABC12345" })).toBeInTheDocument();
    expect(screen.getByText("Pending")).toBeInTheDocument();
    expect(screen.getByText(/waiting for the seller to review/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Anne's Closet" })).toHaveAttribute("href", "/shop/annes-closet");
    expect(screen.getByText("Uniqlo Airism Cotton T-Shirt")).toBeInTheDocument();
    expect(screen.getByText("Meetup")).toBeInTheDocument();
    // Order total and the single line item's own subtotal both happen to
    // equal ₱900 here (one item) -- both are legitimately expected.
    expect(screen.getAllByText("₱900")).toHaveLength(2);
  });

  it("shows the buyer note only when one exists", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: "buyer@example.com" });
    getMyOrderDetailMock.mockResolvedValue({ status: "found", order: sampleOrder({ buyerNote: "Please call before arriving." }) });

    render(await OrderDetailPage({ params }));
    expect(screen.getByText("Please call before arriving.")).toBeInTheDocument();
  });

  it("omits the buyer note section entirely when there is none", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: "buyer@example.com" });
    getMyOrderDetailMock.mockResolvedValue({ status: "found", order: sampleOrder({ buyerNote: null }) });

    render(await OrderDetailPage({ params }));
    expect(screen.queryByText("Your note")).not.toBeInTheDocument();
  });

  it("shows Shipped rather than Handed Over when fulfillment method is shipping", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: "buyer@example.com" });
    getMyOrderDetailMock.mockResolvedValue({
      status: "found",
      order: sampleOrder({ status: "handed_over_or_shipped", fulfillmentMethod: "shipping" }),
    });

    render(await OrderDetailPage({ params }));
    expect(screen.getByText("Shipped")).toBeInTheDocument();
    expect(screen.getByText(/marked this order as shipped/i)).toBeInTheDocument();
  });

  it("never renders a raw order/item/listing UUID as visible text", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: "buyer@example.com" });
    getMyOrderDetailMock.mockResolvedValue({ status: "found", order: sampleOrder() });

    render(await OrderDetailPage({ params }));
    expect(screen.queryByText(/order-uuid-1|item-uuid-1|listing-uuid-1/)).not.toBeInTheDocument();
  });

  it("calls Next's notFound() for a nonexistent order (never a distinguishing error)", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: "buyer@example.com" });
    getMyOrderDetailMock.mockResolvedValue({ status: "not_found" });

    await expect(OrderDetailPage({ params })).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("calls the identical notFound() path for another buyer's order as for a nonexistent one", async () => {
    // get_my_order_detail itself returns zero rows in both cases -- the
    // page has no way to (and must not) distinguish them.
    getAuthUserMock.mockResolvedValue({ id: "u1", email: "buyer@example.com" });
    getMyOrderDetailMock.mockResolvedValue({ status: "not_found" });

    await expect(OrderDetailPage({ params })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFoundMock).toHaveBeenCalledTimes(1);
  });

  it("shows a safe error state (not a crash) on a backend read failure", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: "buyer@example.com" });
    getMyOrderDetailMock.mockResolvedValue({ status: "error" });

    render(await OrderDetailPage({ params }));
    expect(screen.getByText(/unable to load this order right now/i)).toBeInTheDocument();
  });
});
