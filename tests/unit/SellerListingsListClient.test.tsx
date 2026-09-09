import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

const { updateListingStatusMock } = vi.hoisted(() => ({
  updateListingStatusMock: vi.fn(),
}));

vi.mock("@/lib/seller/listing-actions", async () => {
  const actual = await vi.importActual<typeof import("@/lib/seller/listing-actions")>("@/lib/seller/listing-actions");
  return {
    ...actual,
    updateListingStatus: updateListingStatusMock,
  };
});

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

  it("Available shows View listing, Pause, Mark Sold, and Archive", () => {
    renderList({ initialListings: [listing({ status: "available" })] });
    expect(screen.getByRole("link", { name: "View listing" })).toHaveAttribute("href", "/item/PSL-ABC123");
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mark Sold" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Archive" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Resume" })).not.toBeInTheDocument();
  });

  it("Paused shows View listing (never, per canon), Resume, Mark Sold, and Archive -- no public view link", () => {
    renderList({ initialListings: [listing({ status: "paused" })] });
    expect(screen.queryByRole("link", { name: "View listing" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resume" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mark Sold" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Archive" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pause" })).not.toBeInTheDocument();
  });

  it("Sold shows View listing and Archive only", () => {
    renderList({ initialListings: [listing({ status: "sold" })] });
    expect(screen.getByRole("link", { name: "View listing" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Archive" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pause" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Resume" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mark Sold" })).not.toBeInTheDocument();
  });

  it("Archived shows View listing only -- no status actions, terminal state", () => {
    renderList({ initialListings: [listing({ status: "archived" })] });
    expect(screen.getByRole("link", { name: "View listing" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Archive" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pause" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Resume" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mark Sold" })).not.toBeInTheDocument();
  });

  it("Reserved shows View listing but zero status actions, with an explanatory note -- system-controlled only", () => {
    renderList({ initialListings: [listing({ status: "reserved", reservedQuantity: 1, availableQuantity: 0 })] });
    expect(screen.getByRole("link", { name: "View listing" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pause" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Resume" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mark Sold" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Archive" })).not.toBeInTheDocument();
    expect(screen.getByText(/reserved by an active order/i)).toBeInTheDocument();
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

  it("Archive opens a confirmation dialog too", () => {
    renderList({ initialListings: [listing({ status: "paused" })] });
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("if the confirmed action fails, the dialog stays open and shows the error", async () => {
    updateListingStatusMock.mockResolvedValue({ ok: false, code: "INVALID_STATUS_TRANSITION" });
    renderList({ initialListings: [listing({ status: "sold" })] });

    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Archive" }));

    await waitFor(() =>
      expect(within(screen.getByRole("dialog")).getByText(/isn't allowed from the listing's current status/i)).toBeInTheDocument(),
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
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
