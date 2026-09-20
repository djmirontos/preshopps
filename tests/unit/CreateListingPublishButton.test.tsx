import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { pushMock, publishListingMock, acceptSellerPoliciesMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  publishListingMock: vi.fn(),
  acceptSellerPoliciesMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock("@/lib/seller/listing-actions", async () => {
  const actual = await vi.importActual<typeof import("@/lib/seller/listing-actions")>("@/lib/seller/listing-actions");
  return {
    ...actual,
    publishListing: publishListingMock,
    acceptSellerPolicies: acceptSellerPoliciesMock,
  };
});

import { CreateListingPublishButton } from "@/components/seller/CreateListingPublishButton";

beforeEach(() => {
  vi.clearAllMocks();
});

function renderButton(overrides: Partial<React.ComponentProps<typeof CreateListingPublishButton>> = {}) {
  const ensureAndPersist = vi.fn().mockResolvedValue("listing-1");
  return render(<CreateListingPublishButton canPublish={true} ensureAndPersist={ensureAndPersist} {...overrides} />);
}

describe("CreateListingPublishButton -- visibility and gating", () => {
  it("always renders Publish Listing, even when canPublish is false", () => {
    renderButton({ canPublish: false });
    expect(screen.getByRole("button", { name: "Publish Listing" })).toBeInTheDocument();
  });

  it("disables the button while canPublish is false", () => {
    renderButton({ canPublish: false });
    expect(screen.getByRole("button", { name: "Publish Listing" })).toBeDisabled();
  });

  it("enables the button once canPublish is true", () => {
    renderButton({ canPublish: true });
    expect(screen.getByRole("button", { name: "Publish Listing" })).not.toBeDisabled();
  });

  it("never calls ensureAndPersist or publish_listing when clicked while canPublish is false", () => {
    const ensureAndPersist = vi.fn().mockResolvedValue("listing-1");
    renderButton({ canPublish: false, ensureAndPersist });
    fireEvent.click(screen.getByRole("button", { name: "Publish Listing" }));
    expect(ensureAndPersist).not.toHaveBeenCalled();
    expect(publishListingMock).not.toHaveBeenCalled();
  });

  it("never pre-reads seller-policy acceptance state on mount", () => {
    renderButton();
    expect(acceptSellerPoliciesMock).not.toHaveBeenCalled();
    expect(publishListingMock).not.toHaveBeenCalled();
  });
});

describe("CreateListingPublishButton -- ensure+persist before publish", () => {
  it("calls ensureAndPersist first, then publishes the id it resolves to", async () => {
    const ensureAndPersist = vi.fn().mockResolvedValue("draft-42");
    publishListingMock.mockResolvedValue({ ok: true, listingId: "draft-42", publicCode: "PSL-ABC", slug: "x", status: "available", publishedAt: "now" });
    renderButton({ ensureAndPersist });

    fireEvent.click(screen.getByRole("button", { name: "Publish Listing" }));

    await waitFor(() => expect(ensureAndPersist).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(publishListingMock).toHaveBeenCalledWith("draft-42"));
  });

  it("shows a friendly error and never calls publish_listing when ensureAndPersist resolves to null", async () => {
    const ensureAndPersist = vi.fn().mockResolvedValue(null);
    renderButton({ ensureAndPersist });

    fireEvent.click(screen.getByRole("button", { name: "Publish Listing" }));

    expect(await screen.findByText(/couldn't save your listing/i)).toBeInTheDocument();
    expect(publishListingMock).not.toHaveBeenCalled();
  });

  it("navigates to /item/{publicCode} on success", async () => {
    publishListingMock.mockResolvedValue({ ok: true, listingId: "listing-1", publicCode: "PSL-ABC123", slug: "x", status: "available", publishedAt: "now" });
    renderButton();

    fireEvent.click(screen.getByRole("button", { name: "Publish Listing" }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/item/PSL-ABC123"));
  });

  it("disables the button while publishing is pending, preventing a duplicate attempt", async () => {
    let resolvePublish: (value: unknown) => void = () => {};
    publishListingMock.mockReturnValue(new Promise((resolve) => (resolvePublish = resolve)));
    renderButton();

    const button = screen.getByRole("button", { name: "Publish Listing" });
    fireEvent.click(button);

    expect(await screen.findByRole("button", { name: "Publishing…" })).toBeDisabled();
    fireEvent.click(button);
    expect(publishListingMock).toHaveBeenCalledTimes(1);

    resolvePublish({ ok: true, listingId: "listing-1", publicCode: "PSL-ABC", slug: "x", status: "available", publishedAt: "now" });
    await waitFor(() => expect(pushMock).toHaveBeenCalled());
  });
});

describe("CreateListingPublishButton -- ordinary validation failures", () => {
  it("shows a friendly message and stays on the page for a plain completeness error", async () => {
    publishListingMock.mockResolvedValue({ ok: false, code: "PRICE_REQUIRED" });
    renderButton();

    fireEvent.click(screen.getByRole("button", { name: "Publish Listing" }));

    expect(await screen.findByText("Please enter a price before publishing.")).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("never mutates listing state on an ordinary validation failure -- publish_listing is called exactly once", async () => {
    publishListingMock.mockResolvedValue({ ok: false, code: "IMAGE_REQUIRED" });
    renderButton();

    fireEvent.click(screen.getByRole("button", { name: "Publish Listing" }));
    await screen.findByText(/please add at least one photo before publishing/i);

    expect(publishListingMock).toHaveBeenCalledTimes(1);
  });
});

describe("CreateListingPublishButton -- SELLER_POLICIES_NOT_ACCEPTED consent flow", () => {
  it("opens the consent dialog reactively when publish_listing returns SELLER_POLICIES_NOT_ACCEPTED", async () => {
    publishListingMock.mockResolvedValue({ ok: false, code: "SELLER_POLICIES_NOT_ACCEPTED" });
    renderButton();

    fireEvent.click(screen.getByRole("button", { name: "Publish Listing" }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent(/marketplace rules/i);
    expect(dialog).toHaveTextContent(/prohibited items policy/i);
  });

  it("calls accept_seller_policies only after explicit checkbox consent, never merely by opening the dialog", async () => {
    publishListingMock.mockResolvedValue({ ok: false, code: "SELLER_POLICIES_NOT_ACCEPTED" });
    acceptSellerPoliciesMock.mockResolvedValue({ ok: true, acceptedAt: "2026-01-05T00:00:00.000Z" });
    renderButton();
    fireEvent.click(screen.getByRole("button", { name: "Publish Listing" }));
    await screen.findByRole("dialog");

    expect(acceptSellerPoliciesMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Accept & Publish" }));

    await waitFor(() => expect(acceptSellerPoliciesMock).toHaveBeenCalledTimes(1));
  });

  it("automatically retries publish_listing (against the same ensured id) after a successful acceptance, and redirects on retry success", async () => {
    const ensureAndPersist = vi.fn().mockResolvedValue("draft-7");
    publishListingMock
      .mockResolvedValueOnce({ ok: false, code: "SELLER_POLICIES_NOT_ACCEPTED" })
      .mockResolvedValueOnce({ ok: true, listingId: "draft-7", publicCode: "PSL-XYZ", slug: "x", status: "available", publishedAt: "now" });
    acceptSellerPoliciesMock.mockResolvedValue({ ok: true, acceptedAt: "2026-01-05T00:00:00.000Z" });
    renderButton({ ensureAndPersist });

    fireEvent.click(screen.getByRole("button", { name: "Publish Listing" }));
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Accept & Publish" }));

    await waitFor(() => expect(publishListingMock).toHaveBeenCalledTimes(2));
    expect(publishListingMock).toHaveBeenNthCalledWith(2, "draft-7");
    // ensureAndPersist (ensure+persist the current form) runs once for the
    // whole click -- the consent retry re-attempts publish_listing only,
    // never re-persists the form a second time.
    expect(ensureAndPersist).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/item/PSL-XYZ"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("if the retry fails for a real completeness reason, closes the dialog and shows the actual publish error", async () => {
    publishListingMock
      .mockResolvedValueOnce({ ok: false, code: "SELLER_POLICIES_NOT_ACCEPTED" })
      .mockResolvedValueOnce({ ok: false, code: "IMAGE_REQUIRED" });
    acceptSellerPoliciesMock.mockResolvedValue({ ok: true, acceptedAt: "2026-01-05T00:00:00.000Z" });
    renderButton();

    fireEvent.click(screen.getByRole("button", { name: "Publish Listing" }));
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Accept & Publish" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(await screen.findByText(/please add at least one photo before publishing/i)).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });
});

describe("CreateListingPublishButton -- restriction-aware INTERACTION_BLOCKED error (A2.2.2b)", () => {
  it("shows the selling-access message and a 'View account status' link when publish_listing returns a seller_suspended restriction", async () => {
    publishListingMock.mockResolvedValue({
      ok: false,
      code: "INTERACTION_BLOCKED",
      restriction: { message: "Your selling access is currently suspended.", ctaLabel: "View account status", href: "/account#account-status" },
    });
    renderButton();

    fireEvent.click(screen.getByRole("button", { name: "Publish Listing" }));

    expect(await screen.findByText("Your selling access is currently suspended.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View account status" })).toHaveAttribute("href", "/account#account-status");
  });

  it("shows the account-suspended message and link when publish_listing returns an account_suspended restriction", async () => {
    publishListingMock.mockResolvedValue({
      ok: false,
      code: "INTERACTION_BLOCKED",
      restriction: { message: "Your account is currently suspended.", ctaLabel: "View account status", href: "/account#account-status" },
    });
    renderButton();

    fireEvent.click(screen.getByRole("button", { name: "Publish Listing" }));

    expect(await screen.findByText("Your account is currently suspended.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View account status" })).toHaveAttribute("href", "/account#account-status");
  });

  it("shows only the existing generic error, with no link, when publish_listing returns INTERACTION_BLOCKED with no restriction presentation", async () => {
    publishListingMock.mockResolvedValue({ ok: false, code: "INTERACTION_BLOCKED" });
    renderButton();

    fireEvent.click(screen.getByRole("button", { name: "Publish Listing" }));

    expect(await screen.findByText("You are not able to publish listings right now.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "View account status" })).not.toBeInTheDocument();
  });

  it("shows only the existing generic error, with no link, for a non-INTERACTION_BLOCKED failure", async () => {
    publishListingMock.mockResolvedValue({ ok: false, code: "PRICE_REQUIRED" });
    renderButton();

    fireEvent.click(screen.getByRole("button", { name: "Publish Listing" }));

    expect(await screen.findByText("Please enter a price before publishing.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "View account status" })).not.toBeInTheDocument();
  });

  it("shows only the existing generic fallback, with no link, when ensureAndPersist resolves to null (unrelated to any restriction)", async () => {
    const ensureAndPersist = vi.fn().mockResolvedValue(null);
    renderButton({ ensureAndPersist });

    fireEvent.click(screen.getByRole("button", { name: "Publish Listing" }));

    expect(await screen.findByText(/couldn't save your listing/i)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "View account status" })).not.toBeInTheDocument();
    expect(publishListingMock).not.toHaveBeenCalled();
  });
});
