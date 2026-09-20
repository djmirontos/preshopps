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

describe("SellerReviewReplyClient -- restriction-aware INTERACTION_BLOCKED error (A2.2.2g.2)", () => {
  it("first reply: a seller_suspended failure shows the generic message, the specific selling-access message, and a 'View account status' link", async () => {
    upsertReviewReplyMock.mockResolvedValue({
      ok: false,
      code: "INTERACTION_BLOCKED",
      restriction: { message: "Your selling access is currently suspended.", ctaLabel: "View account status", href: "/account#account-status" },
    });
    render(<SellerReviewReplyClient reviewId="review-1" initialReplyBody={null} canWriteReply={true} />);

    fireEvent.change(screen.getByLabelText(/reply to this review/i), { target: { value: "Thanks!" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit reply" }));

    expect(await screen.findByText("You can't reply to this review right now.")).toBeInTheDocument();
    expect(screen.getByText("Your selling access is currently suspended.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View account status" })).toHaveAttribute("href", "/account#account-status");
  });

  it("edit reply: an account_suspended failure shows the specific account-suspended message and link", async () => {
    upsertReviewReplyMock.mockResolvedValue({
      ok: false,
      code: "INTERACTION_BLOCKED",
      restriction: { message: "Your account is currently suspended.", ctaLabel: "View account status", href: "/account#account-status" },
    });
    render(<SellerReviewReplyClient reviewId="review-1" initialReplyBody="Thanks!" canWriteReply={true} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit reply" }));
    fireEvent.change(screen.getByLabelText(/edit your reply/i), { target: { value: "Thanks so much!" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit reply" }));

    expect(await screen.findByText("Your account is currently suspended.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View account status" })).toHaveAttribute("href", "/account#account-status");
  });

  it("a generic blocked result (no confirmed restriction, e.g. a mutual-block-only collision) shows only the existing generic message, with no detail and no link", async () => {
    upsertReviewReplyMock.mockResolvedValue({ ok: false, code: "INTERACTION_BLOCKED" });
    render(<SellerReviewReplyClient reviewId="review-1" initialReplyBody={null} canWriteReply={true} />);

    fireEvent.change(screen.getByLabelText(/reply to this review/i), { target: { value: "Thanks!" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit reply" }));

    expect(await screen.findByText("You can't reply to this review right now.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "View account status" })).not.toBeInTheDocument();
  });

  it("an unrelated failure (e.g. NOT_REVIEW_SELLER, a buyer-only/ordinary validation-style failure) renders no detail and no link", async () => {
    upsertReviewReplyMock.mockResolvedValue({ ok: false, code: "NOT_REVIEW_SELLER" });
    render(<SellerReviewReplyClient reviewId="review-1" initialReplyBody={null} canWriteReply={true} />);

    fireEvent.change(screen.getByLabelText(/reply to this review/i), { target: { value: "Thanks!" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit reply" }));

    expect(await screen.findByText("You don't have permission to reply to this review.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "View account status" })).not.toBeInTheDocument();
  });

  it("retrying after a restriction failure replaces the stale presentation with the new attempt's result", async () => {
    upsertReviewReplyMock.mockResolvedValueOnce({
      ok: false,
      code: "INTERACTION_BLOCKED",
      restriction: { message: "Your selling access is currently suspended.", ctaLabel: "View account status", href: "/account#account-status" },
    });
    render(<SellerReviewReplyClient reviewId="review-1" initialReplyBody={null} canWriteReply={true} />);

    fireEvent.change(screen.getByLabelText(/reply to this review/i), { target: { value: "Thanks!" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit reply" }));
    expect(await screen.findByText("Your selling access is currently suspended.")).toBeInTheDocument();

    upsertReviewReplyMock.mockResolvedValueOnce({ ok: false, code: "NOT_REVIEW_SELLER" });
    fireEvent.click(screen.getByRole("button", { name: "Submit reply" }));

    await waitFor(() => expect(screen.getByText("You don't have permission to reply to this review.")).toBeInTheDocument());
    expect(screen.queryByText("Your selling access is currently suspended.")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "View account status" })).not.toBeInTheDocument();
  });

  it("Cancel clears a stale restriction detail/link and restores the existing reply body and read-only editing state", async () => {
    upsertReviewReplyMock.mockResolvedValue({
      ok: false,
      code: "INTERACTION_BLOCKED",
      restriction: { message: "Your selling access is currently suspended.", ctaLabel: "View account status", href: "/account#account-status" },
    });
    render(<SellerReviewReplyClient reviewId="review-1" initialReplyBody="Thanks!" canWriteReply={true} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit reply" }));
    fireEvent.change(screen.getByLabelText(/edit your reply/i), { target: { value: "Something else entirely" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit reply" }));
    expect(await screen.findByText("Your selling access is currently suspended.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByText("Your selling access is currently suspended.")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "View account status" })).not.toBeInTheDocument();
    // Back to the read-only view, showing the original reply body, not the
    // discarded in-progress edit.
    expect(screen.getByText("Thanks!")).toBeInTheDocument();
    expect(screen.queryByText("Something else entirely")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit reply" })).toBeInTheDocument();
  });

  it("a failed first reply does not create any visible reply state -- the form remains in first-reply mode, not the read-only reply view", async () => {
    upsertReviewReplyMock.mockResolvedValue({
      ok: false,
      code: "INTERACTION_BLOCKED",
      restriction: { message: "Your selling access is currently suspended.", ctaLabel: "View account status", href: "/account#account-status" },
    });
    render(<SellerReviewReplyClient reviewId="review-1" initialReplyBody={null} canWriteReply={true} />);

    fireEvent.change(screen.getByLabelText(/reply to this review/i), { target: { value: "Thanks!" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit reply" }));

    await waitFor(() => expect(upsertReviewReplyMock).toHaveBeenCalled());
    expect(screen.getByLabelText(/reply to this review/i)).toBeInTheDocument();
    expect(screen.queryByText("Your reply")).not.toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("a failed edit does not replace the existing reply -- the read-only view still shows the original text once cancelled", async () => {
    upsertReviewReplyMock.mockResolvedValue({
      ok: false,
      code: "INTERACTION_BLOCKED",
      restriction: { message: "Your selling access is currently suspended.", ctaLabel: "View account status", href: "/account#account-status" },
    });
    render(<SellerReviewReplyClient reviewId="review-1" initialReplyBody="Original reply" canWriteReply={true} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit reply" }));
    fireEvent.change(screen.getByLabelText(/edit your reply/i), { target: { value: "Attempted new text" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit reply" }));

    await waitFor(() => expect(upsertReviewReplyMock).toHaveBeenCalled());
    expect(refreshMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("Original reply")).toBeInTheDocument();
    expect(screen.queryByText("Attempted new text")).not.toBeInTheDocument();
  });

  it("a successful first reply after a restriction failure retains existing arguments and refresh behavior", async () => {
    upsertReviewReplyMock.mockResolvedValueOnce({
      ok: false,
      code: "INTERACTION_BLOCKED",
      restriction: { message: "Your selling access is currently suspended.", ctaLabel: "View account status", href: "/account#account-status" },
    });
    render(<SellerReviewReplyClient reviewId="review-1" initialReplyBody={null} canWriteReply={true} />);

    fireEvent.change(screen.getByLabelText(/reply to this review/i), { target: { value: "Thanks!" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit reply" }));
    expect(await screen.findByText("Your selling access is currently suspended.")).toBeInTheDocument();

    upsertReviewReplyMock.mockResolvedValueOnce({ ok: true, reviewId: "review-1", replyCreatedAt: "2026-01-01T00:00:00.000Z", replyUpdatedAt: null });
    fireEvent.click(screen.getByRole("button", { name: "Submit reply" }));

    await waitFor(() => expect(upsertReviewReplyMock).toHaveBeenCalledWith("review-1", "Thanks!"));
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(screen.queryByText("Your selling access is currently suspended.")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "View account status" })).not.toBeInTheDocument();
  });
});
