import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AdminSupportTicketsListClient } from "@/components/admin/AdminSupportTicketsListClient";
import type { AdminSupportTicketSummary } from "@/lib/admin/get-admin-support-tickets";

function makeTicket(overrides: Partial<AdminSupportTicketSummary> = {}): AdminSupportTicketSummary {
  return {
    ticketId: "ticket-1",
    category: "general_inquiry",
    message: "How do I change my shop location?",
    userId: "user-1",
    userDisplayName: "Jane D.",
    createdAt: "2026-01-05T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AdminSupportTicketsListClient", () => {
  it("shows an error message instead of the list when the initial load failed", () => {
    render(<AdminSupportTicketsListClient initialTickets={[]} initialHadError={true} initialCursor={null} loadMore={vi.fn()} />);
    expect(screen.getByText("Unable to load support tickets right now.")).toBeInTheDocument();
  });

  it("shows an empty state with no tickets", () => {
    render(<AdminSupportTicketsListClient initialTickets={[]} initialHadError={false} initialCursor={null} loadMore={vi.fn()} />);
    expect(screen.getByText("No support tickets yet.")).toBeInTheDocument();
  });

  it("renders each ticket linking to its detail page", () => {
    render(
      <AdminSupportTicketsListClient
        initialTickets={[makeTicket()]}
        initialHadError={false}
        initialCursor={null}
        loadMore={vi.fn()}
      />,
    );
    expect(screen.getByRole("link", { name: /How do I change my shop location/ })).toHaveAttribute("href", "/admin/support/ticket-1");
    expect(screen.getByText("General inquiry")).toBeInTheDocument();
    expect(screen.getByText("Jane D.")).toBeInTheDocument();
  });

  it("does not show Load More when there is no next cursor", () => {
    render(<AdminSupportTicketsListClient initialTickets={[makeTicket()]} initialHadError={false} initialCursor={null} loadMore={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  });

  it("Load More appends the next page using the given cursor", async () => {
    const loadMore = vi.fn().mockResolvedValue({
      tickets: [makeTicket({ ticketId: "ticket-2", message: "Second ticket" })],
      hadError: false,
      nextCursor: null,
    });
    render(
      <AdminSupportTicketsListClient
        initialTickets={[makeTicket()]}
        initialHadError={false}
        initialCursor={{ createdAt: "2026-01-05T00:00:00.000Z", id: "ticket-1" }}
        loadMore={loadMore}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Load more" }));

    expect(loadMore).toHaveBeenCalledWith({ createdAt: "2026-01-05T00:00:00.000Z", id: "ticket-1" });
    expect(await screen.findByText("Second ticket")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  });

  it("shows an inline error and keeps the existing list if Load More fails", async () => {
    const loadMore = vi.fn().mockResolvedValue({ tickets: [], hadError: true, nextCursor: null });
    render(
      <AdminSupportTicketsListClient
        initialTickets={[makeTicket()]}
        initialHadError={false}
        initialCursor={{ createdAt: "2026-01-05T00:00:00.000Z", id: "ticket-1" }}
        loadMore={loadMore}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Load more" }));

    await waitFor(() => expect(screen.getByText("Unable to load more support tickets right now.")).toBeInTheDocument());
    expect(screen.getByText("How do I change my shop location?")).toBeInTheDocument();
  });
});
