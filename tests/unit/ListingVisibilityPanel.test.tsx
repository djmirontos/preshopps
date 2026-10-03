import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, fireEvent, waitFor, within } from "@testing-library/react";

const { getListingHideStateMock, hideListingMock, unhideListingMock } = vi.hoisted(() => ({
  getListingHideStateMock: vi.fn(),
  hideListingMock: vi.fn(),
  unhideListingMock: vi.fn(),
}));

vi.mock("@/lib/admin/listing-hide-actions", async () => {
  const actual = await vi.importActual<typeof import("@/lib/admin/listing-hide-actions")>("@/lib/admin/listing-hide-actions");
  return {
    ...actual,
    getListingHideState: getListingHideStateMock,
    hideListing: hideListingMock,
    unhideListing: unhideListingMock,
  };
});

import { ListingVisibilityPanel } from "@/components/admin/ListingVisibilityPanel";
import { AdminReportDetailClient } from "@/components/admin/AdminReportDetailClient";
import type { AdminReportDetail } from "@/lib/admin/get-admin-report-detail";

const HIDDEN_AT = "2026-01-05T00:00:00.000Z";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ListingVisibilityPanel -- initial state from the reader", () => {
  it("a successful null timestamp renders as Visible, with Hide and no Unhide", async () => {
    getListingHideStateMock.mockResolvedValue({ ok: true, hiddenAt: null });
    render(<ListingVisibilityPanel listingId="listing-1" />);

    expect(await screen.findByText("Visible")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hide listing" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Unhide listing" })).not.toBeInTheDocument();
    expect(getListingHideStateMock).toHaveBeenCalledWith("listing-1");
  });

  it("a timestamp renders as Hidden by admin, with Unhide and no Hide", async () => {
    getListingHideStateMock.mockResolvedValue({ ok: true, hiddenAt: HIDDEN_AT });
    render(<ListingVisibilityPanel listingId="listing-1" />);

    expect(await screen.findByText("Hidden by admin")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unhide listing" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Hide listing" })).not.toBeInTheDocument();
  });

  it("LISTING_NOT_FOUND renders as missing, with no mutation controls", async () => {
    getListingHideStateMock.mockResolvedValue({ ok: false, code: "LISTING_NOT_FOUND" });
    render(<ListingVisibilityPanel listingId="listing-1" />);

    expect(await screen.findByText("This listing no longer exists.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Hide listing" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Unhide listing" })).not.toBeInTheDocument();
  });
});

describe("ListingVisibilityPanel -- read failure", () => {
  it("shows concise feedback and Retry, and never assumes visible", async () => {
    getListingHideStateMock.mockResolvedValue({ ok: false, code: "UNKNOWN" });
    render(<ListingVisibilityPanel listingId="listing-1" />);

    expect(await screen.findByText("Couldn't load this listing's visibility. Please try again.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.queryByText("Visible")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Hide listing" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Unhide listing" })).not.toBeInTheDocument();
  });

  it("Retry re-reads and shows the state the second read returns", async () => {
    getListingHideStateMock.mockResolvedValueOnce({ ok: false, code: "UNKNOWN" }).mockResolvedValueOnce({ ok: true, hiddenAt: HIDDEN_AT });
    render(<ListingVisibilityPanel listingId="listing-1" />);

    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));

    expect(await screen.findByText("Hidden by admin")).toBeInTheDocument();
    expect(getListingHideStateMock).toHaveBeenCalledTimes(2);
  });
});

describe("ListingVisibilityPanel -- hide", () => {
  beforeEach(() => {
    getListingHideStateMock.mockResolvedValue({ ok: true, hiddenAt: null });
  });

  it("Hide is gated behind a dialog whose confirm stays disabled for an empty or whitespace-only reason", async () => {
    render(<ListingVisibilityPanel listingId="listing-1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Hide listing" }));

    const dialog = await screen.findByRole("dialog");
    const confirm = within(dialog).getByRole("button", { name: "Hide Listing" });
    expect(confirm).toBeDisabled();

    fireEvent.change(within(dialog).getByLabelText("Reason"), { target: { value: "   " } });
    expect(confirm).toBeDisabled();
    expect(hideListingMock).not.toHaveBeenCalled();
  });

  it("a successful hide sends the trimmed reason and updates to Hidden from the returned timestamp", async () => {
    hideListingMock.mockResolvedValue({ ok: true, listingId: "listing-1", hiddenAt: HIDDEN_AT, wasAlreadyHidden: false });
    render(<ListingVisibilityPanel listingId="listing-1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Hide listing" }));

    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Reason"), { target: { value: "  Counterfeit item.  " } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Hide Listing" }));

    await waitFor(() => expect(hideListingMock).toHaveBeenCalledWith("listing-1", "Counterfeit item."));
    expect(await screen.findByText("Hidden by admin")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Listing hidden.");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("an already-hidden result is reported as no change, not as a fresh hide", async () => {
    hideListingMock.mockResolvedValue({ ok: true, listingId: "listing-1", hiddenAt: HIDDEN_AT, wasAlreadyHidden: true });
    render(<ListingVisibilityPanel listingId="listing-1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Hide listing" }));

    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Reason"), { target: { value: "Duplicate report." } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Hide Listing" }));

    expect(await screen.findByText("Hidden by admin")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Listing was already hidden. No change made.");
  });

  it("a definite mutation failure keeps the dialog open with the error and leaves the state unchanged", async () => {
    hideListingMock.mockResolvedValue({ ok: false, code: "NOT_ADMIN" });
    render(<ListingVisibilityPanel listingId="listing-1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Hide listing" }));

    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Reason"), { target: { value: "Scam." } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Hide Listing" }));

    expect(await within(dialog).findByText("Admin access is required.")).toBeInTheDocument();
    expect(screen.getByText("Visible")).toBeInTheDocument();
  });

  it("an unconfirmed hide (UNKNOWN) closes the dialog, shows no success, and requires a recheck", async () => {
    hideListingMock.mockResolvedValue({ ok: false, code: "UNKNOWN" });
    render(<ListingVisibilityPanel listingId="listing-1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Hide listing" }));

    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Reason"), { target: { value: "Scam." } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Hide Listing" }));

    expect(await screen.findByText("Couldn't confirm this change. Recheck the listing's visibility before trying again.")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Hide listing" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Unhide listing" })).not.toBeInTheDocument();
  });

  it("Recheck after an unconfirmed hide re-reads and shows the actual state", async () => {
    hideListingMock.mockResolvedValue({ ok: false, code: "UNKNOWN" });
    getListingHideStateMock.mockResolvedValueOnce({ ok: true, hiddenAt: null }).mockResolvedValueOnce({ ok: true, hiddenAt: HIDDEN_AT });
    render(<ListingVisibilityPanel listingId="listing-1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Hide listing" }));

    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Reason"), { target: { value: "Scam." } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Hide Listing" }));

    fireEvent.click(await screen.findByRole("button", { name: "Recheck" }));

    expect(await screen.findByText("Hidden by admin")).toBeInTheDocument();
    expect(getListingHideStateMock).toHaveBeenCalledTimes(2);
  });

  it("LISTING_NOT_FOUND on hide moves the panel to missing", async () => {
    hideListingMock.mockResolvedValue({ ok: false, code: "LISTING_NOT_FOUND" });
    render(<ListingVisibilityPanel listingId="listing-1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Hide listing" }));

    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Reason"), { target: { value: "Scam." } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Hide Listing" }));

    expect(await screen.findByText("This listing no longer exists.")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("duplicate confirm clicks while a hide is pending send only one request", async () => {
    hideListingMock.mockReturnValue(new Promise(() => {}));
    render(<ListingVisibilityPanel listingId="listing-1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Hide listing" }));

    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Reason"), { target: { value: "Scam." } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Hide Listing" }));

    const pendingButton = within(dialog).getByRole("button", { name: "Please wait…" });
    expect(pendingButton).toBeDisabled();
    fireEvent.click(pendingButton);

    expect(hideListingMock).toHaveBeenCalledTimes(1);
  });
});

describe("ListingVisibilityPanel -- unhide", () => {
  beforeEach(() => {
    getListingHideStateMock.mockResolvedValue({ ok: true, hiddenAt: HIDDEN_AT });
  });

  it("sends the trimmed optional note and updates to Visible", async () => {
    unhideListingMock.mockResolvedValue({ ok: true, listingId: "listing-1", wasAlreadyVisible: false });
    render(<ListingVisibilityPanel listingId="listing-1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Unhide listing" }));

    fireEvent.change(screen.getByLabelText("Note (optional)"), { target: { value: "  Verified genuine.  " } });
    fireEvent.click(screen.getByRole("button", { name: "Unhide Listing" }));

    await waitFor(() => expect(unhideListingMock).toHaveBeenCalledWith("listing-1", "Verified genuine."));
    expect(await screen.findByText("Visible")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Listing unhidden.");
  });

  it("sends null when the optional note is blank", async () => {
    unhideListingMock.mockResolvedValue({ ok: true, listingId: "listing-1", wasAlreadyVisible: false });
    render(<ListingVisibilityPanel listingId="listing-1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Unhide listing" }));
    fireEvent.click(screen.getByRole("button", { name: "Unhide Listing" }));

    await waitFor(() => expect(unhideListingMock).toHaveBeenCalledWith("listing-1", null));
  });

  it("an already-visible result is reported as no change", async () => {
    unhideListingMock.mockResolvedValue({ ok: true, listingId: "listing-1", wasAlreadyVisible: true });
    render(<ListingVisibilityPanel listingId="listing-1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Unhide listing" }));
    fireEvent.click(screen.getByRole("button", { name: "Unhide Listing" }));

    expect(await screen.findByText("Visible")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Listing was already visible. No change made.");
  });

  it("a note over 1000 characters blocks submission before any request", async () => {
    render(<ListingVisibilityPanel listingId="listing-1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Unhide listing" }));

    fireEvent.change(screen.getByLabelText("Note (optional)"), { target: { value: "x".repeat(1001) } });
    expect(screen.getByRole("button", { name: "Unhide Listing" })).toBeDisabled();
    expect(screen.getByText("Please keep the note to 1000 characters or fewer.")).toBeInTheDocument();
    expect(unhideListingMock).not.toHaveBeenCalled();
  });

  it("a definite mutation failure shows the error inline and leaves the panel hidden", async () => {
    unhideListingMock.mockResolvedValue({ ok: false, code: "NOT_ADMIN" });
    render(<ListingVisibilityPanel listingId="listing-1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Unhide listing" }));
    fireEvent.click(screen.getByRole("button", { name: "Unhide Listing" }));

    expect(await screen.findByText("Admin access is required.")).toBeInTheDocument();
    expect(screen.getByText("Hidden by admin")).toBeInTheDocument();
  });

  it("an unconfirmed unhide (UNKNOWN) shows no success and requires a recheck", async () => {
    unhideListingMock.mockResolvedValue({ ok: false, code: "UNKNOWN" });
    render(<ListingVisibilityPanel listingId="listing-1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Unhide listing" }));
    fireEvent.click(screen.getByRole("button", { name: "Unhide Listing" }));

    expect(await screen.findByText("Couldn't confirm this change. Recheck the listing's visibility before trying again.")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Unhide listing" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Recheck" })).toBeInTheDocument();
  });
});

function makeReport(listingId: string): AdminReportDetail {
  return {
    reportId: "report-1",
    targetType: "listing",
    reason: "spam",
    description: null,
    status: "pending",
    createdAt: "2026-01-05T00:00:00.000Z",
    reporterId: "u1",
    reporterDisplayName: "Jane D.",
    resolvedBy: null,
    resolvedByDisplayName: null,
    resolvedAt: null,
    resolutionNote: null,
    listingId,
    listingTitle: "Item",
    listingShopId: "shop-1",
    listingShopOwnerId: "owner-1",
    listingShopOwnerDisplayName: "Anne S.",
    shopId: null,
    shopName: null,
    shopOwnerId: null,
    shopOwnerDisplayName: null,
    reviewId: null,
    reviewRating: null,
    reviewBody: null,
    reviewAuthorId: null,
    reviewAuthorDisplayName: null,
    conversationId: null,
    conversationBuyerId: null,
    conversationBuyerDisplayName: null,
    conversationShopId: null,
    conversationShopOwnerId: null,
    conversationShopOwnerDisplayName: null,
    conversationShopName: null,
  };
}

// Exercises the production identity boundary: AdminReportDetailClient keys
// the panel by report.listingId, so a report switch from A to B is a real
// prop change on the actual integration, not a test-only key.
describe("ListingVisibilityPanel -- A->B identity through AdminReportDetailClient", () => {
  const HIDDEN_B = "2026-02-02T00:00:00.000Z";

  it("a late A unhide response cannot change B's panel or produce A's notice", async () => {
    getListingHideStateMock.mockImplementation(async (id: string) =>
      id === "listing-A" ? { ok: true, hiddenAt: HIDDEN_AT } : { ok: true, hiddenAt: HIDDEN_B },
    );
    let resolveA!: (value: unknown) => void;
    unhideListingMock.mockReturnValue(
      new Promise((resolve) => {
        resolveA = resolve;
      }),
    );

    const { rerender } = render(<AdminReportDetailClient report={makeReport("listing-A")} targetUsers={[]} />);
    fireEvent.click(await screen.findByRole("button", { name: "Unhide listing" }));
    fireEvent.click(screen.getByRole("button", { name: "Unhide Listing" }));
    expect(unhideListingMock).toHaveBeenCalledWith("listing-A", null);

    rerender(<AdminReportDetailClient report={makeReport("listing-B")} targetUsers={[]} />);
    expect(await screen.findByText("Hidden by admin")).toBeInTheDocument();

    await act(async () => {
      resolveA({ ok: true, listingId: "listing-A", wasAlreadyVisible: false });
    });

    expect(screen.getByText("Hidden by admin")).toBeInTheDocument();
    expect(screen.queryByText("Visible")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("a late A read cannot overwrite B's panel", async () => {
    let resolveA!: (value: unknown) => void;
    getListingHideStateMock.mockImplementation((id: string) => {
      if (id === "listing-A") {
        return new Promise((resolve) => {
          resolveA = resolve;
        });
      }
      return Promise.resolve({ ok: true, hiddenAt: null });
    });

    const { rerender } = render(<AdminReportDetailClient report={makeReport("listing-A")} targetUsers={[]} />);
    rerender(<AdminReportDetailClient report={makeReport("listing-B")} targetUsers={[]} />);
    expect(await screen.findByText("Visible")).toBeInTheDocument();

    await act(async () => {
      resolveA({ ok: true, hiddenAt: HIDDEN_AT });
    });

    expect(screen.getByText("Visible")).toBeInTheDocument();
    expect(screen.queryByText("Hidden by admin")).not.toBeInTheDocument();
  });

  it("a late A recheck cannot overwrite B's panel", async () => {
    getListingHideStateMock.mockResolvedValueOnce({ ok: false, code: "UNKNOWN" });
    let resolveRecheckA!: (value: unknown) => void;
    getListingHideStateMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRecheckA = resolve;
        }),
    );
    getListingHideStateMock.mockResolvedValue({ ok: true, hiddenAt: HIDDEN_B });

    const { rerender } = render(<AdminReportDetailClient report={makeReport("listing-A")} targetUsers={[]} />);
    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
    rerender(<AdminReportDetailClient report={makeReport("listing-B")} targetUsers={[]} />);
    expect(await screen.findByText("Hidden by admin")).toBeInTheDocument();

    await act(async () => {
      resolveRecheckA({ ok: true, hiddenAt: null });
    });

    expect(screen.getByText("Hidden by admin")).toBeInTheDocument();
    expect(screen.queryByText("Visible")).not.toBeInTheDocument();
  });
});
