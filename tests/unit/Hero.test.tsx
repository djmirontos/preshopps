import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Hero } from "@/components/marketplace/Hero";

describe("Hero", () => {
  it("renders the heading and subtitle (desktop content)", () => {
    render(<Hero />);
    expect(
      screen.getByRole("heading", { level: 1, name: "Find something worth loving again." }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Buy and sell pre-loved and brand-new items from local sellers."),
    ).toBeInTheDocument();
  });

  it("never renders Browse Items -- the CTA was removed, not just hidden per breakpoint", () => {
    render(<Hero />);
    expect(screen.queryByRole("link", { name: /browse items/i })).not.toBeInTheDocument();
  });

  it("never renders Start Selling -- the CTA was removed, not just hidden per breakpoint", () => {
    render(<Hero />);
    expect(screen.queryByRole("button", { name: /start selling/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/start selling/i)).not.toBeInTheDocument();
  });

  it("is hidden below 1024px and shown at 1024px+ via responsive classes, so mobile gets no empty spacer", () => {
    render(<Hero />);
    const section = screen.getByRole("heading", { level: 1 }).closest("section");
    // display:none below lg, block at lg+ -- a hidden block-level element
    // occupies zero layout space, so there's nothing left behind on mobile.
    expect(section?.className).toContain("hidden");
    expect(section?.className).toContain("lg:block");
  });

  it("takes no auth prop -- there is no CTA left that needs to know sign-in state", () => {
    // Compile-time proof: Hero renders with zero props. If this call
    // requires an argument, the type-check step (not this assertion)
    // will fail first.
    render(<Hero />);
  });
});
