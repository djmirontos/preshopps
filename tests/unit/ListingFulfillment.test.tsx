import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ListingFulfillment } from "@/components/listing/ListingFulfillment";

describe("ListingFulfillment", () => {
  it("renders exactly the supported methods with friendly labels", () => {
    render(<ListingFulfillment methods={["meetup", "shipping"]} meetupNote={null} />);
    expect(screen.getByText("Meetup")).toBeInTheDocument();
    expect(screen.getByText("Shipping")).toBeInTheDocument();
  });

  it("does not render an unsupported method", () => {
    render(<ListingFulfillment methods={["meetup"]} meetupNote={null} />);
    expect(screen.queryByText("Pickup")).not.toBeInTheDocument();
    expect(screen.queryByText("Local Delivery")).not.toBeInTheDocument();
    expect(screen.queryByText("Shipping")).not.toBeInTheDocument();
  });

  it("shows the meetup note only when meetup is supported and a note exists", () => {
    render(<ListingFulfillment methods={["meetup"]} meetupNote="Meet at the mall entrance." />);
    expect(screen.getByText("Meet at the mall entrance.")).toBeInTheDocument();
  });

  it("does not show a meetup note when meetup isn't a supported method", () => {
    render(<ListingFulfillment methods={["shipping"]} meetupNote="Meet at the mall entrance." />);
    expect(screen.queryByText("Meet at the mall entrance.")).not.toBeInTheDocument();
  });

  it("renders nothing when no fulfillment methods are supported", () => {
    const { container } = render(<ListingFulfillment methods={[]} meetupNote={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
