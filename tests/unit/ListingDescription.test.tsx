import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ListingDescription } from "@/components/listing/ListingDescription";

describe("ListingDescription", () => {
  it("renders the description as plain text", () => {
    render(<ListingDescription description="A great item in good condition." knownFlaws={null} />);
    expect(screen.getByText("A great item in good condition.")).toBeInTheDocument();
  });

  it("preserves line breaks without rendering markdown", () => {
    render(<ListingDescription description={"Line one\nLine two"} knownFlaws={null} />);
    const paragraph = screen.getByText((_, element) => element?.textContent === "Line one\nLine two");
    expect(paragraph).toHaveClass("whitespace-pre-wrap");
  });

  it("does not turn a URL-like description into a clickable link", () => {
    render(
      <ListingDescription
        description="Check this out: https://example.com/scam and www.phish.example"
        knownFlaws={null}
      />,
    );
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText(/https:\/\/example\.com\/scam/)).toBeInTheDocument();
  });

  it("never uses dangerouslySetInnerHTML anywhere in this component", () => {
    const source = readFileSync(
      path.join(process.cwd(), "components/listing/ListingDescription.tsx"),
      "utf-8",
    );
    expect(source).not.toMatch(/dangerouslySetInnerHTML=/);
  });

  it("renders known flaws under their own heading when present", () => {
    render(<ListingDescription description="Fair condition item." knownFlaws="Small scratch on the back." />);
    expect(screen.getByText("Known flaws")).toBeInTheDocument();
    expect(screen.getByText("Small scratch on the back.")).toBeInTheDocument();
  });

  it("omits the known flaws section entirely when there are none", () => {
    render(<ListingDescription description="Great condition." knownFlaws={null} />);
    expect(screen.queryByText("Known flaws")).not.toBeInTheDocument();
  });
});
