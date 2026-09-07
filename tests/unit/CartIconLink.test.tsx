import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { CartProvider } from "@/components/cart/CartProvider";
import { CartIconLink } from "@/components/cart/CartIconLink";

describe("CartIconLink", () => {
  it("links to /cart", () => {
    render(<CartIconLink />);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/cart");
  });

  it("shows no badge when the cart is empty", () => {
    render(
      <CartProvider initialLines={[]} isAuthenticated>
        <CartIconLink />
      </CartProvider>,
    );
    expect(screen.getByRole("link", { name: "Cart" })).toBeInTheDocument();
  });

  it("shows an item-count badge when the cart is non-empty", () => {
    render(
      <CartProvider initialLines={[{ listingId: "l1", publicCode: "PLS-1", quantity: 3 }]} isAuthenticated>
        <CartIconLink />
      </CartProvider>,
    );
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Cart, 3 items" })).toBeInTheDocument();
  });

  it("uses singular wording for a count of exactly 1", () => {
    render(
      <CartProvider initialLines={[{ listingId: "l1", publicCode: "PLS-1", quantity: 1 }]} isAuthenticated>
        <CartIconLink />
      </CartProvider>,
    );
    expect(screen.getByRole("link", { name: "Cart, 1 item" })).toBeInTheDocument();
  });

  it("caps the displayed badge at 99+", () => {
    render(
      <CartProvider initialLines={[{ listingId: "l1", publicCode: "PLS-1", quantity: 150 }]} isAuthenticated>
        <CartIconLink />
      </CartProvider>,
    );
    expect(screen.getByText("99+")).toBeInTheDocument();
  });
});
