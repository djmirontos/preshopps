import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// Overrides the guest-default global mock from tests/setup/vitest.setup.ts
// with the real hook -- it now just reads AuthStatusProvider's context, so
// these tests can exercise both cases by wrapping in a real provider
// instead of mocking the hook itself.
vi.mock("@/lib/auth/use-is-authenticated", async (importOriginal) => importOriginal());

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ rpc: rpcMock }),
}));

import { AuthStatusProvider } from "@/components/auth/AuthStatusProvider";
import { FavoritesProvider } from "@/components/favorites/FavoritesProvider";
import { FavoriteButton } from "@/components/marketplace/FavoriteButton";

beforeEach(() => {
  rpcMock.mockReset();
});

function renderButton({
  isAuthenticated,
  favoritedIds = [],
  listingId = "listing-1",
}: {
  isAuthenticated: boolean;
  favoritedIds?: string[];
  listingId?: string;
}) {
  return render(
    <AuthStatusProvider isAuthenticated={isAuthenticated}>
      <FavoritesProvider favoritedIds={favoritedIds}>
        <FavoriteButton listingId={listingId} label="Test Item" next="/item/PSO-ABC" />
      </FavoritesProvider>
    </AuthStatusProvider>,
  );
}

describe("FavoriteButton", () => {
  it("guest click opens the auth gate instead of mutating anything", () => {
    renderButton({ isAuthenticated: false });

    const button = screen.getByRole("button", { name: "Add Test Item to favorites" });
    fireEvent.click(button);

    expect(screen.getByRole("dialog", { name: "Sign in to save items" })).toBeInTheDocument();
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("guest gate carries the given next path", () => {
    renderButton({ isAuthenticated: false });
    fireEvent.click(screen.getByRole("button", { name: "Add Test Item to favorites" }));

    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      `/sign-in?next=${encodeURIComponent("/item/PSO-ABC")}`,
    );
  });

  it("authenticated click on an unfavorited item calls add_favorite and updates optimistically", async () => {
    rpcMock.mockResolvedValue({ data: [{ favorite_id: "f1", created_at: "2026-01-01" }], error: null });
    renderButton({ isAuthenticated: true, favoritedIds: [] });

    const button = screen.getByRole("button", { name: "Add Test Item to favorites" });
    fireEvent.click(button);

    // Optimistic: reflects the new state immediately, before the RPC resolves.
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith("add_favorite", { p_listing_id: "listing-1" }));
    expect(screen.getByRole("button", { name: "Remove Test Item from favorites" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("authenticated click on an already-favorited item calls remove_favorite", async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });
    renderButton({ isAuthenticated: true, favoritedIds: ["listing-1"] });

    const button = screen.getByRole("button", { name: "Remove Test Item from favorites" });
    expect(button).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-pressed", "false");

    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith("remove_favorite", { p_listing_id: "listing-1" }));
  });

  it("initializes favorited state from FavoritesProvider without any per-button fetch", () => {
    renderButton({ isAuthenticated: true, favoritedIds: ["listing-1"] });
    expect(screen.getByRole("button", { name: "Remove Test Item from favorites" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rolls back the optimistic state when the mutation fails", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "listing cannot be favorited" } });
    renderButton({ isAuthenticated: true, favoritedIds: [] });

    const button = screen.getByRole("button", { name: "Add Test Item to favorites" });
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-pressed", "true");

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Add Test Item to favorites" })).toHaveAttribute(
        "aria-pressed",
        "false",
      ),
    );
  });

  it("ignores a second click while a mutation is already in flight (no duplicate RPC call)", async () => {
    let resolveRpc: (value: { data: null; error: null }) => void;
    rpcMock.mockReturnValue(
      new Promise((resolve) => {
        resolveRpc = resolve;
      }),
    );
    renderButton({ isAuthenticated: true, favoritedIds: [] });

    const button = screen.getByRole("button", { name: "Add Test Item to favorites" });
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);

    expect(rpcMock).toHaveBeenCalledTimes(1);

    resolveRpc!({ data: null, error: null });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Remove Test Item from favorites" })).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );
  });

  it("never passes a client-supplied user id -- only the listing id -- to the mutation RPC", async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });
    renderButton({ isAuthenticated: true, favoritedIds: [], listingId: "listing-42" });

    fireEvent.click(screen.getByRole("button", { name: "Add Test Item to favorites" }));

    await waitFor(() => expect(rpcMock).toHaveBeenCalled());
    const [, args] = rpcMock.mock.calls[0];
    expect(Object.keys(args)).toEqual(["p_listing_id"]);
    expect(args.p_listing_id).toBe("listing-42");
  });

  it("rollback on mutation failure restores the shared Set, not just this button's own display", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "listing cannot be favorited" } });

    render(
      <AuthStatusProvider isAuthenticated={true}>
        <FavoritesProvider favoritedIds={[]}>
          <FavoriteButton listingId="listing-1" label="Test Item" next="/item/PSO-ABC" />
          <FavoriteButton listingId="listing-1" label="Test Item" next="/item/PSO-ABC" />
        </FavoritesProvider>
      </AuthStatusProvider>,
    );

    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(2);
    fireEvent.click(buttons[0]);

    // Optimistic add flips BOTH buttons via the shared Set, not just the
    // one clicked.
    expect(buttons[0]).toHaveAttribute("aria-pressed", "true");
    expect(buttons[1]).toHaveAttribute("aria-pressed", "true");

    // On RPC failure, the rollback must undo the shared Set -- so both
    // buttons, not just the one clicked, revert together.
    await waitFor(() => expect(buttons[0]).toHaveAttribute("aria-pressed", "false"));
    expect(buttons[1]).toHaveAttribute("aria-pressed", "false");
  });

  it("keeps two FavoriteButtons for the same listing synchronized on a successful mutation", async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });

    render(
      <AuthStatusProvider isAuthenticated={true}>
        <FavoritesProvider favoritedIds={[]}>
          <FavoriteButton listingId="listing-1" label="Test Item" next="/item/PSO-ABC" />
          <FavoriteButton listingId="listing-1" label="Test Item" next="/item/PSO-ABC" />
        </FavoritesProvider>
      </AuthStatusProvider>,
    );

    const buttons = screen.getAllByRole("button", { name: "Add Test Item to favorites" });
    expect(buttons).toHaveLength(2);

    fireEvent.click(buttons[0]);

    // Clicking the first button updates the shared Set, so the second
    // (never clicked) button reflects the change immediately too.
    expect(screen.getAllByRole("button", { name: "Remove Test Item from favorites" })).toHaveLength(2);

    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith("add_favorite", { p_listing_id: "listing-1" }));
    expect(screen.getAllByRole("button", { name: "Remove Test Item from favorites" })).toHaveLength(2);
  });
});
