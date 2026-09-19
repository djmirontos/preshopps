import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AccountSuspendedBanner } from "@/components/moderation/AccountSuspendedBanner";
import type { RestrictionType } from "@/lib/moderation/get-my-active-restrictions";

function restrictions(...types: RestrictionType[]) {
  return types.map((restrictionType) => ({ restrictionType }));
}

describe("AccountSuspendedBanner -- visibility rules", () => {
  it("renders nothing with no restrictions", () => {
    const { container } = render(<AccountSuspendedBanner restrictions={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing with only seller_suspended", () => {
    const { container } = render(<AccountSuspendedBanner restrictions={restrictions("seller_suspended")} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing with only buyer_restricted", () => {
    const { container } = render(<AccountSuspendedBanner restrictions={restrictions("buyer_restricted")} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing with seller_suspended and buyer_restricted together, but no account_suspended", () => {
    const { container } = render(<AccountSuspendedBanner restrictions={restrictions("seller_suspended", "buyer_restricted")} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders when account_suspended is present", () => {
    render(<AccountSuspendedBanner restrictions={restrictions("account_suspended")} />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/Your account is suspended\. View your account status for details\./)).toBeInTheDocument();
  });

  it("still renders when account_suspended is present alongside other restriction types", () => {
    render(<AccountSuspendedBanner restrictions={restrictions("seller_suspended", "account_suspended")} />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});

describe("AccountSuspendedBanner -- link and non-dismissibility", () => {
  it("links to /account#account-status", () => {
    render(<AccountSuspendedBanner restrictions={restrictions("account_suspended")} />);
    const link = screen.getByRole("link", { name: "View details" });
    expect(link).toHaveAttribute("href", "/account#account-status");
  });

  it("has no close/dismiss button of any kind", () => {
    render(<AccountSuspendedBanner restrictions={restrictions("account_suspended")} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/close|dismiss/i)).not.toBeInTheDocument();
  });
});
