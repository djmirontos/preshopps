import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@/lib/auth/use-is-authenticated", async (importOriginal) => importOriginal());

const { rpcMock, pushMock } = vi.hoisted(() => ({ rpcMock: vi.fn(), pushMock: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ rpc: rpcMock }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

import { AuthStatusProvider } from "@/components/auth/AuthStatusProvider";
import { CartProvider } from "@/components/cart/CartProvider";
import { AddToCartButton } from "@/components/cart/AddToCartButton";

beforeEach(() => {
  rpcMock.mockReset();
  pushMock.mockReset();
  window.localStorage.clear();
});

function renderButton({
  isAuthenticated,
  initialLines = [],
  availableQuantity = 5,
  listingId = "listing-1",
  listingTitle,
  listingImageUrl,
}: {
  isAuthenticated: boolean;
  initialLines?: { listingId: string; publicCode: string | null; quantity: number }[];
  availableQuantity?: number;
  listingId?: string;
  listingTitle?: string;
  listingImageUrl?: string;
}) {
  return render(
    <AuthStatusProvider isAuthenticated={isAuthenticated}>
      <CartProvider initialLines={initialLines} isAuthenticated={isAuthenticated}>
        <AddToCartButton
          listingId={listingId}
          publicCode="PLS-ABC"
          availableQuantity={availableQuantity}
          listingTitle={listingTitle}
          listingImageUrl={listingImageUrl}
        />
      </CartProvider>
    </AuthStatusProvider>,
  );
}

describe("AddToCartButton (guest)", () => {
  it("adds directly to the local cart with no RPC call and no auth gate", () => {
    renderButton({ isAuthenticated: false });
    fireEvent.click(screen.getByRole("button", { name: "Add to Cart" }));
    expect(rpcMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("increments on a second click instead of resetting to 1 -- quantity semantics unchanged", () => {
    renderButton({ isAuthenticated: false });
    const button = screen.getByRole("button", { name: "Add to Cart" });
    fireEvent.click(button);
    fireEvent.click(screen.getByRole("button", { name: "Continue Shopping" }));
    fireEvent.click(button);
    expect(screen.getByRole("dialog")).toHaveTextContent("1 item added to your cart.");
  });

  it("disables at the available stock limit", () => {
    renderButton({ isAuthenticated: false, availableQuantity: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Add to Cart" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue Shopping" }));
    expect(screen.getByRole("button", { name: "Out of Stock" })).toBeDisabled();
  });
});

describe("AddToCartButton (authenticated)", () => {
  it("calls set_cart_item_quantity with quantity 1 on first add", async () => {
    rpcMock.mockResolvedValue({ data: [{ cart_item_id: "ci1" }], error: null });
    renderButton({ isAuthenticated: true, listingId: "listing-42" });

    fireEvent.click(screen.getByRole("button", { name: "Add to Cart" }));

    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith("set_cart_item_quantity", { p_listing_id: "listing-42", p_quantity: 1 }),
    );
  });

  it("increments the existing quantity when already in cart", async () => {
    rpcMock.mockResolvedValue({ data: [{ cart_item_id: "ci1" }], error: null });
    renderButton({
      isAuthenticated: true,
      listingId: "listing-1",
      initialLines: [{ listingId: "listing-1", publicCode: "PLS-ABC", quantity: 2 }],
    });

    fireEvent.click(screen.getByRole("button", { name: "Add to Cart" }));

    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith("set_cart_item_quantity", { p_listing_id: "listing-1", p_quantity: 3 }),
    );
  });

  it("never passes a client-supplied user id -- only listing id and quantity", async () => {
    rpcMock.mockResolvedValue({ data: [{ cart_item_id: "ci1" }], error: null });
    renderButton({ isAuthenticated: true, listingId: "listing-1" });

    fireEvent.click(screen.getByRole("button", { name: "Add to Cart" }));

    await waitFor(() => expect(rpcMock).toHaveBeenCalled());
    const [, args] = rpcMock.mock.calls[0];
    expect(Object.keys(args).sort()).toEqual(["p_listing_id", "p_quantity"]);
  });

  it("rolls back the optimistic quantity and shows an error when the RPC fails -- and never opens the success modal", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "stock unavailable" } });
    renderButton({ isAuthenticated: true });

    fireEvent.click(screen.getByRole("button", { name: "Add to Cart" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/couldn't add/i));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("ignores a second click while a mutation is in flight (no duplicate RPC call)", async () => {
    let resolveRpc: (value: { data: unknown; error: null }) => void;
    rpcMock.mockReturnValue(
      new Promise((resolve) => {
        resolveRpc = resolve;
      }),
    );
    renderButton({ isAuthenticated: true });

    const button = screen.getByRole("button", { name: "Add to Cart" });
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);

    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    resolveRpc!({ data: [{ cart_item_id: "ci1" }], error: null });
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
  });

  it("shows Out of Stock, disabled, when currentQuantity already meets availableQuantity", () => {
    renderButton({
      isAuthenticated: true,
      availableQuantity: 2,
      initialLines: [{ listingId: "listing-1", publicCode: "PLS-ABC", quantity: 2 }],
    });
    expect(screen.getByRole("button", { name: "Out of Stock" })).toBeDisabled();
  });
});

describe("AddToCartButton -- success modal (1: opens; 2: says item added; 8: not on failure)", () => {
  it("1/2. a successful guest add opens the success modal saying the item was added to cart", () => {
    renderButton({ isAuthenticated: false });
    fireEvent.click(screen.getByRole("button", { name: "Add to Cart" }));

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Added to cart");
    expect(dialog).toHaveTextContent("1 item added to your cart.");
  });

  it("1/2. a successful authenticated add opens the success modal only once the RPC resolves ok", async () => {
    rpcMock.mockResolvedValue({ data: [{ cart_item_id: "ci1" }], error: null });
    renderButton({ isAuthenticated: true });

    fireEvent.click(screen.getByRole("button", { name: "Add to Cart" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await waitFor(() => expect(screen.getByRole("dialog")).toHaveTextContent("Added to cart"));
  });

  it("shows the listing thumbnail and title when both are supplied", () => {
    renderButton({ isAuthenticated: false, listingTitle: "Nike Air Max 270", listingImageUrl: "https://example.com/a.jpg" });
    fireEvent.click(screen.getByRole("button", { name: "Add to Cart" }));

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Nike Air Max 270");
    // The thumbnail is decorative (alt="", matching ListingImagesPicker's
    // own established convention) so it carries no accessible "img" role --
    // queried directly rather than via role.
    expect(dialog.querySelector("img")).not.toBeNull();
  });

  it("omits the thumbnail row entirely when title/image are not supplied", () => {
    renderButton({ isAuthenticated: false });
    fireEvent.click(screen.getByRole("button", { name: "Add to Cart" }));

    const dialog = screen.getByRole("dialog");
    expect(dialog.querySelector("img")).toBeNull();
  });

  it("8. a failed authenticated add never opens the success modal", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    renderButton({ isAuthenticated: true });

    fireEvent.click(screen.getByRole("button", { name: "Add to Cart" }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("AddToCartButton -- success modal actions (3: View Cart; 4: Continue Shopping; 5/6/7: dismiss)", () => {
  it("3. View Cart navigates to /cart", () => {
    renderButton({ isAuthenticated: false });
    fireEvent.click(screen.getByRole("button", { name: "Add to Cart" }));

    fireEvent.click(screen.getByRole("button", { name: "View Cart" }));

    expect(pushMock).toHaveBeenCalledWith("/cart");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("4. Continue Shopping closes the modal, stays on the page, and never navigates", () => {
    renderButton({ isAuthenticated: false });
    fireEvent.click(screen.getByRole("button", { name: "Add to Cart" }));

    fireEvent.click(screen.getByRole("button", { name: "Continue Shopping" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("5. the X button closes the modal without navigating", () => {
    renderButton({ isAuthenticated: false });
    fireEvent.click(screen.getByRole("button", { name: "Add to Cart" }));

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("6. Escape closes the modal without navigating", () => {
    renderButton({ isAuthenticated: false });
    fireEvent.click(screen.getByRole("button", { name: "Add to Cart" }));

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("7. clicking the backdrop closes the modal without navigating", () => {
    const { container } = render(
      <AuthStatusProvider isAuthenticated={false}>
        <CartProvider initialLines={[]} isAuthenticated={false}>
          <AddToCartButton listingId="listing-1" publicCode="PLS-ABC" availableQuantity={5} />
        </CartProvider>
      </AuthStatusProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Add to Cart" }));

    const backdrop = container.querySelector('[aria-hidden="true"].bg-ink\\/40');
    expect(backdrop).not.toBeNull();
    fireEvent.click(backdrop as Element);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });
});

describe("AddToCartButton -- inline cart-count label removed (13)", () => {
  it("never renders 'N in cart' text anywhere, even after a successful add", () => {
    renderButton({ isAuthenticated: false });
    fireEvent.click(screen.getByRole("button", { name: "Add to Cart" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue Shopping" }));

    expect(screen.queryByText(/\d+ in cart/i)).not.toBeInTheDocument();
  });
});

/** Dispatches by RPC name, throwing on any unrecognized name so a stray/
 * unexpected RPC call fails the test loudly rather than silently. */
function mockBlocked(restrictions: { restriction_type: string }[]) {
  rpcMock.mockImplementation((fn: string) => {
    if (fn === "set_cart_item_quantity") {
      return Promise.resolve({ data: null, error: { message: "blocked", details: "INTERACTION_BLOCKED" } });
    }
    if (fn === "get_my_active_restrictions") {
      return Promise.resolve({
        data: restrictions.map((r, i) => ({ restriction_id: `r${i}`, restriction_type: r.restriction_type, reason: "x", created_at: "2026-01-01T00:00:00.000Z" })),
        error: null,
      });
    }
    throw new Error(`unexpected rpc ${fn}`);
  });
}

describe("AddToCartButton -- restriction-aware INTERACTION_BLOCKED presentation (A2.2.2h)", () => {
  it("attaches the buying-access detail and 'View account status' link when buyer_restricted is confirmed", async () => {
    mockBlocked([{ restriction_type: "buyer_restricted" }]);
    renderButton({ isAuthenticated: true });

    fireEvent.click(screen.getByRole("button", { name: "Add to Cart" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't add/i);
    expect(screen.getByText("Your buying access is currently restricted.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View account status" })).toHaveAttribute("href", "/account#account-status");
  });

  it("attaches the account-suspended detail and link when account_suspended is confirmed", async () => {
    mockBlocked([{ restriction_type: "account_suspended" }]);
    renderButton({ isAuthenticated: true });

    fireEvent.click(screen.getByRole("button", { name: "Add to Cart" }));

    expect(await screen.findByText("Your account is currently suspended.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View account status" })).toHaveAttribute("href", "/account#account-status");
  });

  it("account_suspended wins precedence when both account_suspended and buyer_restricted are active", async () => {
    mockBlocked([{ restriction_type: "buyer_restricted" }, { restriction_type: "account_suspended" }]);
    renderButton({ isAuthenticated: true });

    fireEvent.click(screen.getByRole("button", { name: "Add to Cart" }));

    expect(await screen.findByText("Your account is currently suspended.")).toBeInTheDocument();
    expect(screen.queryByText("Your buying access is currently restricted.")).not.toBeInTheDocument();
  });

  it("ignores a caller's own seller_suspended restriction -- it is returned by the lookup but not in this action's relevant array, so selection excludes it and the generic message alone is shown", async () => {
    mockBlocked([{ restriction_type: "seller_suspended" }]);
    renderButton({ isAuthenticated: true });

    fireEvent.click(screen.getByRole("button", { name: "Add to Cart" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't add/i);
    expect(screen.queryByRole("link", { name: "View account status" })).not.toBeInTheDocument();
  });

  it("shows only the generic message when the restriction lookup returns empty (e.g. a deleted-account or mutual-block collision)", async () => {
    mockBlocked([]);
    renderButton({ isAuthenticated: true });

    fireEvent.click(screen.getByRole("button", { name: "Add to Cart" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't add/i);
    expect(screen.queryByRole("link", { name: "View account status" })).not.toBeInTheDocument();
  });

  it("shows only the generic message, without throwing, when the restriction lookup itself fails", async () => {
    rpcMock.mockImplementation((fn: string) => {
      if (fn === "set_cart_item_quantity") {
        return Promise.resolve({ data: null, error: { message: "blocked", details: "INTERACTION_BLOCKED" } });
      }
      if (fn === "get_my_active_restrictions") {
        return Promise.resolve({ data: null, error: { message: "lookup failed" } });
      }
      throw new Error(`unexpected rpc ${fn}`);
    });
    renderButton({ isAuthenticated: true });

    fireEvent.click(screen.getByRole("button", { name: "Add to Cart" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't add/i);
    expect(screen.queryByRole("link", { name: "View account status" })).not.toBeInTheDocument();
  });

  it("shows only the generic message, without throwing, when the restriction lookup rejects", async () => {
    rpcMock.mockImplementation((fn: string) => {
      if (fn === "set_cart_item_quantity") {
        return Promise.resolve({ data: null, error: { message: "blocked", details: "INTERACTION_BLOCKED" } });
      }
      if (fn === "get_my_active_restrictions") {
        return Promise.reject(new Error("network down"));
      }
      throw new Error(`unexpected rpc ${fn}`);
    });
    renderButton({ isAuthenticated: true });

    fireEvent.click(screen.getByRole("button", { name: "Add to Cart" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't add/i);
    expect(screen.queryByRole("link", { name: "View account status" })).not.toBeInTheDocument();
  });

  it("never calls get_my_active_restrictions for a non-INTERACTION_BLOCKED failure (LISTING_NOT_CARTABLE)", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "not cartable", details: "LISTING_NOT_CARTABLE" } });
    renderButton({ isAuthenticated: true });

    fireEvent.click(screen.getByRole("button", { name: "Add to Cart" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't add/i);
    expect(rpcMock).not.toHaveBeenCalledWith("get_my_active_restrictions");
    expect(screen.queryByRole("link", { name: "View account status" })).not.toBeInTheDocument();
  });

  it("never calls get_my_active_restrictions for CANNOT_BUY_OWN_LISTING -- a listing/seller-side code, never the caller's own restriction", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "own listing", details: "CANNOT_BUY_OWN_LISTING" } });
    renderButton({ isAuthenticated: true });

    fireEvent.click(screen.getByRole("button", { name: "Add to Cart" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't add/i);
    expect(rpcMock).not.toHaveBeenCalledWith("get_my_active_restrictions");
    expect(screen.queryByRole("link", { name: "View account status" })).not.toBeInTheDocument();
  });

  it("never calls get_my_active_restrictions for QUANTITY_UNAVAILABLE", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "stock", details: "QUANTITY_UNAVAILABLE" } });
    renderButton({ isAuthenticated: true });

    fireEvent.click(screen.getByRole("button", { name: "Add to Cart" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't add/i);
    expect(rpcMock).not.toHaveBeenCalledWith("get_my_active_restrictions");
  });

  it("never calls get_my_active_restrictions for QUANTITY_INVALID", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "invalid", details: "QUANTITY_INVALID" } });
    renderButton({ isAuthenticated: true });

    fireEvent.click(screen.getByRole("button", { name: "Add to Cart" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't add/i);
    expect(rpcMock).not.toHaveBeenCalledWith("get_my_active_restrictions");
  });

  it("never calls get_my_active_restrictions on a successful add", async () => {
    rpcMock.mockResolvedValue({ data: [{ cart_item_id: "ci1" }], error: null });
    renderButton({ isAuthenticated: true });

    fireEvent.click(screen.getByRole("button", { name: "Add to Cart" }));

    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
    expect(rpcMock).not.toHaveBeenCalledWith("get_my_active_restrictions");
  });

  it("rolls back the optimistic quantity even when the failure carries a confirmed restriction presentation", async () => {
    mockBlocked([{ restriction_type: "buyer_restricted" }]);
    renderButton({
      isAuthenticated: true,
      listingId: "listing-1",
      initialLines: [{ listingId: "listing-1", publicCode: "PLS-ABC", quantity: 2 }],
    });

    fireEvent.click(screen.getByRole("button", { name: "Add to Cart" }));
    expect(await screen.findByText("Your buying access is currently restricted.")).toBeInTheDocument();

    // A second click after rollback proves the shared quantity map is back
    // to 2 (desiredQuantity would be 3 again, not 4).
    mockBlocked([]);
    fireEvent.click(screen.getByRole("button", { name: "Add to Cart" }));
    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith("set_cart_item_quantity", { p_listing_id: "listing-1", p_quantity: 3 }),
    );
  });

  it("retrying after a restriction failure replaces the stale presentation with the new attempt's result", async () => {
    mockBlocked([{ restriction_type: "buyer_restricted" }]);
    renderButton({ isAuthenticated: true });

    fireEvent.click(screen.getByRole("button", { name: "Add to Cart" }));
    expect(await screen.findByText("Your buying access is currently restricted.")).toBeInTheDocument();

    rpcMock.mockResolvedValue({ data: null, error: { message: "not cartable", details: "LISTING_NOT_CARTABLE" } });
    fireEvent.click(screen.getByRole("button", { name: "Add to Cart" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/couldn't add/i));
    expect(screen.queryByText("Your buying access is currently restricted.")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "View account status" })).not.toBeInTheDocument();
  });

  it("a successful retry after a restriction failure clears the detail/link and still opens the success modal", async () => {
    mockBlocked([{ restriction_type: "buyer_restricted" }]);
    renderButton({ isAuthenticated: true });

    fireEvent.click(screen.getByRole("button", { name: "Add to Cart" }));
    expect(await screen.findByText("Your buying access is currently restricted.")).toBeInTheDocument();

    rpcMock.mockResolvedValue({ data: [{ cart_item_id: "ci1" }], error: null });
    fireEvent.click(screen.getByRole("button", { name: "Add to Cart" }));

    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
    expect(screen.queryByText("Your buying access is currently restricted.")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "View account status" })).not.toBeInTheDocument();
  });
});
