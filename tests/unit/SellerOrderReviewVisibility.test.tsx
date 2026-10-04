import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const {
  getAuthUserMock,
  getMyShopOrderDetailMock,
  getOrderReviewMock,
  getOrderReviewRemovalMock,
  getOrderDisputeSummaryMock,
  redirectMock,
  notFoundMock,
} = vi.hoisted(() => ({
  getAuthUserMock: vi.fn(),
  getMyShopOrderDetailMock: vi.fn(),
  getOrderReviewMock: vi.fn(),
  getOrderReviewRemovalMock: vi.fn(),
  getOrderDisputeSummaryMock: vi.fn(),
  redirectMock: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  notFoundMock: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("@/lib/auth/session", () => ({ getAuthUser: getAuthUserMock }));
vi.mock("@/lib/seller/get-my-shop-order-detail", () => ({ getMyShopOrderDetail: getMyShopOrderDetailMock }));
vi.mock("@/lib/reviews/get-order-review", () => ({ getOrderReview: getOrderReviewMock }));
vi.mock("@/lib/disputes/get-order-dispute-summary", () => ({ getOrderDisputeSummary: getOrderDisputeSummaryMock }));

vi.mock("@/lib/reviews/get-order-review-removal", () => ({ getOrderReviewRemoval: getOrderReviewRemovalMock }));

// Presentational stubs: this test is about the review-visibility wording only.
vi.mock("@/components/seller/SellerOrderDetailClient", () => ({ SellerOrderDetailClient: () => null }));
vi.mock("@/components/disputes/DisputeSection", () => ({ DisputeSection: () => null }));
vi.mock("@/components/seller/SellerReviewReplyClient", () => ({ SellerReviewReplyClient: () => null }));

vi.mock("next/navigation", () => ({ redirect: redirectMock, notFound: notFoundMock }));

import SellerOrderDetailPage from "@/app/seller/orders/[publicCode]/page";

const PUBLIC_CODE = "PSO-SELLER1";

function completedOrder() {
  return {
    status: "found",
    order: {
      orderId: "order-1",
      orderPublicCode: PUBLIC_CODE,
      status: "completed",
      buyerDisplayName: "Jane D.",
      items: [],
    },
  };
}

function reviewFound() {
  return {
    status: "found",
    review: {
      orderId: "order-1",
      viewerRole: "seller",
      reviewId: "review-1",
      rating: 2,
      body: "Not as described.",
      imagePaths: [],
      imageUrls: [],
      createdAt: "2026-01-05T00:00:00.000Z",
      updatedAt: "2026-01-05T00:00:00.000Z",
      canCreateReview: false,
      canEditReview: false,
      replyBody: null,
      replyCreatedAt: null,
      replyUpdatedAt: null,
      canWriteReply: false,
    },
  };
}

async function renderPage() {
  const element = await SellerOrderDetailPage({ params: Promise.resolve({ publicCode: PUBLIC_CODE }) });
  return render(element);
}

beforeEach(() => {
  vi.clearAllMocks();
  getAuthUserMock.mockResolvedValue({ id: "seller-1", email: "seller@example.com" });
  getMyShopOrderDetailMock.mockResolvedValue(completedOrder());
  getOrderReviewMock.mockResolvedValue(reviewFound());
  getOrderDisputeSummaryMock.mockResolvedValue({ status: "none" });
});

describe("Seller review page -- removal visibility (behavioral)", () => {
  it("a confirmed removed review shows the seller status line, without the buyer's private reason", async () => {
    getOrderReviewRemovalMock.mockResolvedValue({
      status: "found",
      removal: { isRemoved: true, removedAt: "2026-01-06T00:00:00.000Z", publicMessage: null },
    });
    await renderPage();

    expect(screen.getByText(/This review was removed after a moderation review\. It is no longer shown publicly, and replies are closed\./)).toBeInTheDocument();
    expect(screen.queryByText("Review visibility could not be confirmed.")).not.toBeInTheDocument();
  });

  it("a confirmed visible review shows neither status line", async () => {
    getOrderReviewRemovalMock.mockResolvedValue({ status: "found", removal: { isRemoved: false, removedAt: null, publicMessage: null } });
    await renderPage();

    expect(screen.getByText("Buyer review")).toBeInTheDocument();
    expect(screen.queryByText(/This review was removed/)).not.toBeInTheDocument();
    expect(screen.queryByText("Review visibility could not be confirmed.")).not.toBeInTheDocument();
  });

  it("a reader failure shows the neutral unknown notice, never a visible or removed claim", async () => {
    getOrderReviewRemovalMock.mockResolvedValue({ status: "error" });
    await renderPage();

    expect(screen.getByText("Review visibility could not be confirmed.")).toBeInTheDocument();
    expect(screen.queryByText(/This review was removed/)).not.toBeInTheDocument();
  });

  it("a malformed reader result (mapped to error by the wrapper) is never shown as visible", async () => {
    getOrderReviewRemovalMock.mockResolvedValue({ status: "error" });
    await renderPage();

    expect(screen.getByText("Review visibility could not be confirmed.")).toBeInTheDocument();
  });

  it("with no buyer review, the reader is not called and no status line appears", async () => {
    getOrderReviewMock.mockResolvedValue({ status: "not_found" });
    await renderPage();

    expect(getOrderReviewRemovalMock).not.toHaveBeenCalled();
    expect(screen.queryByText("Review visibility could not be confirmed.")).not.toBeInTheDocument();
    expect(screen.queryByText("Buyer review")).not.toBeInTheDocument();
  });
});
