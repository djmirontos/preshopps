import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { CategoryStrip } from "@/components/marketplace/CategoryStrip";
import type { CategoryRef } from "@/lib/marketplace/reference-data";

const categories: CategoryRef[] = [
  { id: 1, slug: "women", name: "Women" },
  { id: 10, slug: "cars", name: "Cars" },
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
});
