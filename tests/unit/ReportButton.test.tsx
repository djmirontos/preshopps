import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

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

import { ReportButton } from "@/components/moderation/ReportButton";

beforeEach(() => {
  vi.clearAllMocks();
});

function renderButton(overrides: Partial<React.ComponentProps<typeof ReportButton>> = {}) {
  return render(
    <ReportButton
      targetType="listing"
      targetId="listing-1"
      targetLabel="listing"
      isAuthenticated={true}
      next="/item/PSL-ABC"
      {...overrides}
    />,
  );
}

describe("ReportButton -- visibility", () => {
  it("renders nothing when hidden (e.g. viewing one's own listing)", () => {
    const { container } = renderButton({ hidden: true });
    expect(container).toBeEmptyDOMElement();
  });

  it("renders a Report affordance by default", () => {
    renderButton();
    expect(screen.getByRole("button", { name: /report/i })).toBeInTheDocument();
  });
});

describe("ReportButton -- guest", () => {
  it("shows an AuthGate instead of the report dialog for an unauthenticated viewer", () => {
    renderButton({ isAuthenticated: false });
    fireEvent.click(screen.getByRole("button", { name: /report/i }));

    expect(screen.getByRole("dialog", { name: /sign in to report/i })).toBeInTheDocument();
    expect(screen.queryByLabelText("Reason")).not.toBeInTheDocument();
  });
});

describe("ReportButton -- authenticated submission flow", () => {
  it("opens the report dialog with a reason select and optional description", () => {
    renderButton();
    fireEvent.click(screen.getByRole("button", { name: /report/i }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText("Reason")).toBeInTheDocument();
    expect(screen.getByLabelText(/details/i)).toBeInTheDocument();
  });

  it("Submit is disabled until a reason is chosen", () => {
    renderButton();
    fireEvent.click(screen.getByRole("button", { name: /report/i }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "Submit report" })).toBeDisabled();

    fireEvent.change(within(dialog).getByLabelText("Reason"), { target: { value: "spam" } });
    expect(within(dialog).getByRole("button", { name: "Submit report" })).not.toBeDisabled();
  });

  it("submits the chosen reason and description, then shows a confirmation", async () => {
    submitReportMock.mockResolvedValue({ ok: true, reportId: "report-1", createdAt: "now" });
    renderButton();

    fireEvent.click(screen.getByRole("button", { name: /report/i }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Reason"), { target: { value: "scam_fraud" } });
    fireEvent.change(within(dialog).getByLabelText(/details/i), { target: { value: "Seller asked for payment outside the app." } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Submit report" }));

    await waitFor(() =>
      expect(submitReportMock).toHaveBeenCalledWith("listing", "listing-1", "scam_fraud", "Seller asked for payment outside the app."),
    );
    expect(await screen.findByText(/report submitted/i)).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("sends null when no description is entered", async () => {
    submitReportMock.mockResolvedValue({ ok: true, reportId: "report-1", createdAt: "now" });
    renderButton();

    fireEvent.click(screen.getByRole("button", { name: /report/i }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Reason"), { target: { value: "spam" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Submit report" }));

    await waitFor(() => expect(submitReportMock).toHaveBeenCalledWith("listing", "listing-1", "spam", null));
  });

  it("Cancel closes the dialog without submitting", () => {
    renderButton();
    fireEvent.click(screen.getByRole("button", { name: /report/i }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(submitReportMock).not.toHaveBeenCalled();
  });

  it("shows a friendly error and keeps the dialog open on failure (e.g. self-report)", async () => {
    submitReportMock.mockResolvedValue({ ok: false, code: "SELF_REPORT_NOT_ALLOWED" });
    renderButton();

    fireEvent.click(screen.getByRole("button", { name: /report/i }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Reason"), { target: { value: "spam" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Submit report" }));

    expect(await screen.findByText(/can't report your own content/i)).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
