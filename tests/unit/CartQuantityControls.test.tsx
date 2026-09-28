import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CartQuantityControls } from "@/components/cart/CartQuantityControls";

describe("CartQuantityControls", () => {
  it("disables Decrease at the minimum quantity of 1", () => {
    render(
      <CartQuantityControls
        quantity={1}
        max={5}
        itemLabel="Nike Air Max"
        onIncrement={vi.fn()}
        onDecrement={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Decrease quantity of Nike Air Max" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Increase quantity of Nike Air Max" })).not.toBeDisabled();
  });

  it("disables Increase at the maximum (available stock)", () => {
    render(
      <CartQuantityControls
        quantity={5}
        max={5}
        itemLabel="Nike Air Max"
        onIncrement={vi.fn()}
        onDecrement={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Increase quantity of Nike Air Max" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Decrease quantity of Nike Air Max" })).not.toBeDisabled();
  });

  it("disables Increase when max is null (unknown/unavailable)", () => {
    render(
      <CartQuantityControls
        quantity={2}
        max={null}
        itemLabel="Nike Air Max"
        onIncrement={vi.fn()}
        onDecrement={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Increase quantity of Nike Air Max" })).toBeDisabled();
  });

  it("disables both stepper buttons when disabled is set, but keeps Remove enabled", () => {
    render(
      <CartQuantityControls
        quantity={2}
        max={5}
        disabled
        itemLabel="Nike Air Max"
        onIncrement={vi.fn()}
        onDecrement={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Decrease quantity of Nike Air Max" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Increase quantity of Nike Air Max" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Remove Nike Air Max from cart" })).not.toBeDisabled();
  });

  it("Remove has an accessible name including the item title", () => {
    render(
      <CartQuantityControls
        quantity={2}
        max={5}
        itemLabel="Nike Air Max"
        onIncrement={vi.fn()}
        onDecrement={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Remove Nike Air Max from cart" })).toBeInTheDocument();
  });

  it("fires the given callbacks", () => {
    const onIncrement = vi.fn();
    const onDecrement = vi.fn();
    const onRemove = vi.fn();
    render(
      <CartQuantityControls
        quantity={2}
        max={5}
        itemLabel="Nike Air Max"
        onIncrement={onIncrement}
        onDecrement={onDecrement}
        onRemove={onRemove}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Increase quantity of Nike Air Max" }));
    fireEvent.click(screen.getByRole("button", { name: "Decrease quantity of Nike Air Max" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove Nike Air Max from cart" }));
    expect(onIncrement).toHaveBeenCalledTimes(1);
    expect(onDecrement).toHaveBeenCalledTimes(1);
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  describe("stock-limit explanation (LAUNCH UX S1.2)", () => {
    it("shows a concise reason, accessibly associated with Increase, when at a known stock limit", () => {
      render(
        <CartQuantityControls
          quantity={5}
          max={5}
          itemLabel="Nike Air Max"
          onIncrement={vi.fn()}
          onDecrement={vi.fn()}
          onRemove={vi.fn()}
        />,
      );
      const increaseButton = screen.getByRole("button", { name: "Increase quantity of Nike Air Max" });
      const message = screen.getByText("Maximum available quantity reached");
      expect(increaseButton).toHaveAttribute("aria-describedby", message.id);
    });

    it("does not show the reason when below the limit", () => {
      render(
        <CartQuantityControls
          quantity={2}
          max={5}
          itemLabel="Nike Air Max"
          onIncrement={vi.fn()}
          onDecrement={vi.fn()}
          onRemove={vi.fn()}
        />,
      );
      expect(screen.queryByText("Maximum available quantity reached")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Increase quantity of Nike Air Max" })).not.toHaveAttribute("aria-describedby");
    });

    it("does not show the reason when max is an unknown ceiling (null) -- disabled either way, but nothing is actually known to be 'reached'", () => {
      render(
        <CartQuantityControls
          quantity={2}
          max={null}
          itemLabel="Nike Air Max"
          onIncrement={vi.fn()}
          onDecrement={vi.fn()}
          onRemove={vi.fn()}
        />,
      );
      expect(screen.getByRole("button", { name: "Increase quantity of Nike Air Max" })).toBeDisabled();
      expect(screen.queryByText("Maximum available quantity reached")).not.toBeInTheDocument();
    });

    it("does not show the reason when the row is disabled for another reason (e.g. unavailable), even at/above max", () => {
      render(
        <CartQuantityControls
          quantity={5}
          max={5}
          disabled
          itemLabel="Nike Air Max"
          onIncrement={vi.fn()}
          onDecrement={vi.fn()}
          onRemove={vi.fn()}
        />,
      );
      expect(screen.getByRole("button", { name: "Increase quantity of Nike Air Max" })).toBeDisabled();
      expect(screen.queryByText("Maximum available quantity reached")).not.toBeInTheDocument();
    });

    it("does not show the reason merely because a mutation is pending (isBusy), independent of the quantity/max relationship", () => {
      render(
        <CartQuantityControls
          quantity={2}
          max={5}
          isBusy
          itemLabel="Nike Air Max"
          onIncrement={vi.fn()}
          onDecrement={vi.fn()}
          onRemove={vi.fn()}
        />,
      );
      expect(screen.getByRole("button", { name: "Increase quantity of Nike Air Max" })).toBeDisabled();
      expect(screen.queryByText("Maximum available quantity reached")).not.toBeInTheDocument();
    });

    it("clears the reason once a decrement brings quantity back below the limit", () => {
      const { rerender } = render(
        <CartQuantityControls
          quantity={5}
          max={5}
          itemLabel="Nike Air Max"
          onIncrement={vi.fn()}
          onDecrement={vi.fn()}
          onRemove={vi.fn()}
        />,
      );
      expect(screen.getByText("Maximum available quantity reached")).toBeInTheDocument();

      rerender(
        <CartQuantityControls
          quantity={4}
          max={5}
          itemLabel="Nike Air Max"
          onIncrement={vi.fn()}
          onDecrement={vi.fn()}
          onRemove={vi.fn()}
        />,
      );
      expect(screen.queryByText("Maximum available quantity reached")).not.toBeInTheDocument();
    });

    it("clears the reason once fresh stock data raises the limit above the current quantity", () => {
      const { rerender } = render(
        <CartQuantityControls
          quantity={5}
          max={5}
          itemLabel="Nike Air Max"
          onIncrement={vi.fn()}
          onDecrement={vi.fn()}
          onRemove={vi.fn()}
        />,
      );
      expect(screen.getByText("Maximum available quantity reached")).toBeInTheDocument();

      rerender(
        <CartQuantityControls
          quantity={5}
          max={8}
          itemLabel="Nike Air Max"
          onIncrement={vi.fn()}
          onDecrement={vi.fn()}
          onRemove={vi.fn()}
        />,
      );
      expect(screen.queryByText("Maximum available quantity reached")).not.toBeInTheDocument();
    });
  });
});
