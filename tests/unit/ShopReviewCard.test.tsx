import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import type { ShopReviewItem } from "@/lib/reviews/get-shop-reviews";

const { submitReportMock } = vi.hoisted(() => ({
  submitReportMock: vi.fn(),
}));

vi.mock("@/lib/moderation/report-actions", async () => {
  const actual = await vi.importActual<typeof import("@/lib/moderation/report-actions")>("@/lib/moderation/report-actions");
  return {
    ...actual,
    submitReport: submitReportMock,
  };
});

import { ShopReviewCard } from "@/components/shop/ShopReviewCard";

function review(overrides: Partial<ShopReviewItem> = {}): ShopReviewItem {
  return {
    reviewId: "review-1",
    rating: 5,
    body: "Great seller!",
    createdAt: "2026-01-03T00:00:00.000Z",
    updatedAt: "2026-01-03T00:00:00.000Z",
    buyerDisplayName: "Jane D.",
    buyerAvatarUrl: undefined,
    replyBody: null,
    replyCreatedAt: null,
    replyUpdatedAt: null,
    imageUrls: [],
    purchasedItemTitles: ["Uniqlo Shirt"],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ShopReviewCard -- Report affordance (PRD 31)", () => {
  it("renders a restrained Report action for an authenticated viewer on another user's review", () => {
    render(<ShopReviewCard review={review()} isAuthenticated={true} next="/shop/annes-closet" />);
    expect(screen.getByRole("button", { name: /report/i })).toBeInTheDocument();
  });

  it("shows an AuthGate instead of the report dialog for an unauthenticated (guest) viewer, matching listing/shop report behavior", () => {
    render(<ShopReviewCard review={review()} isAuthenticated={false} next="/shop/annes-closet" />);
    fireEvent.click(screen.getByRole("button", { name: /report/i }));

    expect(screen.getByRole("dialog", { name: /sign in to report/i })).toBeInTheDocument();
    expect(screen.queryByLabelText("Reason")).not.toBeInTheDocument();
  });

  it("submits with targetType review and the exact review's own id -- never a listing/shop/conversation id", async () => {
    submitReportMock.mockResolvedValue({ ok: true, reportId: "report-1", createdAt: "now" });
    render(<ShopReviewCard review={review({ reviewId: "review-42" })} isAuthenticated={true} next="/shop/annes-closet" />);

    fireEvent.click(screen.getByRole("button", { name: /report/i }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Reason"), { target: { value: "spam" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Submit report" }));

    await waitFor(() => expect(submitReportMock).toHaveBeenCalledWith("review", "review-42", "spam", null));
  });

  it("self-review handling: no reviewer identity is available client-side to hide the action, so the backend's SELF_REPORT_NOT_ALLOWED rejection is what actually protects a buyer's own review -- surfaced through the same friendly error every other target type already shows", async () => {
    submitReportMock.mockResolvedValue({ ok: false, code: "SELF_REPORT_NOT_ALLOWED" });
    render(<ShopReviewCard review={review()} isAuthenticated={true} next="/shop/annes-closet" />);

    fireEvent.click(screen.getByRole("button", { name: /report/i }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Reason"), { target: { value: "spam" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Submit report" }));

    expect(await screen.findByText(/can't report your own content/i)).toBeInTheDocument();
  });

  it("passes the given next path through to the sign-in AuthGate for a guest", () => {
    render(<ShopReviewCard review={review()} isAuthenticated={false} next="/shop/annes-closet" />);
    fireEvent.click(screen.getByRole("button", { name: /report/i }));
    expect(screen.getByRole("link", { name: /sign in/i })).toHaveAttribute(
      "href",
      expect.stringContaining(encodeURIComponent("/shop/annes-closet")),
    );
  });

  it("does not interfere with the seller-reply panel when one is present", () => {
    render(
      <ShopReviewCard review={review({ replyBody: "Thanks for shopping!" })} isAuthenticated={true} next="/shop/annes-closet" />,
    );
    expect(screen.getByText("Seller reply")).toBeInTheDocument();
    expect(screen.getByText("Thanks for shopping!")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /report/i })).toBeInTheDocument();
  });
});
