import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { CategoryStrip } from "@/components/marketplace/CategoryStrip";
import type { CategoryRef } from "@/lib/marketplace/reference-data";

/**
 * jsdom never computes real layout, so scrollWidth/clientWidth/scrollLeft
 * are always 0 unless explicitly stubbed. This simulates a rail whose
 * content overflows its visible width by `overflowPx`, starting scrolled
 * to `scrollLeft`, matching how a real overflowing horizontal rail
 * reports these three properties.
 */
function stubScrollGeometry(el: HTMLElement, { clientWidth, overflowPx, scrollLeft = 0 }: { clientWidth: number; overflowPx: number; scrollLeft?: number }) {
  Object.defineProperty(el, "clientWidth", { configurable: true, value: clientWidth });
  Object.defineProperty(el, "scrollWidth", { configurable: true, value: clientWidth + overflowPx });
  Object.defineProperty(el, "scrollLeft", { configurable: true, writable: true, value: scrollLeft });
}

const categories: CategoryRef[] = [
  { id: 1, slug: "women", name: "Women" },
  { id: 10, slug: "cars", name: "Cars" },
  { id: 5, slug: "bags-accessories", name: "Bags & Accessories" },
  { id: 8, slug: "beauty-personal-care", name: "Beauty & Personal Care" },
  { id: 99, slug: "future-category", name: "Future Category" },
];

describe("CategoryStrip", () => {
  it("links each category to /search?category={slug}", () => {
    render(<CategoryStrip categories={categories} />);
    expect(screen.getByRole("link", { name: "Women" })).toHaveAttribute(
      "href",
      "/search?category=women",
    );
    expect(screen.getByRole("link", { name: "Cars" })).toHaveAttribute(
      "href",
      "/search?category=cars",
    );
  });

  it("renders the mapped category image for a known slug", () => {
    render(<CategoryStrip categories={categories} />);
    const link = screen.getByRole("link", { name: "Women" });
    const image = link.querySelector("img");
    expect(image).not.toBeNull();
    expect(image?.getAttribute("src")).toContain("womens.png");
  });

  it("renders the image with contain behavior, never cropped via cover", () => {
    render(<CategoryStrip categories={categories} />);
    const link = screen.getByRole("link", { name: "Women" });
    const image = link.querySelector("img");
    expect(image?.className).toContain("object-contain");
    expect(image?.className).not.toContain("object-cover");
  });

  it("keeps the visible category label present alongside the image", () => {
    render(<CategoryStrip categories={categories} />);
    expect(screen.getByText("Women")).toBeInTheDocument();
    expect(screen.getByText("Cars")).toBeInTheDocument();
  });

  it("renders an unmapped category slug with the fallback icon, not a broken image", () => {
    render(<CategoryStrip categories={categories} />);
    const link = screen.getByRole("link", { name: "Future Category" });
    expect(link).toBeInTheDocument();
    expect(link.querySelector("img")).toBeNull();
    expect(link.querySelector("svg")).not.toBeNull();
  });

  it("renders nothing when no categories are available", () => {
    const { container } = render(<CategoryStrip categories={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders long category names in full, never truncated with an ellipsis", () => {
    render(<CategoryStrip categories={categories} />);
    // The full label text must be present verbatim in the DOM -- no
    // truncate/line-clamp class collapsing it and no "Bags & Ac..." style
    // abbreviation.
    expect(screen.getByText("Bags & Accessories")).toBeInTheDocument();
    expect(screen.getByText("Beauty & Personal Care")).toBeInTheDocument();
  });

  it("never applies a truncating class to category labels", () => {
    render(<CategoryStrip categories={categories} />);
    const label = screen.getByText("Bags & Accessories");
    expect(label.className).not.toContain("truncate");
  });

  it("uses a 2-row horizontal-scroll grid below 1024px, reverting to a single-row flex rail at 1024px+", () => {
    render(<CategoryStrip categories={categories} />);
    const list = screen.getByRole("link", { name: "Women" }).closest("ul");
    expect(list?.className).toContain("grid");
    expect(list?.className).toContain("grid-flow-col");
    expect(list?.className).toContain("grid-rows-2");
    expect(list?.className).toContain("overflow-x-auto");
    // Desktop reverts to the existing single-row rail.
    expect(list?.className).toContain("lg:flex");
  });

  it("renders all 16 live categories", () => {
    const allSixteen: CategoryRef[] = [
      { id: 1, slug: "women", name: "Women" },
      { id: 2, slug: "men", name: "Men" },
      { id: 3, slug: "kids-baby", name: "Kids & Baby" },
      { id: 4, slug: "shoes", name: "Shoes" },
      { id: 5, slug: "bags-accessories", name: "Bags & Accessories" },
      { id: 6, slug: "electronics", name: "Electronics" },
      { id: 7, slug: "home-living", name: "Home & Living" },
      { id: 8, slug: "beauty-personal-care", name: "Beauty & Personal Care" },
      { id: 9, slug: "sports-hobbies", name: "Sports & Hobbies" },
      { id: 10, slug: "cars", name: "Cars" },
      { id: 11, slug: "motorcycles", name: "Motorcycles" },
      { id: 12, slug: "for-rent", name: "For Rent" },
      { id: 13, slug: "other", name: "Other" },
      { id: 14, slug: "pet", name: "Pet" },
      { id: 15, slug: "foods", name: "Foods" },
      { id: 16, slug: "bicycle", name: "Bicycle" },
    ];
    render(<CategoryStrip categories={allSixteen} />);
    for (const category of allSixteen) {
      expect(screen.getByRole("link", { name: category.name })).toBeInTheDocument();
    }
  });
});

describe("CategoryStrip -- left/right navigation arrows", () => {
  it("renders a left and right scroll button matching the existing icon-button style", () => {
    render(<CategoryStrip categories={categories} />);
    expect(screen.getByRole("button", { name: "Scroll categories left" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Scroll categories right" })).toBeInTheDocument();
  });

  it("disables the left arrow at the beginning of the rail", () => {
    render(<CategoryStrip categories={categories} />);
    const rail = screen.getByRole("link", { name: "Women" }).closest("ul") as HTMLUListElement;
    act(() => stubScrollGeometry(rail, { clientWidth: 400, overflowPx: 600, scrollLeft: 0 }));
    fireEvent.scroll(rail);
    expect(screen.getByRole("button", { name: "Scroll categories left" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Scroll categories right" })).not.toBeDisabled();
  });

  it("disables the right arrow once scrolled to the end -- the final category is reachable, not clipped", () => {
    render(<CategoryStrip categories={categories} />);
    const rail = screen.getByRole("link", { name: "Women" }).closest("ul") as HTMLUListElement;
    act(() => stubScrollGeometry(rail, { clientWidth: 400, overflowPx: 600, scrollLeft: 600 }));
    fireEvent.scroll(rail);
    expect(screen.getByRole("button", { name: "Scroll categories right" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Scroll categories left" })).not.toBeDisabled();
  });

  it("re-enables the left arrow and keeps state correct while scrolling in the middle of the rail", () => {
    render(<CategoryStrip categories={categories} />);
    const rail = screen.getByRole("link", { name: "Women" }).closest("ul") as HTMLUListElement;
    act(() => stubScrollGeometry(rail, { clientWidth: 400, overflowPx: 600, scrollLeft: 300 }));
    fireEvent.scroll(rail);
    expect(screen.getByRole("button", { name: "Scroll categories left" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "Scroll categories right" })).not.toBeDisabled();
  });

  it("both arrows are disabled when the rail does not overflow its container at all", () => {
    render(<CategoryStrip categories={categories} />);
    const rail = screen.getByRole("link", { name: "Women" }).closest("ul") as HTMLUListElement;
    act(() => stubScrollGeometry(rail, { clientWidth: 1000, overflowPx: 0, scrollLeft: 0 }));
    fireEvent.scroll(rail);
    expect(screen.getByRole("button", { name: "Scroll categories left" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Scroll categories right" })).toBeDisabled();
  });

  it("clicking the right arrow smooth-scrolls the rail forward by roughly its visible width", () => {
    render(<CategoryStrip categories={categories} />);
    const rail = screen.getByRole("link", { name: "Women" }).closest("ul") as HTMLUListElement;
    act(() => stubScrollGeometry(rail, { clientWidth: 400, overflowPx: 600, scrollLeft: 0 }));
    fireEvent.scroll(rail);
    const scrollBySpy = vi.fn();
    rail.scrollBy = scrollBySpy;

    fireEvent.click(screen.getByRole("button", { name: "Scroll categories right" }));

    expect(scrollBySpy).toHaveBeenCalledWith({ left: 320, behavior: "smooth" });
  });

  it("clicking the left arrow smooth-scrolls the rail backward by roughly its visible width", () => {
    render(<CategoryStrip categories={categories} />);
    const rail = screen.getByRole("link", { name: "Women" }).closest("ul") as HTMLUListElement;
    act(() => stubScrollGeometry(rail, { clientWidth: 400, overflowPx: 600, scrollLeft: 400 }));
    fireEvent.scroll(rail);
    const scrollBySpy = vi.fn();
    rail.scrollBy = scrollBySpy;

    fireEvent.click(screen.getByRole("button", { name: "Scroll categories left" }));

    expect(scrollBySpy).toHaveBeenCalledWith({ left: -320, behavior: "smooth" });
  });

  it("never disables both arrows by hiding them from the accessibility tree -- disabled state is reachable via role queries", () => {
    render(<CategoryStrip categories={categories} />);
    // Confirms the buttons stay in the DOM/a11y tree (as disabled, not
    // removed) so screen readers and layout both stay stable across
    // state changes -- no popping in/out of the tree.
    expect(screen.getByRole("button", { name: "Scroll categories left" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Scroll categories right" })).toBeInTheDocument();
  });

  it("recomputes arrow state on window resize", () => {
    render(<CategoryStrip categories={categories} />);
    const rail = screen.getByRole("link", { name: "Women" }).closest("ul") as HTMLUListElement;
    act(() => stubScrollGeometry(rail, { clientWidth: 400, overflowPx: 600, scrollLeft: 600 }));
    fireEvent.scroll(rail);
    expect(screen.getByRole("button", { name: "Scroll categories right" })).toBeDisabled();

    // Viewport grows wide enough that the rail no longer overflows.
    act(() => {
      stubScrollGeometry(rail, { clientWidth: 1000, overflowPx: 0, scrollLeft: 0 });
      window.dispatchEvent(new Event("resize"));
    });

    expect(screen.getByRole("button", { name: "Scroll categories right" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Scroll categories left" })).toBeDisabled();
  });

  it("arrow buttons are hidden below the lg breakpoint (utility class only) so they never interfere with the mobile touch-swipe rail", () => {
    render(<CategoryStrip categories={categories} />);
    const leftArrow = screen.getByRole("button", { name: "Scroll categories left" });
    const rightArrow = screen.getByRole("button", { name: "Scroll categories right" });
    expect(leftArrow.className).toContain("hidden");
    expect(leftArrow.className).toContain("lg:flex");
    expect(rightArrow.className).toContain("hidden");
    expect(rightArrow.className).toContain("lg:flex");
  });
});
