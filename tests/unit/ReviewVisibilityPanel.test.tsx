import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";

const { getAdminReviewStateMock, removeReviewMock, restoreReviewMock } = vi.hoisted(() => ({
  getAdminReviewStateMock: vi.fn(),
  removeReviewMock: vi.fn(),
  restoreReviewMock: vi.fn(),
}));

vi.mock("@/lib/admin/review-moderation-actions", async () => {
  const actual = await vi.importActual<typeof import("@/lib/admin/review-moderation-actions")>("@/lib/admin/review-moderation-actions");
  return {
    ...actual,
    getAdminReviewState: getAdminReviewStateMock,
    removeReview: removeReviewMock,
    restoreReview: restoreReviewMock,
  };
});

import { ReviewVisibilityPanel } from "@/components/admin/ReviewVisibilityPanel";
import { AdminReportDetailClient } from "@/components/admin/AdminReportDetailClient";
import type { AdminReportDetail } from "@/lib/admin/get-admin-report-detail";

const REVIEW = "review-1";
const TS = "2026-01-05T00:00:00.000Z";

function visibleState(overrides: Record<string, unknown> = {}) {
  return {
    reviewId: REVIEW,
    orderId: "order-1",
    shopId: "shop-1",
    rating: 4,
    body: "Good.",
    replyBody: null,
    replyCreatedAt: null,
    replyUpdatedAt: null,
    reviewCreatedAt: TS,
    removedAt: null,
    imagePaths: [],
    removalPublicMessage: null,
    removalPrivateNote: null,
    ...overrides,
  };
}

function removedState(overrides: Record<string, unknown> = {}) {
  return visibleState({
    removedAt: TS,
    removalPublicMessage: "Scam listing.",
    removalPrivateNote: "Internal.",
    ...overrides,
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ReviewVisibilityPanel -- initial state from the reader", () => {
  it("a successful null removed_at renders Visible, with Remove and no Restore", async () => {
    getAdminReviewStateMock.mockResolvedValue({ ok: true, state: visibleState() });
    render(<ReviewVisibilityPanel reviewId={REVIEW} />);

    expect(await screen.findByText("Visible")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove review" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Restore review" })).not.toBeInTheDocument();
  });

  it("a timestamp renders Removed with the buyer reason and the private note, with Restore and no Remove", async () => {
    getAdminReviewStateMock.mockResolvedValue({ ok: true, state: removedState() });
    render(<ReviewVisibilityPanel reviewId={REVIEW} />);

    expect(await screen.findByText("Removed")).toBeInTheDocument();
    expect(screen.getByText("Reason shown to the buyer: Scam listing.")).toBeInTheDocument();
    expect(screen.getByText("Private admin note: Internal.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restore review" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove review" })).not.toBeInTheDocument();
  });

  it("REVIEW_NOT_FOUND renders missing, with no mutation controls", async () => {
    getAdminReviewStateMock.mockResolvedValue({ ok: false, code: "REVIEW_NOT_FOUND" });
    render(<ReviewVisibilityPanel reviewId={REVIEW} />);

    expect(await screen.findByText("This review no longer exists.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove review" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Restore review" })).not.toBeInTheDocument();
  });
});

describe("ReviewVisibilityPanel -- read failure and Retry", () => {
  it("a read failure shows concise feedback and Retry, and never assumes visible", async () => {
    getAdminReviewStateMock.mockResolvedValue({ ok: false, code: "UNKNOWN" });
    render(<ReviewVisibilityPanel reviewId={REVIEW} />);

    expect(await screen.findByText("Couldn't load this review's state. Please try again.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.queryByText("Visible")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove review" })).not.toBeInTheDocument();
  });

  it("Retry re-reads and shows the state the second read returns", async () => {
    getAdminReviewStateMock
      .mockResolvedValueOnce({ ok: false, code: "UNKNOWN" })
      .mockResolvedValueOnce({ ok: true, state: visibleState() });
    render(<ReviewVisibilityPanel reviewId={REVIEW} />);

    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));

    expect(await screen.findByText("Visible")).toBeInTheDocument();
    expect(getAdminReviewStateMock).toHaveBeenCalledTimes(2);
  });
});

describe("ReviewVisibilityPanel -- remove", () => {
  beforeEach(() => {
    getAdminReviewStateMock.mockResolvedValue({ ok: true, state: visibleState() });
  });

  async function openRemoveForm() {
    render(<ReviewVisibilityPanel reviewId={REVIEW} />);
    fireEvent.click(await screen.findByRole("button", { name: "Remove review" }));
    return screen.getByLabelText("Reason shown to the buyer (required)");
  }

  it("confirm stays disabled for an empty or whitespace-only reason, and no request is sent", async () => {
    const reason = await openRemoveForm();
    const confirm = screen.getByRole("button", { name: "Confirm removal" });
    expect(confirm).toBeDisabled();

    fireEvent.change(reason, { target: { value: "   " } });
    expect(confirm).toBeDisabled();
    expect(removeReviewMock).not.toHaveBeenCalled();
  });

  it("confirm is disabled for a reason over the limit, with feedback", async () => {
    const reason = await openRemoveForm();
    fireEvent.change(reason, { target: { value: "x".repeat(1001) } });

    expect(screen.getByRole("button", { name: "Confirm removal" })).toBeDisabled();
    expect(screen.getByText("Please keep the reason to 1000 characters or fewer.")).toBeInTheDocument();
  });

  it("a successful removal sends the trimmed reason and a null note, then shows Removed from the returned timestamp", async () => {
    removeReviewMock.mockResolvedValue({ ok: true, reviewId: REVIEW, removedAt: TS, wasAlreadyRemoved: false });
    const reason = await openRemoveForm();
    fireEvent.change(reason, { target: { value: "  Scam listing.  " } });
    fireEvent.change(screen.getByLabelText("Private admin note (optional, never shown to the buyer)"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm removal" }));

    await waitFor(() => expect(removeReviewMock).toHaveBeenCalledWith(REVIEW, "Scam listing.", null));
    expect(await screen.findByText("Removed")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Review removed.");
    expect(screen.getByRole("button", { name: "Restore review" })).toBeInTheDocument();
  });

  it("an idempotent repeat reports no change and re-reads the stored reason", async () => {
    removeReviewMock.mockResolvedValue({ ok: true, reviewId: REVIEW, removedAt: TS, wasAlreadyRemoved: true });
    getAdminReviewStateMock.mockResolvedValueOnce({ ok: true, state: visibleState() }).mockResolvedValueOnce({ ok: true, state: removedState() });
    const reason = await openRemoveForm();
    fireEvent.change(reason, { target: { value: "Scam." } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm removal" }));

    expect(await screen.findByText("Reason shown to the buyer: Scam listing.")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Review was already removed. No change made.");
    expect(getAdminReviewStateMock).toHaveBeenCalledTimes(2);
  });

  it("a definite failure keeps the form open with the error and leaves the state visible", async () => {
    removeReviewMock.mockResolvedValue({ ok: false, code: "NOT_ADMIN" });
    const reason = await openRemoveForm();
    fireEvent.change(reason, { target: { value: "Scam." } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm removal" }));

    expect(await screen.findByText("Admin access is required.")).toBeInTheDocument();
    expect(screen.getByText("Visible")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm removal" })).toBeInTheDocument();
  });

  it("an unconfirmed removal (UNKNOWN) shows no success and requires Recheck, with no mutation controls", async () => {
    removeReviewMock.mockResolvedValue({ ok: false, code: "UNKNOWN" });
    const reason = await openRemoveForm();
    fireEvent.change(reason, { target: { value: "Scam." } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm removal" }));

    expect(await screen.findByText("Couldn't confirm this change. Recheck the review's state before trying again.")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove review" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Restore review" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Recheck" })).toBeInTheDocument();
  });

  it("Recheck after an unconfirmed removal re-reads the actual state", async () => {
    removeReviewMock.mockResolvedValue({ ok: false, code: "UNKNOWN" });
    getAdminReviewStateMock.mockResolvedValueOnce({ ok: true, state: visibleState() }).mockResolvedValueOnce({ ok: true, state: removedState() });
    const reason = await openRemoveForm();
    fireEvent.change(reason, { target: { value: "Scam." } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm removal" }));

    fireEvent.click(await screen.findByRole("button", { name: "Recheck" }));

    expect(await screen.findByText("Removed")).toBeInTheDocument();
    expect(getAdminReviewStateMock).toHaveBeenCalledTimes(2);
  });

  it("duplicate confirm clicks while a removal is pending send only one request", async () => {
    removeReviewMock.mockReturnValue(new Promise(() => {}));
    const reason = await openRemoveForm();
    fireEvent.change(reason, { target: { value: "Scam." } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm removal" }));

    const pending = screen.getByRole("button", { name: "Please wait…" });
    expect(pending).toBeDisabled();
    fireEvent.click(pending);

    expect(removeReviewMock).toHaveBeenCalledTimes(1);
  });
});

describe("ReviewVisibilityPanel -- restore", () => {
  beforeEach(() => {
    getAdminReviewStateMock.mockResolvedValue({ ok: true, state: removedState() });
  });

  async function openRestoreForm() {
    render(<ReviewVisibilityPanel reviewId={REVIEW} />);
    fireEvent.click(await screen.findByRole("button", { name: "Restore review" }));
  }

  it("a successful restore with blank fields sends nulls, then shows Visible from the restored state", async () => {
    restoreReviewMock.mockResolvedValue({ ok: true, reviewId: REVIEW, wasAlreadyRestored: false });
    await openRestoreForm();
    fireEvent.click(screen.getByRole("button", { name: "Confirm restore" }));

    await waitFor(() => expect(restoreReviewMock).toHaveBeenCalledWith(REVIEW, null, null));
    expect(await screen.findByText("Visible")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Review restored.");
  });

  it("an idempotent restore reports no change", async () => {
    restoreReviewMock.mockResolvedValue({ ok: true, reviewId: REVIEW, wasAlreadyRestored: true });
    await openRestoreForm();
    fireEvent.click(screen.getByRole("button", { name: "Confirm restore" }));

    expect(await screen.findByText("Visible")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Review was already visible. No change made.");
  });

  it("an unconfirmed restore (UNKNOWN) requires Recheck and shows no success", async () => {
    restoreReviewMock.mockResolvedValue({ ok: false, code: "UNKNOWN" });
    await openRestoreForm();
    fireEvent.click(screen.getByRole("button", { name: "Confirm restore" }));

    expect(await screen.findByText("Couldn't confirm this change. Recheck the review's state before trying again.")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Recheck" })).toBeInTheDocument();
  });
});

function makeReviewReport(reviewId: string): AdminReportDetail {
  return {
    reportId: "report-1",
    targetType: "review",
    reason: "other",
    description: null,
    status: "resolved",
    createdAt: TS,
    reporterId: "u1",
    reporterDisplayName: "Jane D.",
    resolvedBy: "admin-1",
    resolvedByDisplayName: "Admin A.",
    resolvedAt: TS,
    resolutionNote: null,
    listingId: null,
    listingTitle: null,
    listingShopId: null,
    listingShopOwnerId: null,
    listingShopOwnerDisplayName: null,
    shopId: null,
    shopName: null,
    shopOwnerId: null,
    shopOwnerDisplayName: null,
    reviewId,
    reviewRating: 2,
    reviewBody: "Text.",
    reviewAuthorId: "u2",
    reviewAuthorDisplayName: "Buyer B.",
    conversationId: null,
    conversationBuyerId: null,
    conversationBuyerDisplayName: null,
    conversationShopId: null,
    conversationShopOwnerId: null,
    conversationShopOwnerDisplayName: null,
    conversationShopName: null,
  };
}

// Exercises the production identity boundary: AdminReportDetailClient keys the
// review panel by report.reviewId, so moving from review A to review B is a
// real prop change on the actual integration.
describe("ReviewVisibilityPanel -- A->B identity through AdminReportDetailClient", () => {
  it("a late A read cannot change B's panel", async () => {
    const readA = deferred<unknown>();
    getAdminReviewStateMock.mockImplementation((id: string) => (id === "review-A" ? readA.promise : Promise.resolve({ ok: true, state: visibleState({ reviewId: "review-B" }) })));

    const { rerender } = render(<AdminReportDetailClient report={makeReviewReport("review-A")} targetUsers={[]} />);
    rerender(<AdminReportDetailClient report={makeReviewReport("review-B")} targetUsers={[]} />);
    expect(await screen.findByText("Visible")).toBeInTheDocument();

    await act(async () => {
      readA.resolve({ ok: true, state: removedState({ reviewId: "review-A" }) });
    });

    expect(screen.getByText("Visible")).toBeInTheDocument();
    expect(screen.queryByText("Removed")).not.toBeInTheDocument();
  });

  it("a late A removal cannot show A's success notice or state in B's panel", async () => {
    const removeA = deferred<unknown>();
    getAdminReviewStateMock.mockImplementation((id: string) =>
      Promise.resolve({ ok: true, state: visibleState({ reviewId: id }) }),
    );
    removeReviewMock.mockImplementation((id: string) => (id === "review-A" ? removeA.promise : Promise.resolve({ ok: false, code: "UNKNOWN" })));

    const { rerender } = render(<AdminReportDetailClient report={makeReviewReport("review-A")} targetUsers={[]} />);
    fireEvent.click(await screen.findByRole("button", { name: "Remove review" }));
    fireEvent.change(screen.getByLabelText("Reason shown to the buyer (required)"), { target: { value: "Scam." } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm removal" }));
    expect(removeReviewMock).toHaveBeenCalledWith("review-A", "Scam.", null);

    rerender(<AdminReportDetailClient report={makeReviewReport("review-B")} targetUsers={[]} />);
    expect(await screen.findByText("Visible")).toBeInTheDocument();

    await act(async () => {
      removeA.resolve({ ok: true, reviewId: "review-A", removedAt: TS, wasAlreadyRemoved: false });
    });

    expect(screen.getByText("Visible")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByText("Removed")).not.toBeInTheDocument();
  });
});
