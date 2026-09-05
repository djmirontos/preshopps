import { describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ListingGallery } from "@/components/listing/ListingGallery";

describe("ListingGallery", () => {
  it("renders a single image with no redundant thumbnail UI", () => {
    render(<ListingGallery images={["https://example.supabase.co/a.webp"]} title="Test Item" />);
    expect(screen.getByRole("img", { name: "Test Item" })).toBeInTheDocument();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  });

  it("renders a thumbnail strip for multiple images and switches the main image on click", () => {
    render(
      <ListingGallery
        images={["https://example.supabase.co/a.webp", "https://example.supabase.co/b.webp"]}
        title="Test Item"
      />,
    );
    const thumbnails = screen.getAllByRole("tab");
    expect(thumbnails).toHaveLength(2);
    expect(thumbnails[0]).toHaveAttribute("aria-selected", "true");

    fireEvent.click(thumbnails[1]);
    expect(thumbnails[1]).toHaveAttribute("aria-selected", "true");
    expect(thumbnails[0]).toHaveAttribute("aria-selected", "false");
  });

  it("shows the neutral placeholder when there are no images", () => {
    render(<ListingGallery images={[]} title="Test Item" />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});
