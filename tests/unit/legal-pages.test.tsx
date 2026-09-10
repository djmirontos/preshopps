import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { AuthUser } from "@/lib/auth/session";

import TermsPage from "@/app/terms/page";
import PrivacyPage from "@/app/privacy/page";
import MarketplaceRulesPage from "@/app/marketplace-rules/page";
import ProhibitedItemsPage from "@/app/prohibited-items/page";
import HowItWorksPage from "@/app/how-it-works/page";
import SafetyPage from "@/app/safety/page";

const { getAuthUserMock } = vi.hoisted(() => ({
  getAuthUserMock: vi.fn<() => Promise<AuthUser | null>>(),
}));

vi.mock("@/lib/auth/session", () => ({
  getAuthUser: getAuthUserMock,
}));

// vi.mock calls above are hoisted above all imports by Vitest, so this
// static import already resolves against the mocked module.
import SupportPage from "@/app/support/page";

/**
 * Proves the seven PRD 44 public informational pages exist and render
 * real content -- and, per this task's own explicit prohibition, that
 * none of them claims escrow, payment processing, refunds, or a buyer/
 * seller guarantee Preshopps does not actually provide (PRD 21.1/34.5/45/
 * 46). Every page here is guest-accessible: none of the six static pages
 * call getAuthUser at all, and /support renders for a guest without
 * redirecting (only its embedded form is gated).
 */
// Positive-claim patterns only -- pages are expected to explicitly say
// Preshopps does NOT provide these, so a bare word-boundary match on
// "escrow" etc. would false-positive on the correct disclaimer itself.
const FORBIDDEN_CLAIMS = [
  /preshopps (?:provides|offers|holds) escrow/i,
  /buyer protection (?:program|guarantee)/i,
  /money[- ]back guarantee/i,
  /preshopps (?:holds|processes|handles) (?:your )?payments?/i,
  /guaranteed refund/i,
  /guarantees? (?:a |the )?(?:transaction|delivery|refund)/i,
];

function expectNoOverpromising(container: HTMLElement) {
  const text = container.textContent ?? "";
  for (const pattern of FORBIDDEN_CLAIMS) {
    expect(text).not.toMatch(pattern);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Terms of Use (/terms)", () => {
  it("renders the page heading and key sections", () => {
    const { container } = render(<TermsPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Terms of Use" })).toBeInTheDocument();
    expect(screen.getByText(/no escrow or payment processing in mvp/i)).toBeInTheDocument();
    expectNoOverpromising(container);
  });

  it("links to the Privacy Policy, Marketplace Rules, and Prohibited Items Policy", () => {
    render(<TermsPage />);
    expect(screen.getByRole("link", { name: "Privacy Policy" })).toHaveAttribute("href", "/privacy");
    expect(screen.getAllByRole("link", { name: "Marketplace Rules" })[0]).toHaveAttribute("href", "/marketplace-rules");
    expect(screen.getAllByRole("link", { name: "Prohibited Items Policy" })[0]).toHaveAttribute("href", "/prohibited-items");
  });
});

describe("Privacy Policy (/privacy)", () => {
  it("renders the page heading and does not claim analytics/cookie tooling or a payment processor", () => {
    const { container } = render(<PrivacyPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Privacy Policy" })).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/google analytics|cookie consent|stripe|paypal|gcash/i);
    expectNoOverpromising(container);
  });

  it("covers account deletion/anonymization", () => {
    render(<PrivacyPage />);
    expect(screen.getByText(/anonymize your public/i)).toBeInTheDocument();
  });
});

describe("Marketplace Rules (/marketplace-rules)", () => {
  it("renders and links to the Prohibited Items Policy", () => {
    const { container } = render(<MarketplaceRulesPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Marketplace Rules" })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Prohibited Items Policy" })[0]).toHaveAttribute("href", "/prohibited-items");
    expectNoOverpromising(container);
  });
});

describe("Prohibited Items Policy (/prohibited-items)", () => {
  it("reproduces the canonical PRD 32 examples and states the list is non-exhaustive", () => {
    render(<ProhibitedItemsPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Prohibited Items Policy" })).toBeInTheDocument();
    for (const item of [
      "Weapons and ammunition",
      "Illegal drugs",
      "Prescription medicines",
      "Counterfeit goods",
      "Stolen goods",
      "Adult sexual products",
      "Hazardous chemicals",
      "Alcohol",
      "Nicotine products",
      "Anything illegal under applicable Philippine law",
    ]) {
      expect(screen.getByText(item)).toBeInTheDocument();
    }
    expect(screen.getByText(/not a complete list/i)).toBeInTheDocument();
  });
});

describe("How It Works (/how-it-works)", () => {
  it("covers buying, selling, Trusted Seller, and inquiry-only categories without a payment-processing claim", () => {
    const { container } = render(<HowItWorksPage />);
    expect(screen.getByRole("heading", { level: 1, name: "How It Works" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "How to buy" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "How to sell" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Trusted Seller" })).toBeInTheDocument();
    expect(screen.getByText(/does not process payments or arrange shipping/i)).toBeInTheDocument();
    expectNoOverpromising(container);
  });
});

describe("Safety Tips (/safety)", () => {
  it("gives practical reminders without claiming escrow or buyer protection", () => {
    const { container } = render(<SafetyPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Safety Tips" })).toBeInTheDocument();
    expect(screen.getByText(/never ask for your password or a one-time code/i)).toBeInTheDocument();
    expect(screen.getByText(/signal, not a guarantee/i)).toBeInTheDocument();
    expectNoOverpromising(container);
  });
});

describe("Contact / Support (/support)", () => {
  it("is reachable by a guest and shows the public contact email without redirecting", async () => {
    getAuthUserMock.mockResolvedValue(null);
    render(await SupportPage());

    expect(screen.getByRole("heading", { level: 1, name: "Contact / Support" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "support@preshopps.com" })).toHaveAttribute("href", "mailto:support@preshopps.com");
  });

  it("prompts a guest to sign in instead of showing the submission form", async () => {
    getAuthUserMock.mockResolvedValue(null);
    render(await SupportPage());

    expect(screen.getByRole("link", { name: "sign in" })).toHaveAttribute("href", "/sign-in?next=%2Fsupport");
    expect(screen.queryByLabelText("Category")).not.toBeInTheDocument();
  });

  it("shows the submission form for a signed-in user", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: "buyer@example.com" });
    render(await SupportPage());

    expect(screen.getByLabelText("Category")).toBeInTheDocument();
    expect(screen.getByLabelText(/how can we help/i)).toBeInTheDocument();
  });
});
