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

import { PublishListingButton } from "@/components/seller/PublishListingButton";

beforeEach(() => {
  vi.clearAllMocks();
});

function renderButton(overrides: Partial<React.ComponentProps<typeof PublishListingButton>> = {}) {
  return render(<PublishListingButton listingId="listing-1" status="draft" isDirty={false} {...overrides} />);
}

describe("PublishListingButton -- visibility", () => {
  it("renders Publish for a Draft listing", () => {
    renderButton({ status: "draft" });
    expect(screen.getByRole("button", { name: "Publish Listing" })).toBeInTheDocument();
  });

  it.each(["available", "reserved", "paused", "sold", "archived"] as const)("renders nothing for a %s listing", (status) => {
    const { container } = renderButton({ status });
    expect(container).toBeEmptyDOMElement();
  });

  it("never pre-reads seller-policy acceptance state on mount", () => {
    renderButton();
    expect(acceptSellerPoliciesMock).not.toHaveBeenCalled();
    expect(publishListingMock).not.toHaveBeenCalled();
  });
});

describe("PublishListingButton -- unsaved-changes gating", () => {
  it("disables Publish and shows a clear message while the form has unsaved changes", () => {
    renderButton({ isDirty: true });
    expect(screen.getByRole("button", { name: "Publish Listing" })).toBeDisabled();
    expect(screen.getByText(/save your draft changes before publishing/i)).toBeInTheDocument();
  });

  it("never calls publish_listing when clicked while dirty", () => {
    renderButton({ isDirty: true });
    fireEvent.click(screen.getByRole("button", { name: "Publish Listing" }));
    expect(publishListingMock).not.toHaveBeenCalled();
  });

  it("enables Publish once there are no unsaved changes", () => {
    renderButton({ isDirty: false });
    expect(screen.getByRole("button", { name: "Publish Listing" })).not.toBeDisabled();
  });
});

describe("PublishListingButton -- publish success", () => {
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

describe("PublishListingButton -- ordinary validation failures", () => {
  it("shows a friendly message and stays on the page for a plain completeness error", async () => {
    publishListingMock.mockResolvedValue({ ok: false, code: "PRICE_REQUIRED" });
    renderButton();

    fireEvent.click(screen.getByRole("button", { name: "Publish Listing" }));

    expect(await screen.findByText("Please enter a price before publishing.")).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("maps the Pre-loved + reference-image error to its own friendly, actionable message", async () => {
    publishListingMock.mockResolvedValue({ ok: false, code: "REFERENCE_IMAGES_NOT_ALLOWED_FOR_PRELOVED" });
    renderButton();

    fireEvent.click(screen.getByRole("button", { name: "Publish Listing" }));

    expect(await screen.findByText(/pre-loved listings may only include actual-item photos/i)).toBeInTheDocument();
  });

  it("maps the Brand New + zero-actual-image error to its own friendly, actionable message", async () => {
    publishListingMock.mockResolvedValue({ ok: false, code: "BRAND_NEW_REQUIRES_ACTUAL_IMAGE" });
    renderButton();

    fireEvent.click(screen.getByRole("button", { name: "Publish Listing" }));

    expect(await screen.findByText(/brand new listings need at least one actual-item photo/i)).toBeInTheDocument();
  });

  it("never mutates listing state on an ordinary validation failure -- publish_listing is called exactly once", async () => {
    publishListingMock.mockResolvedValue({ ok: false, code: "IMAGE_REQUIRED" });
    renderButton();

    fireEvent.click(screen.getByRole("button", { name: "Publish Listing" }));
    await screen.findByText(/please add at least one photo before publishing/i);

    expect(publishListingMock).toHaveBeenCalledTimes(1);
  });
});

describe("PublishListingButton -- SELLER_POLICIES_NOT_ACCEPTED consent flow", () => {
  it("opens the consent dialog reactively when publish_listing returns SELLER_POLICIES_NOT_ACCEPTED", async () => {
    publishListingMock.mockResolvedValue({ ok: false, code: "SELLER_POLICIES_NOT_ACCEPTED" });
    renderButton();

    fireEvent.click(screen.getByRole("button", { name: "Publish Listing" }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent(/marketplace rules/i);
    expect(dialog).toHaveTextContent(/prohibited items policy/i);
  });

  it("names both policies in plain text, with no signup Terms of Use / Privacy Policy content and no version selector", async () => {
    publishListingMock.mockResolvedValue({ ok: false, code: "SELLER_POLICIES_NOT_ACCEPTED" });
    renderButton();
    fireEvent.click(screen.getByRole("button", { name: "Publish Listing" }));
    await screen.findByRole("dialog");

    expect(screen.queryByText(/terms of use/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/privacy policy/i)).not.toBeInTheDocument();
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("requires the checkbox before Accept & Publish is enabled -- no pre-checked box", async () => {
    publishListingMock.mockResolvedValue({ ok: false, code: "SELLER_POLICIES_NOT_ACCEPTED" });
    renderButton();
    fireEvent.click(screen.getByRole("button", { name: "Publish Listing" }));
    await screen.findByRole("dialog");

    const checkbox = screen.getByRole("checkbox");
    expect(checkbox).not.toBeChecked();
    const acceptButton = screen.getByRole("button", { name: "Accept & Publish" });
    expect(acceptButton).toBeDisabled();

    fireEvent.click(checkbox);
    expect(acceptButton).not.toBeDisabled();
  });

  it("Cancel closes the dialog without calling accept_seller_policies", async () => {
    publishListingMock.mockResolvedValue({ ok: false, code: "SELLER_POLICIES_NOT_ACCEPTED" });
    renderButton();
    fireEvent.click(screen.getByRole("button", { name: "Publish Listing" }));
    await screen.findByRole("dialog");

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(acceptSellerPoliciesMock).not.toHaveBeenCalled();
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

  it("automatically retries publish_listing after a successful acceptance, and redirects on retry success", async () => {
    publishListingMock
      .mockResolvedValueOnce({ ok: false, code: "SELLER_POLICIES_NOT_ACCEPTED" })
      .mockResolvedValueOnce({ ok: true, listingId: "listing-1", publicCode: "PSL-XYZ", slug: "x", status: "available", publishedAt: "now" });
    acceptSellerPoliciesMock.mockResolvedValue({ ok: true, acceptedAt: "2026-01-05T00:00:00.000Z" });
    renderButton();

    fireEvent.click(screen.getByRole("button", { name: "Publish Listing" }));
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Accept & Publish" }));

    await waitFor(() => expect(publishListingMock).toHaveBeenCalledTimes(2));
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

  it("shows an inline error inside the dialog and keeps it open if accept_seller_policies itself fails", async () => {
    publishListingMock.mockResolvedValue({ ok: false, code: "SELLER_POLICIES_NOT_ACCEPTED" });
    acceptSellerPoliciesMock.mockResolvedValue({ ok: false, code: "PROFILE_NOT_FOUND" });
    renderButton();

    fireEvent.click(screen.getByRole("button", { name: "Publish Listing" }));
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Accept & Publish" }));

    expect(await screen.findByText(/couldn't find your profile/i)).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(publishListingMock).toHaveBeenCalledTimes(1);
  });
});
