import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ rpc: rpcMock }),
}));

import { CartProvider, useCart } from "@/components/cart/CartProvider";
import { writeGuestCart, readGuestCart } from "@/lib/cart/guest-cart-storage";

function Probe({ listingId }: { listingId: string }) {
  const { getQuantity, itemCount } = useCart();
  return (
    <div>
      <span data-testid="qty">{getQuantity(listingId)}</span>
      <span data-testid="count">{itemCount}</span>
    </div>
  );
}

function Controls({ listingId, publicCode = "PLS-1" }: { listingId: string; publicCode?: string }) {
  const { setQuantity, removeItem } = useCart();
  return (
    <div>
      <button onClick={() => setQuantity(listingId, publicCode, 3)}>set-3</button>
      <button onClick={() => setQuantity(listingId, publicCode, 0)}>set-0</button>
      <button onClick={() => removeItem(listingId)}>remove</button>
    </div>
  );
}

beforeEach(() => {
  window.localStorage.clear();
  rpcMock.mockReset();
});

describe("CartProvider", () => {
  it("defaults to quantity 0 and itemCount 0 with no provider", () => {
    render(<Probe listingId="l1" />);
    expect(screen.getByTestId("qty")).toHaveTextContent("0");
    expect(screen.getByTestId("count")).toHaveTextContent("0");
  });

  it("exposes initialLines quantities to consumers (authenticated seed)", () => {
    render(
      <CartProvider initialLines={[{ listingId: "l1", publicCode: "PLS-1", quantity: 2 }]} isAuthenticated>
        <Probe listingId="l1" />
      </CartProvider>,
    );
    expect(screen.getByTestId("qty")).toHaveTextContent("2");
  });

  it("sums quantities across lines for itemCount", () => {
    render(
      <CartProvider
        initialLines={[
          { listingId: "l1", publicCode: "PLS-1", quantity: 2 },
          { listingId: "l2", publicCode: "PLS-2", quantity: 3 },
        ]}
        isAuthenticated
      >
        <Probe listingId="l1" />
      </CartProvider>,
    );
    expect(screen.getByTestId("count")).toHaveTextContent("5");
  });

  it("setQuantity updates the shared state for every consumer", () => {
    render(
      <CartProvider initialLines={[]} isAuthenticated>
        <Probe listingId="l1" />
        <Controls listingId="l1" />
      </CartProvider>,
    );
    fireEvent.click(screen.getByText("set-3"));
    expect(screen.getByTestId("qty")).toHaveTextContent("3");
    expect(screen.getByTestId("count")).toHaveTextContent("3");
  });

  it("setQuantity to 0 removes the line", () => {
    render(
      <CartProvider initialLines={[{ listingId: "l1", publicCode: "PLS-1", quantity: 2 }]} isAuthenticated>
        <Probe listingId="l1" />
        <Controls listingId="l1" />
      </CartProvider>,
    );
    fireEvent.click(screen.getByText("set-0"));
    expect(screen.getByTestId("qty")).toHaveTextContent("0");
  });

  it("removeItem removes the line", () => {
    render(
      <CartProvider initialLines={[{ listingId: "l1", publicCode: "PLS-1", quantity: 2 }]} isAuthenticated>
        <Probe listingId="l1" />
        <Controls listingId="l1" />
      </CartProvider>,
    );
    fireEvent.click(screen.getByText("remove"));
    expect(screen.getByTestId("qty")).toHaveTextContent("0");
  });

  it("persists guest mutations to localStorage", () => {
    render(
      <CartProvider initialLines={[]} isAuthenticated={false}>
        <Controls listingId="l1" />
      </CartProvider>,
    );
    fireEvent.click(screen.getByText("set-3"));
    expect(readGuestCart()).toEqual([{ listingId: "l1", publicCode: "PLS-1", quantity: 3 }]);
  });

  it("does not touch localStorage for authenticated mutations", () => {
    render(
      <CartProvider initialLines={[]} isAuthenticated>
        <Controls listingId="l1" />
      </CartProvider>,
    );
    fireEvent.click(screen.getByText("set-3"));
    expect(readGuestCart()).toEqual([]);
  });

  it("hydrates guest state from localStorage on mount", async () => {
    writeGuestCart([{ listingId: "l1", publicCode: "PLS-1", quantity: 4 }]);
    render(
      <CartProvider initialLines={[]} isAuthenticated={false}>
        <Probe listingId="l1" />
      </CartProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("qty")).toHaveTextContent("4"));
  });

  it("keeps two independent consumers of the same listing synchronized after a mutation", () => {
    render(
      <CartProvider initialLines={[]} isAuthenticated>
        <Probe listingId="l1" />
        <Probe listingId="l1" />
        <Controls listingId="l1" />
      </CartProvider>,
    );
    fireEvent.click(screen.getByText("set-3"));
    const quantities = screen.getAllByTestId("qty").map((el) => el.textContent);
    expect(quantities).toEqual(["3", "3"]);
  });
});

describe("CartProvider merge-on-auth fallback", () => {
  it("authenticated mount with guest items present attempts merge_guest_cart", async () => {
    writeGuestCart([{ listingId: "l1", publicCode: "PLS-1", quantity: 2 }]);
    rpcMock.mockResolvedValue({ data: [], error: null });

    render(
      <CartProvider initialLines={[]} isAuthenticated>
        <Probe listingId="l1" />
      </CartProvider>,
    );

    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith("merge_guest_cart", {
        p_items: [{ listing_id: "l1", quantity: 2 }],
      }),
    );
  });

  it("a successful merge clears guest storage and reflects the returned quantities in shared state", async () => {
    writeGuestCart([
      { listingId: "l1", publicCode: "PLS-1", quantity: 2 },
      { listingId: "l2", publicCode: "PLS-2", quantity: 1 },
    ]);
    rpcMock.mockResolvedValue({
      data: [
        { listing_id: "l1", result: "merged", final_quantity: 3 },
        { listing_id: "l2", result: "skipped_not_cartable", final_quantity: null },
      ],
      error: null,
    });

    render(
      <CartProvider initialLines={[]} isAuthenticated>
        <Probe listingId="l1" />
      </CartProvider>,
    );

    await waitFor(() => expect(readGuestCart()).toEqual([]));
    await waitFor(() => expect(screen.getByTestId("qty")).toHaveTextContent("3"));
    // l2 was skipped with no prior DB row (final_quantity null) -- itemCount
    // reflects only l1's merged quantity.
    expect(screen.getByTestId("count")).toHaveTextContent("3");
  });

  it("a failed merge preserves the guest cart in local storage", async () => {
    writeGuestCart([{ listingId: "l1", publicCode: "PLS-1", quantity: 2 }]);
    rpcMock.mockResolvedValue({ data: null, error: { message: "boom" } });

    render(
      <CartProvider initialLines={[]} isAuthenticated>
        <Probe listingId="l1" />
      </CartProvider>,
    );

    await waitFor(() => expect(rpcMock).toHaveBeenCalled());
    expect(readGuestCart()).toEqual([{ listingId: "l1", publicCode: "PLS-1", quantity: 2 }]);
  });

  it("does not repeatedly retry the merge during the same mounted session", async () => {
    writeGuestCart([{ listingId: "l1", publicCode: "PLS-1", quantity: 2 }]);
    // Every call fails, so a naive implementation would keep retrying on
    // every re-render if it weren't guarded.
    rpcMock.mockResolvedValue({ data: null, error: { message: "boom" } });

    render(
      <CartProvider initialLines={[]} isAuthenticated>
        <Probe listingId="l1" />
        <Controls listingId="l2" />
      </CartProvider>,
    );

    await waitFor(() => expect(rpcMock).toHaveBeenCalledTimes(1));

    // Force additional re-renders of the same mounted CartProvider.
    fireEvent.click(screen.getByText("set-3"));
    fireEvent.click(screen.getByText("remove"));

    expect(rpcMock).toHaveBeenCalledTimes(1);
  });

  it("an empty guest cart on an authenticated mount causes no RPC call", async () => {
    render(
      <CartProvider initialLines={[{ listingId: "l1", publicCode: "PLS-1", quantity: 1 }]} isAuthenticated>
        <Probe listingId="l1" />
      </CartProvider>,
    );

    // Give any pending microtask a chance to run before asserting absence.
    await Promise.resolve();
    await Promise.resolve();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("a guest (unauthenticated) mount never calls merge_guest_cart, even with guest items present", async () => {
    writeGuestCart([{ listingId: "l1", publicCode: "PLS-1", quantity: 2 }]);

    render(
      <CartProvider initialLines={[]} isAuthenticated={false}>
        <Probe listingId="l1" />
      </CartProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("qty")).toHaveTextContent("2"));
    expect(rpcMock).not.toHaveBeenCalled();
  });
});
