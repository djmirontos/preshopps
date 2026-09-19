import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AccountStatusSection } from "@/components/account/AccountStatusSection";
import type { MyActiveRestriction } from "@/lib/moderation/get-my-active-restrictions";

function restriction(overrides: Partial<MyActiveRestriction> = {}): MyActiveRestriction {
  return {
    restrictionId: "r1",
    restrictionType: "seller_suspended",
    reason: "Repeated late shipments.",
    createdAt: "2026-09-01T12:00:00.000Z",
    ...overrides,
  };
}

describe("AccountStatusSection -- no restrictions", () => {
  it("renders nothing at all when the restrictions array is empty", () => {
    const { container } = render(<AccountStatusSection restrictions={[]} />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText("Account status")).not.toBeInTheDocument();
    expect(document.getElementById("account-status")).toBeNull();
  });
});

describe("AccountStatusSection -- single restriction cards", () => {
  it("renders the seller_suspended card with plain-language title and supporting copy", () => {
    render(<AccountStatusSection restrictions={[restriction({ restrictionType: "seller_suspended" })]} />);
    expect(screen.getByText("Selling suspended")).toBeInTheDocument();
    expect(screen.getByText(/You can't use normal selling features while this restriction is active\./)).toBeInTheDocument();
  });

  it("renders the buyer_restricted card with plain-language title and supporting copy", () => {
    render(<AccountStatusSection restrictions={[restriction({ restrictionType: "buyer_restricted" })]} />);
    expect(screen.getByText("Buying restricted")).toBeInTheDocument();
    expect(screen.getByText(/You can't place or update purchases while this restriction is active\./)).toBeInTheDocument();
  });

  it("renders the account_suspended card with plain-language title and supporting copy", () => {
    render(<AccountStatusSection restrictions={[restriction({ restrictionType: "account_suspended" })]} />);
    expect(screen.getByText("Account suspended")).toBeInTheDocument();
    expect(screen.getByText(/Buying and selling actions are restricted while this suspension is active\./)).toBeInTheDocument();
  });

  it("renders the reason text clearly", () => {
    render(<AccountStatusSection restrictions={[restriction({ reason: "Multiple confirmed scam reports." })]} />);
    expect(screen.getByText(/Multiple confirmed scam reports\./)).toBeInTheDocument();
  });

  it("renders an applied date derived from created_at", () => {
    render(<AccountStatusSection restrictions={[restriction({ createdAt: "2026-09-01T12:00:00.000Z" })]} />);
    expect(screen.getByText(/Applied Sep 1, 2026/)).toBeInTheDocument();
  });

  it("has id=\"account-status\" when at least one restriction exists", () => {
    render(<AccountStatusSection restrictions={[restriction()]} />);
    expect(document.getElementById("account-status")).not.toBeNull();
  });

  it("has an 'Account status' heading", () => {
    render(<AccountStatusSection restrictions={[restriction()]} />);
    expect(screen.getByRole("heading", { name: "Account status" })).toBeInTheDocument();
  });
});

describe("AccountStatusSection -- multiple simultaneous restrictions", () => {
  it("renders one independent card per restriction, never merged or summarized", () => {
    render(
      <AccountStatusSection
        restrictions={[
          restriction({ restrictionId: "r1", restrictionType: "seller_suspended", reason: "Reason A" }),
          restriction({ restrictionId: "r2", restrictionType: "buyer_restricted", reason: "Reason B" }),
        ]}
      />,
    );
    expect(screen.getByText("Selling suspended")).toBeInTheDocument();
    expect(screen.getByText("Buying restricted")).toBeInTheDocument();
    expect(screen.getByText(/Reason A/)).toBeInTheDocument();
    expect(screen.getByText(/Reason B/)).toBeInTheDocument();
  });
});

describe("AccountStatusSection -- never invents or leaks disallowed fields", () => {
  it("never renders an expiry/remaining-duration date, moderator name, or severity score -- none exist on MyActiveRestriction", () => {
    render(<AccountStatusSection restrictions={[restriction()]} />);
    expect(screen.queryByText(/expires|expiry|remaining|severity/i)).not.toBeInTheDocument();
  });

  it("never renders admin/moderator identity fields (issued_by, lifted_by are not part of this component's props at all)", () => {
    render(<AccountStatusSection restrictions={[restriction()]} />);
    expect(screen.queryByText(/issued by|lifted by|admin/i)).not.toBeInTheDocument();
  });
});
