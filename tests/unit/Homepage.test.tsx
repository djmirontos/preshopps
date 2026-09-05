import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import Home from "@/app/page";

describe("Homepage", () => {
  it("renders the compact hero copy", () => {
    render(<Home />);
    expect(
      screen.getByRole("heading", { level: 1, name: /find something worth loving again/i }),
    ).toBeInTheDocument();
  });

  it("renders Fresh Finds, Pre-loved, and Brand New sections", () => {
    render(<Home />);
    expect(screen.getByRole("heading", { name: "Fresh Finds" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Pre-loved" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Brand New" })).toBeInTheDocument();
  });

  it("does not render a Popular Shops section (no real activity data wired yet)", () => {
    render(<Home />);
    expect(screen.queryByText(/popular shops/i)).not.toBeInTheDocument();
  });

  it("renders the category strip", () => {
    render(<Home />);
    expect(screen.getByRole("link", { name: "Women" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Cars" })).toBeInTheDocument();
  });

  it("renders the trust strip signals", () => {
    render(<Home />);
    expect(screen.getByText("Meet safely")).toBeInTheDocument();
    expect(screen.getByText("Trusted sellers")).toBeInTheDocument();
    expect(screen.getByText("Verified reviews")).toBeInTheDocument();
  });
});
