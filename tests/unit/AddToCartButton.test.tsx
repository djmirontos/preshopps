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
