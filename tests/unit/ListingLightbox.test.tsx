import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ListingLightbox } from "@/components/listing/ListingLightbox";

const IMAGES = [
  "https://example.supabase.co/a.webp",
  "https://example.supabase.co/b.webp",
  "https://example.supabase.co/c.webp",
];

function renderLightbox(overrides: Partial<Parameters<typeof ListingLightbox>[0]> = {}) {
  const onSelectedIndexChange = vi.fn();
  const onClose = vi.fn();
  const utils = render(
    <ListingLightbox
      images={IMAGES}
      title="Test Item"
      selectedIndex={0}
      onSelectedIndexChange={onSelectedIndexChange}
      onClose={onClose}
      {...overrides}
    />,
  );
  return { ...utils, onSelectedIndexChange, onClose };
}

describe("ListingLightbox", () => {
  it("has dialog semantics with an accessible label", () => {
    renderLightbox();
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleName("Test Item photos");
  });

  it("opens showing the currently selected image, not always the first", () => {
    renderLightbox({ selectedIndex: 1 });
    const image = screen.getByRole("img", { name: "Test Item - photo 2 of 3" });
    expect(image).toBeInTheDocument();
  });

  it("renders the active image with object-contain, never object-cover -- no cropping", () => {
    renderLightbox({ selectedIndex: 1 });
    const image = screen.getByRole("img", { name: "Test Item - photo 2 of 3" });
    expect(image.className).toContain("object-contain");
    expect(image.className).not.toContain("object-cover");
  });

  it("close button calls onClose", () => {
    const { onClose } = renderLightbox();
    fireEvent.click(screen.getByRole("button", { name: "Close photo viewer" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Escape calls onClose", () => {
    const { onClose } = renderLightbox();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Next photo button advances the selected index", () => {
    const { onSelectedIndexChange } = renderLightbox({ selectedIndex: 0 });
    fireEvent.click(screen.getByRole("button", { name: "Next photo" }));
    expect(onSelectedIndexChange).toHaveBeenCalledWith(1);
  });

  it("Previous photo button goes back one index", () => {
    const { onSelectedIndexChange } = renderLightbox({ selectedIndex: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Previous photo" }));
    expect(onSelectedIndexChange).toHaveBeenCalledWith(0);
  });

  it("ArrowRight keyboard navigation advances the selected index", () => {
    const { onSelectedIndexChange } = renderLightbox({ selectedIndex: 0 });
    fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(onSelectedIndexChange).toHaveBeenCalledWith(1);
  });

  it("ArrowLeft keyboard navigation goes back one index", () => {
    const { onSelectedIndexChange } = renderLightbox({ selectedIndex: 1 });
    fireEvent.keyDown(document, { key: "ArrowLeft" });
    expect(onSelectedIndexChange).toHaveBeenCalledWith(0);
  });

  it("disables the Previous button on the first image instead of looping", () => {
    const { onSelectedIndexChange } = renderLightbox({ selectedIndex: 0 });
    const previous = screen.getByRole("button", { name: "Previous photo" });
    expect(previous).toBeDisabled();

    fireEvent.click(previous);
    fireEvent.keyDown(document, { key: "ArrowLeft" });
    expect(onSelectedIndexChange).not.toHaveBeenCalled();
  });

  it("disables the Next button on the last image instead of looping", () => {
    const { onSelectedIndexChange } = renderLightbox({ selectedIndex: IMAGES.length - 1 });
    const next = screen.getByRole("button", { name: "Next photo" });
    expect(next).toBeDisabled();

    fireEvent.click(next);
    fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(onSelectedIndexChange).not.toHaveBeenCalled();
  });

  it("clicking a thumbnail selects that image", () => {
    const { onSelectedIndexChange } = renderLightbox({ selectedIndex: 0 });
    const thumbnails = screen.getAllByRole("tab");
    expect(thumbnails).toHaveLength(3);

    fireEvent.click(thumbnails[2]);
    expect(onSelectedIndexChange).toHaveBeenCalledWith(2);
  });

  it("marks the currently selected thumbnail as aria-selected", () => {
    renderLightbox({ selectedIndex: 2 });
    const thumbnails = screen.getAllByRole("tab");
    expect(thumbnails[2]).toHaveAttribute("aria-selected", "true");
    expect(thumbnails[0]).toHaveAttribute("aria-selected", "false");
  });

  it("swiping left (touch) advances to the next image", () => {
    const { onSelectedIndexChange } = renderLightbox({ selectedIndex: 0 });
    const surface = screen.getByRole("img", { name: "Test Item - photo 1 of 3" }).closest("div[class*='relative min-h-0']") as HTMLElement;

    fireEvent.touchStart(surface, { touches: [{ clientX: 200 }] });
    fireEvent.touchEnd(surface, { changedTouches: [{ clientX: 100 }] });

    expect(onSelectedIndexChange).toHaveBeenCalledWith(1);
  });

  it("swiping right (touch) goes to the previous image", () => {
    const { onSelectedIndexChange } = renderLightbox({ selectedIndex: 1 });
    const surface = screen.getByRole("img", { name: "Test Item - photo 2 of 3" }).closest("div[class*='relative min-h-0']") as HTMLElement;

    fireEvent.touchStart(surface, { touches: [{ clientX: 100 }] });
    fireEvent.touchEnd(surface, { changedTouches: [{ clientX: 200 }] });

    expect(onSelectedIndexChange).toHaveBeenCalledWith(0);
  });

  it("ignores a small touch movement below the swipe threshold", () => {
    const { onSelectedIndexChange } = renderLightbox({ selectedIndex: 0 });
    const surface = screen.getByRole("img", { name: "Test Item - photo 1 of 3" }).closest("div[class*='relative min-h-0']") as HTMLElement;

    fireEvent.touchStart(surface, { touches: [{ clientX: 200 }] });
    fireEvent.touchEnd(surface, { changedTouches: [{ clientX: 190 }] });

    expect(onSelectedIndexChange).not.toHaveBeenCalled();
  });

  it("shows an image counter for multiple photos", () => {
    renderLightbox({ selectedIndex: 1 });
    expect(screen.getByText("2 / 3")).toBeInTheDocument();
  });
});

describe("ListingLightbox with a single image", () => {
  it("still opens and renders the image", () => {
    render(
      <ListingLightbox
        images={["https://example.supabase.co/a.webp"]}
        title="Solo Item"
        selectedIndex={0}
        onSelectedIndexChange={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Solo Item - photo 1 of 1" })).toBeInTheDocument();
  });

  it("renders no previous/next arrows", () => {
    render(
      <ListingLightbox
        images={["https://example.supabase.co/a.webp"]}
        title="Solo Item"
        selectedIndex={0}
        onSelectedIndexChange={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: "Previous photo" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Next photo" })).not.toBeInTheDocument();
  });

  it("renders no thumbnail rail", () => {
    render(
      <ListingLightbox
        images={["https://example.supabase.co/a.webp"]}
        title="Solo Item"
        selectedIndex={0}
        onSelectedIndexChange={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  });

  it("still renders the close button", () => {
    render(
      <ListingLightbox
        images={["https://example.supabase.co/a.webp"]}
        title="Solo Item"
        selectedIndex={0}
        onSelectedIndexChange={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Close photo viewer" })).toBeInTheDocument();
  });
});
