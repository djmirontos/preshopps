import { describe, expect, it } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
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

describe("ListingGallery -- photo lightbox", () => {
  const images = [
    "https://example.supabase.co/a.webp",
    "https://example.supabase.co/b.webp",
    "https://example.supabase.co/c.webp",
  ];

  it("does not render the lightbox until the main image is clicked", () => {
    render(<ListingGallery images={images} title="Test Item" />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("clicking the main image opens the lightbox", () => {
    render(<ListingGallery images={images} title="Test Item" />);
    fireEvent.click(screen.getByRole("button", { name: /view full-size photo/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("opens on the currently selected image, not always the first", () => {
    render(<ListingGallery images={images} title="Test Item" />);
    fireEvent.click(screen.getAllByRole("tab")[2]);
    fireEvent.click(screen.getByRole("button", { name: /view full-size photo/i }));

    expect(screen.getByText("3 / 3")).toBeInTheDocument();
  });

  it("selecting a new image inside the lightbox also updates the main gallery image behind it", () => {
    render(<ListingGallery images={images} title="Test Item" />);
    fireEvent.click(screen.getByRole("button", { name: /view full-size photo/i }));

    const lightboxThumbnails = screen.getAllByRole("tab", { name: /show photo/i });
    fireEvent.click(lightboxThumbnails[1]);

    expect(screen.getByText("2 / 3")).toBeInTheDocument();
    // The underlying gallery's own thumbnail rail reflects the same shared
    // selection state -- no second, independent "which image" value.
    const galleryTab = screen.getByRole("tab", { name: "Show image 2 of 3" });
    expect(galleryTab).toHaveAttribute("aria-selected", "true");
  });

  it("closing the lightbox returns to the listing detail without any navigation", () => {
    render(<ListingGallery images={images} title="Test Item" />);
    fireEvent.click(screen.getByRole("button", { name: /view full-size photo/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close photo viewer" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // The gallery itself is still there, unaffected.
    expect(screen.getByRole("img", { name: "Test Item" })).toBeInTheDocument();
  });

  it("Escape closes the lightbox opened from the gallery", () => {
    render(<ListingGallery images={images} title="Test Item" />);
    fireEvent.click(screen.getByRole("button", { name: /view full-size photo/i }));

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens the lightbox for a single-image listing too, with no arrows/thumbnails", () => {
    render(<ListingGallery images={[images[0]]} title="Test Item" />);
    fireEvent.click(screen.getByRole("button", { name: /view full-size photo/i }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Previous photo" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Next photo" })).not.toBeInTheDocument();
  });

  it("the lightbox's own main image also uses contain (not cover) -- consistent whole-image treatment between the gallery and the lightbox", () => {
    render(<ListingGallery images={images} title="Test Item" />);
    fireEvent.click(screen.getByRole("button", { name: /view full-size photo/i }));

    const dialog = screen.getByRole("dialog");
    const lightboxMainImage = within(dialog).getByRole("img", { name: /test item - photo/i });
    expect(lightboxMainImage.className).toMatch(/object-contain/);
  });
});

describe("ListingGallery -- main image shows the whole photo, never cropped (P1 fix)", () => {
  it("the main image uses object-contain, never object-cover, so the entire uploaded photo is visible regardless of its own aspect ratio", () => {
    render(<ListingGallery images={["https://example.supabase.co/landscape.webp"]} title="Test Item" />);
    const mainImage = screen.getByRole("img", { name: "Test Item" });
    expect(mainImage.className).toMatch(/object-contain/);
    expect(mainImage.className).not.toMatch(/object-cover/);
  });

  it("keeps the same gallery footprint (aspect-[4/5] box) and a neutral/light letterboxing background -- only how the photo fits inside that box changed", () => {
    render(<ListingGallery images={["https://example.supabase.co/portrait.webp"]} title="Test Item" />);
    const mainImageButton = screen.getByRole("button", { name: /view full-size photo/i });
    expect(mainImageButton.className).toMatch(/aspect-\[4\/5\]/);
    expect(mainImageButton.className).toMatch(/bg-divider/);
  });

  it.each([
    ["portrait", "https://example.supabase.co/portrait.webp"],
    ["landscape", "https://example.supabase.co/landscape.webp"],
    ["square", "https://example.supabase.co/square.webp"],
  ])("a %s photo is rendered with the same whole-image (object-contain) treatment as any other -- the fix is aspect-ratio-agnostic by design, not per-orientation logic", (_label, url) => {
    render(<ListingGallery images={[url]} title="Test Item" />);
    const mainImage = screen.getByRole("img", { name: "Test Item" });
    // The component never inspects the photo's own dimensions/orientation
    // -- object-contain is applied unconditionally, so it's correct for
    // every aspect ratio uniformly rather than needing portrait/landscape/
    // square-specific handling.
    expect(mainImage.className).toMatch(/object-contain/);
    expect(mainImage.className).not.toMatch(/object-cover/);
  });

  it("switching the selected thumbnail still renders the new main image with object-contain, never object-cover", () => {
    const multiImages = ["https://example.supabase.co/a.webp", "https://example.supabase.co/b-portrait.webp"];
    render(<ListingGallery images={multiImages} title="Test Item" />);

    fireEvent.click(screen.getAllByRole("tab")[1]);

    const mainImage = screen.getByRole("img", { name: "Test Item" });
    expect(mainImage.className).toMatch(/object-contain/);
    expect(mainImage.className).not.toMatch(/object-cover/);
  });

  it("the thumbnail rail itself is unaffected -- thumbnails still use object-cover (a deliberately different, independent presentation from the main image)", () => {
    const multiImages = ["https://example.supabase.co/a.webp", "https://example.supabase.co/b.webp"];
    render(<ListingGallery images={multiImages} title="Test Item" />);

    const thumbnailImages = screen.getAllByRole("tab").map((tab) => tab.querySelector("img"));
    for (const thumbnailImage of thumbnailImages) {
      expect(thumbnailImage?.className).toMatch(/object-cover/);
      expect(thumbnailImage?.className).not.toMatch(/object-contain/);
    }
  });
});
