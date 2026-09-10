import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SellerPolicyConsentDialog } from "@/components/seller/SellerPolicyConsentDialog";

beforeEach(() => {
  vi.clearAllMocks();
});

function renderDialog(overrides: Partial<React.ComponentProps<typeof SellerPolicyConsentDialog>> = {}) {
  return render(
    <SellerPolicyConsentDialog isPending={false} errorMessage={null} onAccept={vi.fn()} onClose={vi.fn()} {...overrides} />,
  );
}

/**
 * Proves the two policy names in the checkbox label are now real,
 * accessible links (opened in a new tab so an in-progress publish isn't
 * lost) rather than plain text -- the one behavior change this task's own
 * "SELLER POLICY CONSENT" instruction asked for. Everything else (single
 * combined checkbox, no policy-versioning, accept_seller_policies backend)
 * is unchanged and re-asserted here.
 */
describe("SellerPolicyConsentDialog -- policy links", () => {
  it("links Marketplace Rules to /marketplace-rules and opens it in a new tab", () => {
    renderDialog();
    const link = screen.getByRole("link", { name: "Marketplace Rules" });
    expect(link).toHaveAttribute("href", "/marketplace-rules");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("links Prohibited Items Policy to /prohibited-items and opens it in a new tab", () => {
    renderDialog();
    const link = screen.getByRole("link", { name: "Prohibited Items Policy" });
    expect(link).toHaveAttribute("href", "/prohibited-items");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });
});

describe("SellerPolicyConsentDialog -- single combined checkbox unchanged", () => {
  it("remains exactly one checkbox, disabled Accept until checked", () => {
    renderDialog();
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(1);

    const acceptButton = screen.getByRole("button", { name: "Accept & Publish" });
    expect(acceptButton).toBeDisabled();

    fireEvent.click(checkboxes[0]);
    expect(acceptButton).not.toBeDisabled();
  });

  it("calls onAccept only after the checkbox is checked", () => {
    const onAccept = vi.fn();
    renderDialog({ onAccept });

    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Accept & Publish" }));

    expect(onAccept).toHaveBeenCalledTimes(1);
  });

  it("Cancel calls onClose without accepting", () => {
    const onAccept = vi.fn();
    const onClose = vi.fn();
    renderDialog({ onAccept, onClose });

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onAccept).not.toHaveBeenCalled();
  });

  it("shows an error message when provided", () => {
    renderDialog({ errorMessage: "You must accept the Marketplace Rules and Prohibited Items Policy before publishing." });
    expect(screen.getByText("You must accept the Marketplace Rules and Prohibited Items Policy before publishing.")).toBeInTheDocument();
  });
});
