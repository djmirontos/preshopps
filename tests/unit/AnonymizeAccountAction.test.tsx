import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { anonymizeMock, refreshMock } = vi.hoisted(() => ({
  anonymizeMock: vi.fn(),
  refreshMock: vi.fn(),
}));

vi.mock("@/lib/admin/account-anonymization-actions", async () => {
  const actual = await vi.importActual<typeof import("@/lib/admin/account-anonymization-actions")>(
    "@/lib/admin/account-anonymization-actions",
  );
  return { ...actual, anonymizeUserAccount: anonymizeMock };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

import { AnonymizeAccountAction } from "@/components/admin/AnonymizeAccountAction";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AnonymizeAccountAction -- visibility", () => {
  it("renders nothing for a non-account_issue ticket", () => {
    const { container } = render(
      <AnonymizeAccountAction userId="user-1" category="general_inquiry" userDeletedAt={null} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for order_dispute_issue or report_a_problem", () => {
    const { container: c1 } = render(
      <AnonymizeAccountAction userId="user-1" category="order_dispute_issue" userDeletedAt={null} />,
    );
    expect(c1).toBeEmptyDOMElement();

    const { container: c2 } = render(
      <AnonymizeAccountAction userId="user-1" category="report_a_problem" userDeletedAt={null} />,
    );
    expect(c2).toBeEmptyDOMElement();
  });

  it("renders the Anonymize Account button for an account_issue ticket with no prior anonymization", () => {
    render(<AnonymizeAccountAction userId="user-1" category="account_issue" userDeletedAt={null} />);
    expect(screen.getByRole("button", { name: "Anonymize Account" })).toBeInTheDocument();
  });

  it("renders an anonymized badge, not the action button, once already anonymized", () => {
    render(
      <AnonymizeAccountAction userId="user-1" category="account_issue" userDeletedAt="2026-02-01T00:00:00.000Z" />,
    );
    expect(screen.queryByRole("button", { name: "Anonymize Account" })).not.toBeInTheDocument();
    expect(screen.getByText("Account anonymized")).toBeInTheDocument();
  });
});

describe("AnonymizeAccountAction -- confirmation and reason UX", () => {
  it("does not call anonymizeUserAccount just by rendering -- no automatic anonymization", () => {
    render(<AnonymizeAccountAction userId="user-1" category="account_issue" userDeletedAt={null} />);
    expect(anonymizeMock).not.toHaveBeenCalled();
  });

  it("opens a confirm dialog with a required reason field and a clear warning, without calling the RPC yet", () => {
    render(<AnonymizeAccountAction userId="user-1" category="account_issue" userDeletedAt={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Anonymize Account" }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/public identity/i)).toBeInTheDocument();
    expect(screen.getByText(/history is preserved/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Reason")).toBeInTheDocument();
    expect(anonymizeMock).not.toHaveBeenCalled();
  });

  it("keeps the confirm button disabled until a reason is entered", () => {
    render(<AnonymizeAccountAction userId="user-1" category="account_issue" userDeletedAt={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Anonymize Account" }));

    expect(screen.getByRole("button", { name: "Anonymize account" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "User requested deletion via support." } });
    expect(screen.getByRole("button", { name: "Anonymize account" })).not.toBeDisabled();
  });

  it("submits the reason, calls anonymizeUserAccount, closes the dialog, and refreshes on success", async () => {
    anonymizeMock.mockResolvedValue({ ok: true, userId: "user-1", wasAlreadyAnonymized: false, anonymizedAt: "2026-02-01T00:00:00.000Z" });

    render(<AnonymizeAccountAction userId="user-1" category="account_issue" userDeletedAt={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Anonymize Account" }));
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "User requested deletion via support." } });
    fireEvent.click(screen.getByRole("button", { name: "Anonymize account" }));

    await waitFor(() =>
      expect(anonymizeMock).toHaveBeenCalledWith("user-1", "User requested deletion via support."),
    );
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("shows a friendly error and keeps the dialog open on failure (e.g. last super admin)", async () => {
    anonymizeMock.mockResolvedValue({ ok: false, code: "LAST_SUPER_ADMIN" });

    render(<AnonymizeAccountAction userId="user-1" category="account_issue" userDeletedAt={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Anonymize Account" }));
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Testing" } });
    fireEvent.click(screen.getByRole("button", { name: "Anonymize account" }));

    expect(await screen.findByText("You can't anonymize the last remaining super admin.")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("closes the dialog without calling anonymizeUserAccount when cancelled", () => {
    render(<AnonymizeAccountAction userId="user-1" category="account_issue" userDeletedAt={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Anonymize Account" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(anonymizeMock).not.toHaveBeenCalled();
  });
});
