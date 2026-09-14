import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { createDisputeMock, pushMock } = vi.hoisted(() => ({
  createDisputeMock: vi.fn(),
  pushMock: vi.fn(),
}));

vi.mock("@/lib/disputes/dispute-actions", async () => {
  const actual = await vi.importActual<typeof import("@/lib/disputes/dispute-actions")>("@/lib/disputes/dispute-actions");
  return { ...actual, createDispute: createDisputeMock };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock("@/lib/image-processing/upload-image", () => ({
  uploadImage: vi.fn(),
  deleteUploadedImage: vi.fn(),
  UPLOAD_IMAGE_ERROR_MESSAGES: {},
}));

import { DisputeSection } from "@/components/disputes/DisputeSection";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("DisputeSection -- eligibility (buyer and seller both use this same component)", () => {
  it("renders nothing for a pending order (no active order yet)", () => {
    const { container } = render(
      <DisputeSection orderId="order-1" orderStatus="pending" viewerUserId="u1" existingDispute={null} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for a completed order", () => {
    const { container } = render(
      <DisputeSection orderId="order-1" orderStatus="completed" viewerUserId="u1" existingDispute={null} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders Open Dispute for an accepted order", () => {
    render(<DisputeSection orderId="order-1" orderStatus="accepted" viewerUserId="u1" existingDispute={null} />);
    expect(screen.getByRole("button", { name: "Open Dispute" })).toBeInTheDocument();
  });

  it("renders Open Dispute for a received_confirmed order (buyer confirmed but seller/admin may still need to intervene)", () => {
    render(<DisputeSection orderId="order-1" orderStatus="received_confirmed" viewerUserId="u1" existingDispute={null} />);
    expect(screen.getByRole("button", { name: "Open Dispute" })).toBeInTheDocument();
  });

  it("Open Dispute uses the same robust min-height sizing strategy as the other seller order-detail action buttons, and stays full width on mobile", () => {
    render(<DisputeSection orderId="order-1" orderStatus="accepted" viewerUserId="u1" existingDispute={null} />);
    const button = screen.getByRole("button", { name: "Open Dispute" });
    // Exact-token check (not substring) -- "h-12" is a substring of
    // "min-h-12", so a naive toContain("h-12") would false-positive here.
    const tokens = button.className.split(/\s+/).filter(Boolean);
    expect(tokens).toContain("min-h-12");
    expect(tokens).toContain("flex");
    expect(tokens).toContain("items-center");
    expect(tokens).toContain("justify-center");
    expect(tokens).toContain("py-3");
    expect(tokens).toContain("w-full");
    expect(tokens).not.toContain("h-12");
    expect(tokens).not.toContain("h-11");
  });
});

describe("DisputeSection -- existing dispute", () => {
  it("shows the current status and a link to the dispute instead of Open Dispute", () => {
    render(
      <DisputeSection
        orderId="order-1"
        orderStatus="disputed"
        viewerUserId="u1"
        existingDispute={{ disputeId: "dispute-1", status: "under_review" }}
      />,
    );
    expect(screen.getByText("Dispute: Under Review")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View dispute" })).toHaveAttribute("href", "/disputes/dispute-1");
    expect(screen.queryByRole("button", { name: "Open Dispute" })).not.toBeInTheDocument();
  });
});

describe("DisputeSection -- creation flow", () => {
  it("opens the creation dialog with reason, explanation, and a no-escrow disclaimer", () => {
    render(<DisputeSection orderId="order-1" orderStatus="accepted" viewerUserId="u1" existingDispute={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Open Dispute" }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText("Reason")).toBeInTheDocument();
    expect(screen.getByLabelText("Explanation")).toBeInTheDocument();
    expect(screen.getByText(/does not hold funds or issue automated refunds/i)).toBeInTheDocument();
  });

  it("Submit is disabled until both reason and explanation are filled", () => {
    render(<DisputeSection orderId="order-1" orderStatus="accepted" viewerUserId="u1" existingDispute={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Open Dispute" }));

    const dialog = screen.getByRole("dialog");
    expect(screen.getByRole("button", { name: "Submit dispute" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Item never arrived" } });
    expect(screen.getByRole("button", { name: "Submit dispute" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Explanation"), { target: { value: "Never received the package." } });
    expect(screen.getByRole("button", { name: "Submit dispute" })).not.toBeDisabled();
    void dialog;
  });

  it("submits reason/explanation/empty image list and navigates to the new dispute on success", async () => {
    createDisputeMock.mockResolvedValue({ ok: true, disputeId: "dispute-9", createdAt: "now" });
    render(<DisputeSection orderId="order-1" orderStatus="accepted" viewerUserId="u1" existingDispute={null} />);

    fireEvent.click(screen.getByRole("button", { name: "Open Dispute" }));
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Item never arrived" } });
    fireEvent.change(screen.getByLabelText("Explanation"), { target: { value: "Never received the package." } });
    fireEvent.click(screen.getByRole("button", { name: "Submit dispute" }));

    await waitFor(() =>
      expect(createDisputeMock).toHaveBeenCalledWith("order-1", "Item never arrived", "Never received the package.", []),
    );
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/disputes/dispute-9"));
  });

  it("shows a friendly error and keeps the dialog open on failure (e.g. duplicate active dispute)", async () => {
    createDisputeMock.mockResolvedValue({ ok: false, code: "DISPUTE_ALREADY_ACTIVE" });
    render(<DisputeSection orderId="order-1" orderStatus="accepted" viewerUserId="u1" existingDispute={null} />);

    fireEvent.click(screen.getByRole("button", { name: "Open Dispute" }));
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Item never arrived" } });
    fireEvent.change(screen.getByLabelText("Explanation"), { target: { value: "Never received the package." } });
    fireEvent.click(screen.getByRole("button", { name: "Submit dispute" }));

    expect(await screen.findByText("A dispute is already open for this order.")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("Cancel closes the dialog without submitting", () => {
    render(<DisputeSection orderId="order-1" orderStatus="accepted" viewerUserId="u1" existingDispute={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Open Dispute" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(createDisputeMock).not.toHaveBeenCalled();
  });
});
