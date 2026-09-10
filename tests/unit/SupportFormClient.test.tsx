import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { submitSupportTicketMock } = vi.hoisted(() => ({
  submitSupportTicketMock: vi.fn(),
}));

vi.mock("@/lib/support/submit-support-ticket", async () => {
  const actual = await vi.importActual<typeof import("@/lib/support/submit-support-ticket")>("@/lib/support/submit-support-ticket");
  return {
    ...actual,
    submitSupportTicket: submitSupportTicketMock,
  };
});

import { SupportFormClient } from "@/components/support/SupportFormClient";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SupportFormClient", () => {
  it("shows all four canonical PRD 43.1 categories", () => {
    render(<SupportFormClient />);
    const select = screen.getByLabelText("Category") as HTMLSelectElement;
    const optionLabels = Array.from(select.options).map((o) => o.text);
    expect(optionLabels).toEqual(["Choose a category", "General inquiry", "Account issue", "Order/dispute issue", "Report a problem"]);
  });

  it("disables Send request until a category and non-blank message are provided", () => {
    render(<SupportFormClient />);
    const submit = screen.getByRole("button", { name: "Send request" });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "general_inquiry" } });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/how can we help/i), { target: { value: "   " } });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/how can we help/i), { target: { value: "I have a question." } });
    expect(submit).not.toBeDisabled();
  });

  it("submits the chosen category and trimmed message, then shows a confirmation", async () => {
    submitSupportTicketMock.mockResolvedValue({ ok: true, ticketId: "ticket-1", createdAt: "now" });
    render(<SupportFormClient />);

    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "account_issue" } });
    fireEvent.change(screen.getByLabelText(/how can we help/i), { target: { value: "  Please delete my account.  " } });
    fireEvent.click(screen.getByRole("button", { name: "Send request" }));

    await waitFor(() => expect(submitSupportTicketMock).toHaveBeenCalledWith("account_issue", "Please delete my account."));
    expect(await screen.findByText(/request submitted/i)).toBeInTheDocument();
  });

  it("shows a friendly error and keeps the form usable on failure", async () => {
    submitSupportTicketMock.mockResolvedValue({ ok: false, code: "NOT_AUTHENTICATED" });
    render(<SupportFormClient />);

    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "general_inquiry" } });
    fireEvent.change(screen.getByLabelText(/how can we help/i), { target: { value: "Hello" } });
    fireEvent.click(screen.getByRole("button", { name: "Send request" }));

    expect(await screen.findByText(/please sign in and try again/i)).toBeInTheDocument();
    expect(screen.queryByText(/request submitted/i)).not.toBeInTheDocument();
  });
});
