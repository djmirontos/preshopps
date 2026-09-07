import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { refreshMock, upsertReviewReplyMock } = vi.hoisted(() => ({
  refreshMock: vi.fn(),
  upsertReviewReplyMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

vi.mock("@/lib/reviews/review-reply-actions", async () => {
  const actual = await vi.importActual<typeof import("@/lib/reviews/review-reply-actions")>("@/lib/reviews/review-reply-actions");
  return {
    ...actual,
    upsertReviewReply: upsertReviewReplyMock,
  };
});

import { SellerReviewReplyClient } from "@/components/seller/SellerReviewReplyClient";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SellerReviewReplyClient -- no reply yet", () => {
  it("shows a reply textarea and submits upsert_review_reply with the review id and trimmed body", async () => {
    upsertReviewReplyMock.mockResolvedValue({ ok: true, reviewId: "review-1", replyCreatedAt: "2026-01-01T00:00:00.000Z", replyUpdatedAt: null });
    render(<SellerReviewReplyClient reviewId="review-1" initialReplyBody={null} canWriteReply={true} />);

    fireEvent.change(screen.getByLabelText(/reply to this review/i), { target: { value: "  Thanks for your order!  " } });
    fireEvent.click(screen.getByRole("button", { name: "Submit reply" }));

    await waitFor(() => expect(upsertReviewReplyMock).toHaveBeenCalledWith("review-1", "Thanks for your order!"));
    expect(refreshMock).toHaveBeenCalled();
  });

  it("rejects an empty reply client-side without calling the RPC", async () => {
    render(<SellerReviewReplyClient reviewId="review-1" initialReplyBody={null} canWriteReply={true} />);
    fireEvent.click(screen.getByRole("button", { name: "Submit reply" }));
    expect(await screen.findByText("Please write a reply before submitting.")).toBeInTheDocument();
    expect(upsertReviewReplyMock).not.toHaveBeenCalled();
  });

  it("renders nothing when there is no reply yet and the seller has no write eligibility (should not normally happen for a first reply, but must fail safe)", () => {
    const { container } = render(<SellerReviewReplyClient reviewId="review-1" initialReplyBody={null} canWriteReply={false} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("SellerReviewReplyClient -- existing reply, within edit window", () => {
  it("shows the reply read-only with an 'Edit reply' control, never a delete button", () => {
    render(<SellerReviewReplyClient reviewId="review-1" initialReplyBody="Thanks!" canWriteReply={true} />);
    expect(screen.getByText("Thanks!")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit reply" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /delete/i })).not.toBeInTheDocument();
  });

  it("switching to edit and submitting calls upsert_review_reply with the updated text", async () => {
    upsertReviewReplyMock.mockResolvedValue({ ok: true, reviewId: "review-1", replyCreatedAt: "2026-01-01T00:00:00.000Z", replyUpdatedAt: "2026-01-02T00:00:00.000Z" });
    render(<SellerReviewReplyClient reviewId="review-1" initialReplyBody="Thanks!" canWriteReply={true} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit reply" }));
    fireEvent.change(screen.getByLabelText(/edit your reply/i), { target: { value: "Thanks so much!" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit reply" }));

    await waitFor(() => expect(upsertReviewReplyMock).toHaveBeenCalledWith("review-1", "Thanks so much!"));
  });
});

describe("SellerReviewReplyClient -- existing reply, edit window closed", () => {
  it("shows the reply read-only with no edit control and no delete control", () => {
    render(<SellerReviewReplyClient reviewId="review-1" initialReplyBody="Thanks!" canWriteReply={false} />);
    expect(screen.getByText("Thanks!")).toBeInTheDocument();
    expect(screen.getByText(/edit window for this reply has closed/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit reply" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /delete/i })).not.toBeInTheDocument();
  });
});
