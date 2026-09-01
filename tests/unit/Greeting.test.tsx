import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Greeting } from "@/components/Greeting";

describe("Greeting", () => {
  it("renders the provided name", () => {
    render(<Greeting name="Preshopps" />);
    expect(screen.getByText("Hello, Preshopps!")).toBeInTheDocument();
  });
});
