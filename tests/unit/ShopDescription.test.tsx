import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ShopDescription } from "@/components/shop/ShopDescription";

describe("ShopDescription", () => {
  it("renders the description as plain text", () => {
    render(<ShopDescription description="Quality pre-loved finds since 2020." />);
    expect(screen.getByText("Quality pre-loved finds since 2020.")).toBeInTheDocument();
  });

  it("does not turn a URL-like description into a clickable link", () => {
    render(<ShopDescription description="Visit us at https://example.com/shop for more." />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText(/https:\/\/example\.com\/shop/)).toBeInTheDocument();
  });

  it("never uses dangerouslySetInnerHTML", () => {
    const source = readFileSync(path.join(process.cwd(), "components/shop/ShopDescription.tsx"), "utf-8");
    expect(source).not.toMatch(/dangerouslySetInnerHTML=/);
  });

  it("omits the section entirely when there is no description", () => {
    const { container } = render(<ShopDescription description={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("omits the section entirely when the description is blank", () => {
    const { container } = render(<ShopDescription description="   " />);
    expect(container).toBeEmptyDOMElement();
  });
});
