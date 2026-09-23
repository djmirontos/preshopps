import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

const { updateListingStatusMock, notifySuccessMock } = vi.hoisted(() => ({
  updateListingStatusMock: vi.fn(),
  notifySuccessMock: vi.fn(),
}));

vi.mock("@/lib/seller/listing-actions", async () => {
  const actual = await vi.importActual<typeof import("@/lib/seller/listing-actions")>("@/lib/seller/listing-actions");
  return {
    ...actual,
    updateListingStatus: updateListingStatusMock,
  };
});

vi.mock("@/lib/notifications/toast", () => ({
  notifySuccess: notifySuccessMock,
}));

import { SellerListingsListClient } from "@/components/seller/SellerListingsListClient";
import type { MyShopListingSummary } from "@/lib/seller/get-my-shop-listings";

const CATEGORIES = [{ id: 1, slug: "women", name: "Women" }];

function listing(overrides: Partial<MyShopListingSummary> = {}): MyShopListingSummary {
  return {
    listingId: "listing-1",
    publicCode: "PSL-ABC123",
    slug: "nike-air-max-270",
    title: "Nike Air Max 270",
    status: "available",
    priceCents: 199900,
    stockQuantity: 3,
    reservedQuantity: 0,
    availableQuantity: 3,
    coverImagePath: null,
    categoryId: 1,
    listingType: "preloved",
    condition: "good",
    createdAt: "2026-01-05T00:00:00.000Z",
    updatedAt: "2026-01-05T00:00:00.000Z",
    publishedAt: "2026-01-05T00:00:00.000Z",
    ...overrides,
  };
}

function renderList(overrides: Partial<React.ComponentProps<typeof SellerListingsListClient>> = {}) {
  return render(
    <SellerListingsListClient
      initialListings={[listing()]}
      initialHadError={false}
      initialCursor={null}
      loadMore={vi.fn()}
      categories={CATEGORIES}
      activeStatus={null}
      {...overrides}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SellerListingsListClient -- empty/error states", () => {
  it("shows a generic empty state for the All tab", () => {
    renderList({ initialListings: [] });
    expect(screen.getByText("No listings yet.")).toBeInTheDocument();
  });

  it("shows a status-specific empty state for a filtered tab", () => {
    renderList({ initialListings: [], activeStatus: "paused" });
    expect(screen.getByText("No paused listings.")).toBeInTheDocument();
  });

  it("shows an error message instead of the list when the initial load failed", () => {
    renderList({ initialHadError: true });
    expect(screen.getByText(/unable to load your listings/i)).toBeInTheDocument();
  });
});

describe("SellerListingsListClient -- action visibility by status", () => {
  it("Draft shows Edit and Archive only", () => {
    renderList({ initialListings: [listing({ status: "draft" })] });
    expect(screen.getByRole("link", { name: "Edit" })).toHaveAttribute("href", "/sell/listing-1/edit");
    expect(screen.getByRole("button", { name: "Archive" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "View listing" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pause" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Resume" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mark Sold" })).not.toBeInTheDocument();
  });

  it("Available shows Edit, View listing, Pause, Mark Sold, and Archive", () => {
    renderList({ initialListings: [listing({ status: "available" })] });
    expect(screen.getByRole("link", { name: "Edit" })).toHaveAttribute("href", "/sell/listing-1/edit");
    expect(screen.getByRole("link", { name: "View listing" })).toHaveAttribute("href", "/item/PSL-ABC123");
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mark Sold" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Archive" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Resume" })).not.toBeInTheDocument();
  });

  it("Paused shows Edit, Resume, Mark Sold, and Archive -- no public view link (never, per canon)", () => {
    renderList({ initialListings: [listing({ status: "paused" })] });
    expect(screen.getByRole("link", { name: "Edit" })).toHaveAttribute("href", "/sell/listing-1/edit");
    expect(screen.queryByRole("link", { name: "View listing" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resume" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mark Sold" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Archive" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pause" })).not.toBeInTheDocument();
  });

  it("Sold shows View listing and Archive only -- no Edit", () => {
    renderList({ initialListings: [listing({ status: "sold" })] });
    expect(screen.getByRole("link", { name: "View listing" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Archive" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pause" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Resume" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mark Sold" })).not.toBeInTheDocument();
  });

  it("Archived shows View listing only -- no Edit, no status actions, terminal state", () => {
    renderList({ initialListings: [listing({ status: "archived" })] });
    expect(screen.getByRole("link", { name: "View listing" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Archive" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pause" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Resume" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mark Sold" })).not.toBeInTheDocument();
  });

  it("Reserved shows View listing but zero status actions and no Edit, with an explanatory note -- system-controlled only", () => {
    renderList({ initialListings: [listing({ status: "reserved", reservedQuantity: 1, availableQuantity: 0 })] });
    expect(screen.getByRole("link", { name: "View listing" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pause" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Resume" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mark Sold" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Archive" })).not.toBeInTheDocument();
    expect(screen.getByText(/reserved by an active order/i)).toBeInTheDocument();
  });
});

describe("SellerListingsListClient -- Edit link visibility and destination (canEditListing)", () => {
  it.each(["draft", "available", "paused"] as const)("shows Edit linking to /sell/{listingId}/edit for %s", (status) => {
    renderList({ initialListings: [listing({ status })] });
    expect(screen.getByRole("link", { name: "Edit" })).toHaveAttribute("href", "/sell/listing-1/edit");
  });

  it.each(["reserved", "sold", "archived"] as const)("never shows Edit for %s", (status) => {
    renderList({ initialListings: [listing({ status })] });
    expect(screen.queryByRole("link", { name: "Edit" })).not.toBeInTheDocument();
  });

  it("never shows a Delete action for any status -- Archive remains the only removal/hide behavior", () => {
    for (const status of ["draft", "available", "paused", "reserved", "sold", "archived"] as const) {
      const { unmount } = renderList({ initialListings: [listing({ status })] });
      expect(screen.queryByRole("button", { name: /delete/i })).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name: /delete/i })).not.toBeInTheDocument();
      unmount();
    }
  });
});

describe("SellerListingsListClient -- immediate (non-confirmed) actions: Pause/Resume", () => {
  it("Pause calls update_listing_status immediately, no confirmation dialog", async () => {
    updateListingStatusMock.mockResolvedValue({ ok: true, listingId: "listing-1", status: "paused", wasAlreadyInStatus: false, updatedAt: "now" });
    renderList({ initialListings: [listing({ status: "available" })] });

    fireEvent.click(screen.getByRole("button", { name: "Pause" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(updateListingStatusMock).toHaveBeenCalledWith("listing-1", "paused"));
  });

  it("after a successful Pause on the All tab, the row updates in place to show Paused actions", async () => {
    updateListingStatusMock.mockResolvedValue({ ok: true, listingId: "listing-1", status: "paused", wasAlreadyInStatus: false, updatedAt: "now" });
    renderList({ initialListings: [listing({ status: "available" })], activeStatus: null });

    fireEvent.click(screen.getByRole("button", { name: "Pause" }));

    expect(await screen.findByRole("button", { name: "Resume" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pause" })).not.toBeInTheDocument();
  });

  it("after a successful Pause while filtered to the Available tab, the row disappears (no longer matches)", async () => {
    updateListingStatusMock.mockResolvedValue({ ok: true, listingId: "listing-1", status: "paused", wasAlreadyInStatus: false, updatedAt: "now" });
    renderList({ initialListings: [listing({ status: "available" })], activeStatus: "available" });

    fireEvent.click(screen.getByRole("button", { name: "Pause" }));

    await waitFor(() => expect(screen.queryByText("Nike Air Max 270")).not.toBeInTheDocument());
  });

  it("shows a friendly inline error when Pause is rejected (e.g. an active reservation), without removing the row", async () => {
    updateListingStatusMock.mockResolvedValue({ ok: false, code: "LISTING_HAS_ACTIVE_RESERVATION" });
    renderList({ initialListings: [listing({ status: "available" })] });

    fireEvent.click(screen.getByRole("button", { name: "Pause" }));

    expect(await screen.findByText(/active order reservation/i)).toBeInTheDocument();
    expect(screen.getByText("Nike Air Max 270")).toBeInTheDocument();
  });

  it("a successful Pause calls notifySuccess('Listing paused') exactly once", async () => {
    updateListingStatusMock.mockResolvedValue({ ok: true, listingId: "listing-1", status: "paused", wasAlreadyInStatus: false, updatedAt: "now" });
    renderList({ initialListings: [listing({ status: "available" })] });

    fireEvent.click(screen.getByRole("button", { name: "Pause" }));

    await waitFor(() => expect(notifySuccessMock).toHaveBeenCalledWith("Listing paused"));
    expect(notifySuccessMock).toHaveBeenCalledTimes(1);
  });

  it("a rejected Pause never calls notifySuccess", async () => {
    updateListingStatusMock.mockResolvedValue({ ok: false, code: "LISTING_HAS_ACTIVE_RESERVATION" });
    renderList({ initialListings: [listing({ status: "available" })] });

    fireEvent.click(screen.getByRole("button", { name: "Pause" }));

    await screen.findByText(/active order reservation/i);
    expect(notifySuccessMock).not.toHaveBeenCalled();
  });

  it("Resume calls update_listing_status immediately, no confirmation dialog", async () => {
    updateListingStatusMock.mockResolvedValue({ ok: true, listingId: "listing-1", status: "available", wasAlreadyInStatus: false, updatedAt: "now" });
    renderList({ initialListings: [listing({ status: "paused" })] });

    fireEvent.click(screen.getByRole("button", { name: "Resume" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(updateListingStatusMock).toHaveBeenCalledWith("listing-1", "available"));
  });

  it("a successful Resume calls notifySuccess('Listing resumed') exactly once", async () => {
    updateListingStatusMock.mockResolvedValue({ ok: true, listingId: "listing-1", status: "available", wasAlreadyInStatus: false, updatedAt: "now" });
    renderList({ initialListings: [listing({ status: "paused" })] });

    fireEvent.click(screen.getByRole("button", { name: "Resume" }));

    await waitFor(() => expect(notifySuccessMock).toHaveBeenCalledWith("Listing resumed"));
    expect(notifySuccessMock).toHaveBeenCalledTimes(1);
  });

  it("a rejected Resume never calls notifySuccess", async () => {
    updateListingStatusMock.mockResolvedValue({ ok: false, code: "INVALID_STATUS_TRANSITION" });
    renderList({ initialListings: [listing({ status: "paused" })] });

    fireEvent.click(screen.getByRole("button", { name: "Resume" }));

    await screen.findByText(/isn't allowed from the listing's current status/i);
    expect(notifySuccessMock).not.toHaveBeenCalled();
  });

  // Regression coverage: update_listing_status calls validate_published_listing
  // on Paused -> Available, so a Resume attempt can fail with one of that
  // validator's own completeness codes (e.g. stock silently reaching 0 while
  // paused). Before lib/seller/listing-actions.ts recognized these codes, this
  // exact case fell back to UNKNOWN and rendered the generic "Something went
  // wrong. Please try again." -- useless for telling the seller what to fix.
  it("shows the specific validation message (not the generic fallback) when Resume fails validate_published_listing's own check, keeps the listing Paused, and never calls notifySuccess", async () => {
    updateListingStatusMock.mockResolvedValue({ ok: false, code: "STOCK_QUANTITY_INVALID" });
    renderList({ initialListings: [listing({ status: "paused" })] });

    fireEvent.click(screen.getByRole("button", { name: "Resume" }));

    expect(await screen.findByText("Stock quantity must be at least 1.")).toBeInTheDocument();
    expect(screen.queryByText("Something went wrong. Please try again.")).not.toBeInTheDocument();

    // The row's own status badge and available actions must still reflect
    // Paused -- the failed Resume must never have been applied optimistically.
    expect(screen.getByText("Paused")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resume" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pause" })).not.toBeInTheDocument();

    expect(notifySuccessMock).not.toHaveBeenCalled();
  });

  it("a successful retry after a validation failure still fires exactly one 'Listing resumed' toast and the row updates to Available", async () => {
    updateListingStatusMock.mockResolvedValueOnce({ ok: false, code: "STOCK_QUANTITY_INVALID" });
    renderList({ initialListings: [listing({ status: "paused" })] });

    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    await screen.findByText("Stock quantity must be at least 1.");
    expect(notifySuccessMock).not.toHaveBeenCalled();

    updateListingStatusMock.mockResolvedValueOnce({ ok: true, listingId: "listing-1", status: "available", wasAlreadyInStatus: false, updatedAt: "now" });
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));

    await waitFor(() => expect(notifySuccessMock).toHaveBeenCalledWith("Listing resumed"));
    expect(notifySuccessMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Stock quantity must be at least 1.")).not.toBeInTheDocument();
    expect(screen.getByText("Available")).toBeInTheDocument();
  });
});

describe("SellerListingsListClient -- confirmed actions: Mark Sold/Archive", () => {
  it("Mark Sold opens a confirmation dialog before calling update_listing_status", () => {
    renderList({ initialListings: [listing({ status: "available" })] });
    fireEvent.click(screen.getByRole("button", { name: "Mark Sold" }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(updateListingStatusMock).not.toHaveBeenCalled();
  });

  it("Cancel closes the dialog without calling update_listing_status", () => {
    renderList({ initialListings: [listing({ status: "available" })] });
    fireEvent.click(screen.getByRole("button", { name: "Mark Sold" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(updateListingStatusMock).not.toHaveBeenCalled();
  });

  it("confirming Mark Sold calls update_listing_status and closes the dialog on success", async () => {
    updateListingStatusMock.mockResolvedValue({ ok: true, listingId: "listing-1", status: "sold", wasAlreadyInStatus: false, updatedAt: "now" });
    renderList({ initialListings: [listing({ status: "available" })] });

    fireEvent.click(screen.getByRole("button", { name: "Mark Sold" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Mark Sold" }));

    await waitFor(() => expect(updateListingStatusMock).toHaveBeenCalledWith("listing-1", "sold"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("a confirmed Mark Sold success calls notifySuccess('Marked as sold') exactly once", async () => {
    updateListingStatusMock.mockResolvedValue({ ok: true, listingId: "listing-1", status: "sold", wasAlreadyInStatus: false, updatedAt: "now" });
    renderList({ initialListings: [listing({ status: "available" })] });

    fireEvent.click(screen.getByRole("button", { name: "Mark Sold" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Mark Sold" }));

    await waitFor(() => expect(notifySuccessMock).toHaveBeenCalledWith("Marked as sold"));
    expect(notifySuccessMock).toHaveBeenCalledTimes(1);
  });

  it("the Mark Sold confirmation button uses destructive/danger styling", () => {
    renderList({ initialListings: [listing({ status: "available" })] });
    fireEvent.click(screen.getByRole("button", { name: "Mark Sold" }));

    const confirmButton = within(screen.getByRole("dialog")).getByRole("button", { name: "Mark Sold" });
    expect(confirmButton.className).toMatch(/bg-danger/);
  });

  it("Archive opens a confirmation dialog too", () => {
    renderList({ initialListings: [listing({ status: "paused" })] });
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("a confirmed Archive success calls notifySuccess('Listing archived') exactly once", async () => {
    updateListingStatusMock.mockResolvedValue({ ok: true, listingId: "listing-1", status: "archived", wasAlreadyInStatus: false, updatedAt: "now" });
    renderList({ initialListings: [listing({ status: "paused" })] });

    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Archive" }));

    await waitFor(() => expect(notifySuccessMock).toHaveBeenCalledWith("Listing archived"));
    expect(notifySuccessMock).toHaveBeenCalledTimes(1);
  });

  it("the Archive confirmation button uses destructive/danger styling", () => {
    renderList({ initialListings: [listing({ status: "paused" })] });
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));

    const confirmButton = within(screen.getByRole("dialog")).getByRole("button", { name: "Archive" });
    expect(confirmButton.className).toMatch(/bg-danger/);
  });

  it("if the confirmed action fails, the dialog stays open and shows the error, and notifySuccess is never called", async () => {
    updateListingStatusMock.mockResolvedValue({ ok: false, code: "INVALID_STATUS_TRANSITION" });
    renderList({ initialListings: [listing({ status: "sold" })] });

    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Archive" }));

    await waitFor(() =>
      expect(within(screen.getByRole("dialog")).getByText(/isn't allowed from the listing's current status/i)).toBeInTheDocument(),
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(notifySuccessMock).not.toHaveBeenCalled();
  });
});

describe("SellerListingsListClient -- Load more", () => {
  it("shows a Load more button when a cursor is present", () => {
    renderList({ initialCursor: { createdAt: "2026-01-01T00:00:00.000Z", id: "listing-2" } });
    expect(screen.getByRole("button", { name: "Load more" })).toBeInTheDocument();
  });

  it("hides the Load more button when there is no cursor (last page)", () => {
    renderList({ initialCursor: null });
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  });

  it("appends more listings and advances the cursor on success", async () => {
    const loadMore = vi.fn().mockResolvedValue({
      listings: [listing({ listingId: "listing-2", title: "Second Item" })],
      hadError: false,
      nextCursor: null,
    });
    renderList({ initialCursor: { createdAt: "2026-01-01T00:00:00.000Z", id: "listing-1" }, loadMore });

    fireEvent.click(screen.getByRole("button", { name: "Load more" }));

    expect(await screen.findByText("Second Item")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  });

  it("shows an inline error and keeps the button when loading more fails", async () => {
    const loadMore = vi.fn().mockResolvedValue({ listings: [], hadError: true, nextCursor: null });
    renderList({ initialCursor: { createdAt: "2026-01-01T00:00:00.000Z", id: "listing-1" }, loadMore });

    fireEvent.click(screen.getByRole("button", { name: "Load more" }));

    expect(await screen.findByText(/unable to load more listings/i)).toBeInTheDocument();
  });
});

describe("SellerListingsListClient -- restriction-aware INTERACTION_BLOCKED error (A2.2.2d)", () => {
  const RESTRICTION = {
    message: "Your selling access is currently suspended.",
    ctaLabel: "View account status",
    href: "/account#account-status",
  };
  const ACCOUNT_RESTRICTION = {
    message: "Your account is currently suspended.",
    ctaLabel: "View account status",
    href: "/account#account-status",
  };

  describe("Pause/Resume (immediate, no dialog)", () => {
    it("shows the selling-access message and a 'View account status' link in the row when Pause returns a seller_suspended restriction", async () => {
      updateListingStatusMock.mockResolvedValue({ ok: false, code: "INTERACTION_BLOCKED", restriction: RESTRICTION });
      renderList({ initialListings: [listing({ status: "available" })] });

      fireEvent.click(screen.getByRole("button", { name: "Pause" }));

      expect(await screen.findByText("You are not able to manage listings right now.")).toBeInTheDocument();
      expect(screen.getByText("Your selling access is currently suspended.")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "View account status" })).toHaveAttribute("href", "/account#account-status");
      expect(notifySuccessMock).not.toHaveBeenCalled();
    });

    it("a generic (non-restriction) Pause failure shows no Account-status link", async () => {
      updateListingStatusMock.mockResolvedValue({ ok: false, code: "LISTING_HAS_ACTIVE_RESERVATION" });
      renderList({ initialListings: [listing({ status: "available" })] });

      fireEvent.click(screen.getByRole("button", { name: "Pause" }));

      expect(await screen.findByText(/active order reservation/i)).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "View account status" })).not.toBeInTheDocument();
    });

    it("retrying after a restriction failure replaces the stale presentation with the new attempt's result", async () => {
      updateListingStatusMock.mockResolvedValueOnce({ ok: false, code: "INTERACTION_BLOCKED", restriction: RESTRICTION });
      renderList({ initialListings: [listing({ status: "available" })] });

      fireEvent.click(screen.getByRole("button", { name: "Pause" }));
      expect(await screen.findByText("Your selling access is currently suspended.")).toBeInTheDocument();

      updateListingStatusMock.mockResolvedValueOnce({ ok: false, code: "LISTING_HAS_ACTIVE_RESERVATION" });
      fireEvent.click(screen.getByRole("button", { name: "Pause" }));

      expect(await screen.findByText(/active order reservation/i)).toBeInTheDocument();
      expect(screen.queryByText("Your selling access is currently suspended.")).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "View account status" })).not.toBeInTheDocument();
    });

    it("a successful retry after a restriction failure clears the error and link entirely", async () => {
      updateListingStatusMock.mockResolvedValueOnce({ ok: false, code: "INTERACTION_BLOCKED", restriction: RESTRICTION });
      renderList({ initialListings: [listing({ status: "available" })] });

      fireEvent.click(screen.getByRole("button", { name: "Pause" }));
      expect(await screen.findByText("Your selling access is currently suspended.")).toBeInTheDocument();

      updateListingStatusMock.mockResolvedValueOnce({ ok: true, listingId: "listing-1", status: "paused", wasAlreadyInStatus: false, updatedAt: "now" });
      fireEvent.click(screen.getByRole("button", { name: "Pause" }));

      expect(await screen.findByRole("button", { name: "Resume" })).toBeInTheDocument();
      expect(screen.queryByText("Your selling access is currently suspended.")).not.toBeInTheDocument();
      expect(screen.queryByText("You are not able to manage listings right now.")).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "View account status" })).not.toBeInTheDocument();
      // The failed first attempt must never have notified -- exactly one
      // success notification total, from the successful retry alone.
      expect(notifySuccessMock).toHaveBeenCalledTimes(1);
      expect(notifySuccessMock).toHaveBeenCalledWith("Listing paused");
    });
  });

  describe("Mark Sold/Archive (confirmation dialog)", () => {
    it("a Mark Sold restriction failure shows the generic message, specific restriction message, and Account-status link inside the open dialog", async () => {
      updateListingStatusMock.mockResolvedValue({ ok: false, code: "INTERACTION_BLOCKED", restriction: RESTRICTION });
      renderList({ initialListings: [listing({ status: "available" })] });

      fireEvent.click(screen.getByRole("button", { name: "Mark Sold" }));
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Mark Sold" }));

      const dialog = await screen.findByRole("dialog");
      await waitFor(() => expect(within(dialog).getByText("You are not able to manage listings right now.")).toBeInTheDocument());
      expect(within(dialog).getByText("Your selling access is currently suspended.")).toBeInTheDocument();
      expect(within(dialog).getByRole("link", { name: "View account status" })).toHaveAttribute("href", "/account#account-status");
      // The row underneath still carries the same presentation too (per item 6 -- row-level
      // behavior is unchanged), so both occurrences coexist in the DOM at once.
      expect(screen.getAllByText("Your selling access is currently suspended.")).toHaveLength(2);
      expect(notifySuccessMock).not.toHaveBeenCalled();
    });

    it("an Archive restriction failure shows the same generic message, specific restriction message, and Account-status link inside the open dialog", async () => {
      updateListingStatusMock.mockResolvedValue({ ok: false, code: "INTERACTION_BLOCKED", restriction: ACCOUNT_RESTRICTION });
      renderList({ initialListings: [listing({ status: "sold" })] });

      fireEvent.click(screen.getByRole("button", { name: "Archive" }));
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Archive" }));

      const dialog = await screen.findByRole("dialog");
      await waitFor(() => expect(within(dialog).getByText("You are not able to manage listings right now.")).toBeInTheDocument());
      expect(within(dialog).getByText("Your account is currently suspended.")).toBeInTheDocument();
      expect(within(dialog).getByRole("link", { name: "View account status" })).toHaveAttribute("href", "/account#account-status");
    });

    it("the restriction link inside the dialog is keyboard-accessible (a real, focusable anchor with the expected href)", async () => {
      updateListingStatusMock.mockResolvedValue({ ok: false, code: "INTERACTION_BLOCKED", restriction: RESTRICTION });
      renderList({ initialListings: [listing({ status: "available" })] });

      fireEvent.click(screen.getByRole("button", { name: "Mark Sold" }));
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Mark Sold" }));

      const link = await within(await screen.findByRole("dialog")).findByRole("link", { name: "View account status" });
      expect(link).toHaveAttribute("href", "/account#account-status");
      link.focus();
      expect(link).toHaveFocus();
    });

    it("a generic confirmation failure shows neither a restriction detail nor an Account-status link, inside or outside the dialog", async () => {
      updateListingStatusMock.mockResolvedValue({ ok: false, code: "INVALID_STATUS_TRANSITION" });
      renderList({ initialListings: [listing({ status: "sold" })] });

      fireEvent.click(screen.getByRole("button", { name: "Archive" }));
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Archive" }));

      const dialog = await screen.findByRole("dialog");
      await waitFor(() => expect(within(dialog).getByText(/isn't allowed from the listing's current status/i)).toBeInTheDocument());
      expect(within(dialog).queryByText(/suspended/i)).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "View account status" })).not.toBeInTheDocument();
    });

    it("row-level restriction presentation remains correctly associated with the same listing after the dialog closes", async () => {
      updateListingStatusMock.mockResolvedValue({ ok: false, code: "INTERACTION_BLOCKED", restriction: RESTRICTION });
      renderList({ initialListings: [listing({ status: "available", listingId: "listing-1", title: "Nike Air Max 270" })] });

      fireEvent.click(screen.getByRole("button", { name: "Mark Sold" }));
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Mark Sold" }));
      await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());

      fireEvent.click(screen.getByRole("button", { name: "Close" }));

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(screen.getByText("Nike Air Max 270")).toBeInTheDocument();
      expect(screen.getByText("Your selling access is currently suspended.")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "View account status" })).toHaveAttribute("href", "/account#account-status");
    });
  });

  describe("multiple listings -- no cross-row leakage", () => {
    it("a restriction error for listing A never appears on listing B's row", async () => {
      updateListingStatusMock.mockResolvedValueOnce({ ok: false, code: "INTERACTION_BLOCKED", restriction: RESTRICTION });
      renderList({
        initialListings: [
          listing({ listingId: "listing-1", title: "Listing A", status: "available" }),
          listing({ listingId: "listing-2", title: "Listing B", status: "available" }),
        ],
      });

      fireEvent.click(screen.getAllByRole("button", { name: "Pause" })[0]);

      expect(await screen.findByText("Your selling access is currently suspended.")).toBeInTheDocument();
      // Only one link should exist -- attached to listing A's row, not listing B's.
      expect(screen.getAllByRole("link", { name: "View account status" })).toHaveLength(1);
    });

    it("opening listing B's Mark Sold dialog after listing A's restriction failure never receives listing A's errorDetail or errorLink", async () => {
      updateListingStatusMock.mockResolvedValueOnce({ ok: false, code: "INTERACTION_BLOCKED", restriction: RESTRICTION });
      renderList({
        initialListings: [
          listing({ listingId: "listing-1", title: "Listing A", status: "available" }),
          listing({ listingId: "listing-2", title: "Listing B", status: "available" }),
        ],
      });

      fireEvent.click(screen.getAllByRole("button", { name: "Mark Sold" })[0]);
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Mark Sold" }));
      await waitFor(() =>
        expect(within(screen.getByRole("dialog")).getByText("You are not able to manage listings right now.")).toBeInTheDocument(),
      );
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

      fireEvent.click(screen.getAllByRole("button", { name: "Mark Sold" })[1]);

      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(within(screen.getByRole("dialog")).queryByRole("link", { name: "View account status" })).not.toBeInTheDocument();
      expect(within(screen.getByRole("dialog")).queryByText(/suspended/i)).not.toBeInTheDocument();
    });

    it("account_suspended and seller_suspended presentations never cross between two listings' independent failures", async () => {
      updateListingStatusMock.mockResolvedValueOnce({ ok: false, code: "INTERACTION_BLOCKED", restriction: RESTRICTION });
      updateListingStatusMock.mockResolvedValueOnce({ ok: false, code: "INTERACTION_BLOCKED", restriction: ACCOUNT_RESTRICTION });
      renderList({
        initialListings: [
          listing({ listingId: "listing-1", title: "Listing A", status: "available" }),
          listing({ listingId: "listing-2", title: "Listing B", status: "available" }),
        ],
      });

      fireEvent.click(screen.getAllByRole("button", { name: "Pause" })[0]);
      expect(await screen.findByText("Your selling access is currently suspended.")).toBeInTheDocument();

      fireEvent.click(screen.getAllByRole("button", { name: "Pause" })[1]);
      expect(await screen.findByText("Your account is currently suspended.")).toBeInTheDocument();
      // Listing A's message must still be the seller_suspended one, unaffected by listing B's own failure.
      expect(screen.getByText("Your selling access is currently suspended.")).toBeInTheDocument();
    });
  });
});

describe("SellerListingsListClient -- price/quantity/category display", () => {
  it("shows the formatted price when set", () => {
    renderList({ initialListings: [listing({ priceCents: 199900 })] });
    expect(screen.getByText("₱1,999")).toBeInTheDocument();
  });

  it("shows a placeholder for a Draft with no price yet", () => {
    renderList({ initialListings: [listing({ status: "draft", priceCents: null })] });
    expect(screen.getByText("No price set")).toBeInTheDocument();
  });

  it("shows reserved quantity only when greater than zero", () => {
    renderList({ initialListings: [listing({ stockQuantity: 5, reservedQuantity: 2 })] });
    expect(screen.getByText(/stock 5/i)).toHaveTextContent("2 reserved");
  });

  it("resolves the category name from the categories prop", () => {
    renderList({ initialListings: [listing({ categoryId: 1 })] });
    expect(screen.getByText("Women")).toBeInTheDocument();
  });
});
