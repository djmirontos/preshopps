import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReviewImagePicker } from "@/components/orders/ReviewImagePicker";

/**
 * PILOT RESTRICTION (0118_pilot_disable_new_review_photos.sql): the picker
 * is now a read-only display of a review's own existing photos. These
 * tests replace the former upload/remove/retry suite -- that behavior no
 * longer exists in this component.
 */

describe("ReviewImagePicker -- pilot restriction: read-only display only", () => {
  it("renders nothing at all when there are no existing photos (every create-mode review)", () => {
    const { container } = render(<ReviewImagePicker initialPaths={[]} initialUrls={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("displays an existing photo without any interactive control", () => {
    const { container } = render(
      <ReviewImagePicker
        initialPaths={["review-images/buyer-1/order-1/existing.jpg"]}
        initialUrls={["https://example.supabase.co/storage/v1/object/public/review-images/buyer-1/order-1/existing.jpg"]}
      />,
    );

    expect(screen.getByText("Photos")).toBeInTheDocument();
    // A decorative preview (alt="") has no accessible "img" role -- query
    // the plain <img> element directly, as ReviewFormClient.test.tsx and
    // the original picker test both already did for this same tile.
    const img = container.querySelector("img");
    expect(img).toHaveAttribute("src", "https://example.supabase.co/storage/v1/object/public/review-images/buyer-1/order-1/existing.jpg");
  });

  it("displays both existing photos of a 2-photo review, in order", () => {
    const { container } = render(
      <ReviewImagePicker
        initialPaths={["review-images/buyer-1/order-1/a.jpg", "review-images/buyer-1/order-1/b.jpg"]}
        initialUrls={["https://example.supabase.co/x/a.jpg", "https://example.supabase.co/x/b.jpg"]}
      />,
    );

    const images = container.querySelectorAll("img");
    expect(images).toHaveLength(2);
    expect(images[0]).toHaveAttribute("src", "https://example.supabase.co/x/a.jpg");
    expect(images[1]).toHaveAttribute("src", "https://example.supabase.co/x/b.jpg");
  });

  it("never renders an Add Photo control or a file input, with or without existing photos", () => {
    const { rerender } = render(<ReviewImagePicker initialPaths={[]} initialUrls={[]} />);
    expect(screen.queryByLabelText(/add a review photo/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add photo/i })).not.toBeInTheDocument();

    rerender(
      <ReviewImagePicker
        initialPaths={["review-images/buyer-1/order-1/existing.jpg"]}
        initialUrls={["https://example.supabase.co/x/existing.jpg"]}
      />,
    );
    expect(screen.queryByLabelText(/add a review photo/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add photo/i })).not.toBeInTheDocument();
    expect(document.querySelector('input[type="file"]')).not.toBeInTheDocument();
  });

  it("never renders a Remove Photo control", () => {
    render(
      <ReviewImagePicker
        initialPaths={["review-images/buyer-1/order-1/existing.jpg"]}
        initialUrls={["https://example.supabase.co/x/existing.jpg"]}
      />,
    );
    expect(screen.queryByRole("button", { name: "Remove photo" })).not.toBeInTheDocument();
  });

  it("never renders a Retry control (there is no upload that can fail)", () => {
    render(
      <ReviewImagePicker
        initialPaths={["review-images/buyer-1/order-1/existing.jpg"]}
        initialUrls={["https://example.supabase.co/x/existing.jpg"]}
      />,
    );
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });
});
