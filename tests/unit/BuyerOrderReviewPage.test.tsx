import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const { getAuthUserMock, getMyOrderDetailMock, getOrderReviewMock, getOrderReviewRemovalMock, redirectMock, notFoundMock } = vi.hoisted(() => ({
  getAuthUserMock: vi.fn(),
  getMyOrderDetailMock: vi.fn(),
  getOrderReviewMock: vi.fn(),
  getOrderReviewRemovalMock: vi.fn(),
  redirectMock: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  notFoundMock: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("@/lib/auth/session", () => ({ getAuthUser: getAuthUserMock }));
vi.mock("@/lib/orders/get-my-order-detail", () => ({ getMyOrderDetail: getMyOrderDetailMock }));
vi.mock("@/lib/reviews/get-order-review", () => ({ getOrderReview: getOrderReviewMock }));

vi.mock("@/lib/reviews/get-order-review-removal", () => ({ getOrderReviewRemoval: getOrderReviewRemovalMock }));

vi.mock("@/components/orders/ReviewFormClient", () => ({ ReviewFormClient: () => null }));
vi.mock("@/components/orders/ReviewReadOnlyView", () => ({
  ReviewReadOnlyView: () => <p>Read-only review body</p>,
}));

vi.mock("next/navigation", () => ({ redirect: redirectMock, notFound: notFoundMock }));

import OrderReviewPage from "@/app/orders/[publicCode]/review/page";

const PUBLIC_CODE = "PSO-BUYER1";

function completedOrder() {
  return {
    status: "found",
    order: {
      orderId: "order-1",
      orderPublicCode: PUBLIC_CODE,
      status: "completed",
      shopName: "Anne's Closet",
      items: [],
    },
  };
}

function reviewFound(overrides: Record<string, unknown> = {}) {
  return {
    status: "found",
    review: {
      orderId: "order-1",
      viewerRole: "buyer",
      reviewId: "review-1",
      rating: 4,
      body: "Nice.",
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
      ...overrides,
    },
  };
}

async function renderPage() {
  const element = await OrderReviewPage({ params: Promise.resolve({ publicCode: PUBLIC_CODE }) });
  return render(element);
}

beforeEach(() => {
  vi.clearAllMocks();
  getAuthUserMock.mockResolvedValue({ id: "buyer-1", email: "buyer@example.com" });
  getMyOrderDetailMock.mockResolvedValue(completedOrder());
  getOrderReviewMock.mockResolvedValue(reviewFound());
});

describe("Buyer review page -- removal visibility (behavioral)", () => {
  it("a confirmed removed review shows the removal notice with the buyer-facing reason", async () => {
    getOrderReviewRemovalMock.mockResolvedValue({
      status: "found",
      removal: { isRemoved: true, removedAt: "2026-01-06T00:00:00.000Z", publicMessage: "Scam listing." },
    });
    await renderPage();

    expect(screen.getByText("This review was removed after a moderation review.")).toBeInTheDocument();
    expect(screen.getByText("Reason: Scam listing.")).toBeInTheDocument();
    expect(screen.queryByText("Review visibility could not be confirmed.")).not.toBeInTheDocument();
  });

  it("a confirmed visible review shows neither the removal notice nor the unknown notice", async () => {
    getOrderReviewRemovalMock.mockResolvedValue({ status: "found", removal: { isRemoved: false, removedAt: null, publicMessage: null } });
    await renderPage();

    expect(screen.getByText("Read-only review body")).toBeInTheDocument();
    expect(screen.queryByText("This review was removed after a moderation review.")).not.toBeInTheDocument();
    expect(screen.queryByText("Review visibility could not be confirmed.")).not.toBeInTheDocument();
  });

  it("a reader failure shows the neutral unknown notice and never the removed or visible wording as fact", async () => {
    getOrderReviewRemovalMock.mockResolvedValue({ status: "error" });
    await renderPage();

    expect(screen.getByText("Review visibility could not be confirmed.")).toBeInTheDocument();
    expect(screen.queryByText("This review was removed after a moderation review.")).not.toBeInTheDocument();
  });

  it("a zero-row reader result for an existing review is treated as unknown, not as visible", async () => {
    getOrderReviewRemovalMock.mockResolvedValue({ status: "none" });
    await renderPage();

    expect(screen.getByText("Review visibility could not be confirmed.")).toBeInTheDocument();
  });

  it("the server-side edit protection is unchanged by a reader failure: the page still renders read-only, not as an editor", async () => {
    getOrderReviewRemovalMock.mockResolvedValue({ status: "error" });
    await renderPage();

    expect(screen.getByText("Read-only review body")).toBeInTheDocument();
  });

  it("the page never renders a private admin note, because the reader result has no such field", async () => {
    getOrderReviewRemovalMock.mockResolvedValue({
      status: "found",
      removal: { isRemoved: true, removedAt: "2026-01-06T00:00:00.000Z", publicMessage: "Visible reason." },
    });
    const { container } = await renderPage();

    expect(container.textContent).not.toMatch(/private/i);
  });
});
