import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@/lib/auth/use-is-authenticated", async (importOriginal) => importOriginal());

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ rpc: rpcMock }),
}));

import { AuthStatusProvider } from "@/components/auth/AuthStatusProvider";
import { CartProvider } from "@/components/cart/CartProvider";
import { AddToCartButton } from "@/components/cart/AddToCartButton";

beforeEach(() => {
  rpcMock.mockReset();
  window.localStorage.clear();
});

function renderButton({
  isAuthenticated,
  initialLines = [],
  availableQuantity = 5,
  listingId = "listing-1",
}: {
  isAuthenticated: boolean;
  initialLines?: { listingId: string; publicCode: string | null; quantity: number }[];
  availableQuantity?: number;
  listingId?: string;
}) {
  return render(
    <AuthStatusProvider isAuthenticated={isAuthenticated}>
      <CartProvider initialLines={initialLines} isAuthenticated={isAuthenticated}>
        <AddToCartButton listingId={listingId} publicCode="PLS-ABC" availableQuantity={availableQuantity} />
      </CartProvider>
    </AuthStatusProvider>,
  );
}

describe("AddToCartButton (guest)", () => {
  it("adds directly to the local cart with no RPC call and no auth gate", () => {
    renderButton({ isAuthenticated: false });
    fireEvent.click(screen.getByRole("button", { name: "Add to Cart" }));
    expect(rpcMock).not.toHaveBeenCalled();
    expect(screen.getByText("1 in cart")).toBeInTheDocument();
  });

  it("increments on a second click instead of resetting to 1", () => {
    renderButton({ isAuthenticated: false });
    const button = screen.getByRole("button", { name: "Add to Cart" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(screen.getByText("2 in cart")).toBeInTheDocument();
  });

  it("disables at the available stock limit", () => {
    renderButton({ isAuthenticated: false, availableQuantity: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Add to Cart" }));
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

  it("rolls back the optimistic quantity and shows an error when the RPC fails", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "stock unavailable" } });
    renderButton({ isAuthenticated: true });

    fireEvent.click(screen.getByRole("button", { name: "Add to Cart" }));
    expect(screen.getByText("1 in cart")).toBeInTheDocument();

    await waitFor(() => expect(screen.queryByText("1 in cart")).not.toBeInTheDocument());
    expect(screen.getByRole("alert")).toHaveTextContent(/couldn't add/i);
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
    resolveRpc!({ data: [{ cart_item_id: "ci1" }], error: null });
    await waitFor(() => expect(screen.getByText("1 in cart")).toBeInTheDocument());
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
