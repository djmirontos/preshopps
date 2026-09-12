import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Tooltip, TooltipBubble } from "@/components/ui/Tooltip";

describe("Tooltip", () => {
  it("renders the wrapped control with its own aria-label untouched -- the tooltip is never the accessible name", () => {
    render(
      <Tooltip label="Favorites">
        <button type="button" aria-label="Favorites">
          icon
        </button>
      </Tooltip>,
    );
    expect(screen.getByRole("button", { name: "Favorites" })).toBeInTheDocument();
  });

  it("renders the tooltip bubble text in the document (present for assistive tech / hit-testing), gated to lg+ purely via CSS classes", () => {
    render(
      <Tooltip label="Minimize chat">
        <button type="button" aria-label="Minimize chat">
          icon
        </button>
      </Tooltip>,
    );
    const bubble = screen.getByRole("tooltip");
    expect(bubble).toHaveTextContent("Minimize chat");
  });

  it("gates visibility behind the lg: breakpoint and group-hover/focus in its className -- never visible unconditionally", () => {
    render(
      <Tooltip label="Cart">
        <button type="button" aria-label="Cart">
          icon
        </button>
      </Tooltip>,
    );
    const bubble = screen.getByRole("tooltip");
    // Base state: invisible/opacity-0 regardless of viewport.
    expect(bubble.className).toContain("invisible");
    expect(bubble.className).toContain("opacity-0");
    // Only ever becomes visible under an `lg:` variant -- so it can never
    // show below that breakpoint no matter the hover/focus state.
    expect(bubble.className).toMatch(/lg:group-hover:visible/);
    expect(bubble.className).toMatch(/lg:group-focus-within:visible/);
    expect(bubble.className).not.toMatch(/(?<!lg:)(?:^|\s)group-hover:visible/);
  });

  it("wraps its child in a `group` container so hover/focus on the child can reveal the bubble", () => {
    const { container } = render(
      <Tooltip label="Account">
        <button type="button" aria-label="Account">
          icon
        </button>
      </Tooltip>,
    );
    const wrapper = container.firstElementChild;
    expect(wrapper?.className).toContain("group");
  });

  it("defaults to side=\"top\" (bottom-full, above the trigger) -- unchanged behavior for controls with clear room above them", () => {
    render(
      <Tooltip label="Previous photo">
        <button type="button" aria-label="Previous photo">
          icon
        </button>
      </Tooltip>,
    );
    const bubble = screen.getByRole("tooltip");
    expect(bubble.className).toMatch(/bottom-full/);
    expect(bubble.className).toMatch(/mb-2/);
    expect(bubble.className).not.toMatch(/top-full/);
  });

  it("side=\"bottom\" places the bubble below the trigger (top-full) with a comfortable gap -- for controls at/near the top of the viewport, where a top-placed bubble would be pushed above y=0 and clipped", () => {
    render(
      <Tooltip label="Messages" side="bottom">
        <button type="button" aria-label="Messages">
          icon
        </button>
      </Tooltip>,
    );
    const bubble = screen.getByRole("tooltip");
    expect(bubble.className).toMatch(/top-full/);
    expect(bubble.className).toMatch(/mt-2/);
    expect(bubble.className).not.toMatch(/bottom-full/);
  });

  it("still carries a sufficient z-index regardless of side, so it renders above the sticky header (z-40) and any other page content", () => {
    render(
      <Tooltip label="Cart" side="bottom">
        <button type="button" aria-label="Cart">
          icon
        </button>
      </Tooltip>,
    );
    expect(screen.getByRole("tooltip").className).toMatch(/z-50/);
  });
});

describe("TooltipBubble", () => {
  it("renders standalone with role=tooltip and the given label -- for controls that must stay their own positioned `group` (e.g. an absolutely-positioned arrow button)", () => {
    render(
      <button type="button" className="group relative" aria-label="Scroll categories left">
        icon
        <TooltipBubble label="Scroll left" />
      </button>,
    );
    expect(screen.getByRole("tooltip")).toHaveTextContent("Scroll left");
  });

  it("defaults to side=\"top\" (bottom-full)", () => {
    render(
      <div className="group relative">
        <TooltipBubble label="Above" />
      </div>,
    );
    const bubble = screen.getByRole("tooltip");
    expect(bubble.className).toMatch(/bottom-full/);
    expect(bubble.className).toMatch(/mb-2/);
  });

  it("supports a bottom side variant (top-full, below the trigger)", () => {
    render(
      <div className="group relative">
        <TooltipBubble label="Below" side="bottom" />
      </div>,
    );
    const bubble = screen.getByRole("tooltip");
    expect(bubble.className).toMatch(/top-full/);
    expect(bubble.className).toMatch(/mt-2/);
  });
});
