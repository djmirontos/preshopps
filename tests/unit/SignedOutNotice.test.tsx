import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

const { replaceMock, notifySuccessMock, useIsAuthenticatedMock } = vi.hoisted(() => ({
  replaceMock: vi.fn(),
  notifySuccessMock: vi.fn(),
  useIsAuthenticatedMock: vi.fn(),
}));

// A real URLSearchParams instance (not a bare { get } stub) so the
// component's own `new URLSearchParams(searchParams)` copy-and-delete
// logic is exercised exactly as it runs in the app, not reimplemented
// here as a second, possibly-diverging mock.
function paramsFrom(query: string) {
  return new URLSearchParams(query);
}

let currentSearchParams = paramsFrom("");

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock }),
  usePathname: () => "/",
  useSearchParams: () => currentSearchParams,
}));

vi.mock("@/lib/notifications/toast", () => ({
  notifySuccess: notifySuccessMock,
}));

vi.mock("@/lib/auth/use-is-authenticated", () => ({
  useIsAuthenticated: useIsAuthenticatedMock,
}));

import { SignedOutNotice } from "@/components/auth/SignedOutNotice";

beforeEach(() => {
  vi.clearAllMocks();
  currentSearchParams = paramsFrom("");
  useIsAuthenticatedMock.mockReturnValue(false);
});

describe("SignedOutNotice", () => {
  it("shows the confirmation exactly once when the signedOut marker is present and the visitor is actually signed out", () => {
    currentSearchParams = paramsFrom("signedOut=1");

    render(<SignedOutNotice />);

    expect(notifySuccessMock).toHaveBeenCalledWith("You've signed out");
    expect(notifySuccessMock).toHaveBeenCalledTimes(1);
  });

  it("strips the marker from the URL immediately after showing the confirmation", () => {
    currentSearchParams = paramsFrom("signedOut=1");

    render(<SignedOutNotice />);

    expect(replaceMock).toHaveBeenCalledWith("/", { scroll: false });
  });

  it("shows no confirmation and never touches the URL when the marker is absent -- the ordinary homepage load", () => {
    render(<SignedOutNotice />);

    expect(notifySuccessMock).not.toHaveBeenCalled();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("does not repeat the confirmation on a re-render with the same marker still present (simulates React re-invoking the effect before the URL strip takes visible effect)", () => {
    currentSearchParams = paramsFrom("signedOut=1");

    const { rerender } = render(<SignedOutNotice />);
    rerender(<SignedOutNotice />);

    expect(notifySuccessMock).toHaveBeenCalledTimes(1);
  });

  it("shows no confirmation on a fresh mount once the marker is gone -- proves a manual refresh after the strip never repeats it", () => {
    currentSearchParams = paramsFrom("signedOut=1");
    const { unmount } = render(<SignedOutNotice />);
    expect(notifySuccessMock).toHaveBeenCalledTimes(1);
    unmount();

    vi.clearAllMocks();
    currentSearchParams = paramsFrom("");
    render(<SignedOutNotice />);

    expect(notifySuccessMock).not.toHaveBeenCalled();
  });

  it("preserves other query params already on the homepage URL when stripping the marker -- e.g. a shared/ref link", () => {
    currentSearchParams = paramsFrom("signedOut=1&ref=email");

    render(<SignedOutNotice />);

    expect(replaceMock).toHaveBeenCalledWith("/?ref=email", { scroll: false });
  });

  it("preserves multiple other query params, in their original order, when stripping the marker", () => {
    currentSearchParams = paramsFrom("utm_source=newsletter&signedOut=1&utm_campaign=fall");

    render(<SignedOutNotice />);

    expect(replaceMock).toHaveBeenCalledWith("/?utm_source=newsletter&utm_campaign=fall", { scroll: false });
  });

  it("shows no confirmation when the marker is present but the visitor is still authenticated -- a stale bookmark or shared link, not a real sign-out", () => {
    useIsAuthenticatedMock.mockReturnValue(true);
    currentSearchParams = paramsFrom("signedOut=1");

    render(<SignedOutNotice />);

    expect(notifySuccessMock).not.toHaveBeenCalled();
  });

  it("still strips the marker even when still authenticated -- the stale marker never lingers for a later refresh to re-evaluate", () => {
    useIsAuthenticatedMock.mockReturnValue(true);
    currentSearchParams = paramsFrom("signedOut=1");

    render(<SignedOutNotice />);

    expect(replaceMock).toHaveBeenCalledWith("/", { scroll: false });
  });
});
