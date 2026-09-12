import { describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FloatingMessengerProvider, useFloatingMessenger } from "@/components/messaging/FloatingMessengerProvider";

function Probe() {
  const { openConversationId, isMinimized, openConversation, minimize, restore, close } = useFloatingMessenger();
  return (
    <div>
      <p data-testid="open-id">{openConversationId ?? "none"}</p>
      <p data-testid="is-minimized">{String(isMinimized)}</p>
      <button type="button" onClick={() => openConversation("conv-1")}>
        Open conv-1
      </button>
      <button type="button" onClick={() => openConversation("conv-2")}>
        Open conv-2
      </button>
      <button type="button" onClick={minimize}>
        Minimize
      </button>
      <button type="button" onClick={restore}>
        Restore
      </button>
      <button type="button" onClick={close}>
        Close
      </button>
    </div>
  );
}

describe("FloatingMessengerProvider", () => {
  it("starts with no conversation open and not minimized", () => {
    render(
      <FloatingMessengerProvider>
        <Probe />
      </FloatingMessengerProvider>,
    );
    expect(screen.getByTestId("open-id")).toHaveTextContent("none");
    expect(screen.getByTestId("is-minimized")).toHaveTextContent("false");
  });

  it("openConversation sets the open conversation id and (re)expands it", () => {
    render(
      <FloatingMessengerProvider>
        <Probe />
      </FloatingMessengerProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open conv-1" }));
    expect(screen.getByTestId("open-id")).toHaveTextContent("conv-1");
    expect(screen.getByTestId("is-minimized")).toHaveTextContent("false");
  });

  it("opening a second conversation replaces the first -- exactly one open at a time", () => {
    render(
      <FloatingMessengerProvider>
        <Probe />
      </FloatingMessengerProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open conv-1" }));
    expect(screen.getByTestId("open-id")).toHaveTextContent("conv-1");

    fireEvent.click(screen.getByRole("button", { name: "Open conv-2" }));
    expect(screen.getByTestId("open-id")).toHaveTextContent("conv-2");
  });

  it("minimize sets isMinimized without clearing the open conversation id", () => {
    render(
      <FloatingMessengerProvider>
        <Probe />
      </FloatingMessengerProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open conv-1" }));
    fireEvent.click(screen.getByRole("button", { name: "Minimize" }));
    expect(screen.getByTestId("is-minimized")).toHaveTextContent("true");
    expect(screen.getByTestId("open-id")).toHaveTextContent("conv-1");
  });

  it("restore clears isMinimized without touching the open conversation id", () => {
    render(
      <FloatingMessengerProvider>
        <Probe />
      </FloatingMessengerProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open conv-1" }));
    fireEvent.click(screen.getByRole("button", { name: "Minimize" }));
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    expect(screen.getByTestId("is-minimized")).toHaveTextContent("false");
    expect(screen.getByTestId("open-id")).toHaveTextContent("conv-1");
  });

  it("opening the same conversation again while minimized re-expands it", () => {
    render(
      <FloatingMessengerProvider>
        <Probe />
      </FloatingMessengerProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open conv-1" }));
    fireEvent.click(screen.getByRole("button", { name: "Minimize" }));
    fireEvent.click(screen.getByRole("button", { name: "Open conv-1" }));
    expect(screen.getByTestId("is-minimized")).toHaveTextContent("false");
  });

  it("close clears both the open conversation id and isMinimized", () => {
    render(
      <FloatingMessengerProvider>
        <Probe />
      </FloatingMessengerProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open conv-1" }));
    fireEvent.click(screen.getByRole("button", { name: "Minimize" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.getByTestId("open-id")).toHaveTextContent("none");
    expect(screen.getByTestId("is-minimized")).toHaveTextContent("false");
  });

  it("state survives a swap of children -- the same Provider instance backs whatever page is currently rendered underneath it, matching a root-level mount surviving route navigation", () => {
    function PageOne() {
      return <p>Page one content</p>;
    }
    function PageTwo() {
      return <p>Page two content</p>;
    }

    const { rerender } = render(
      <FloatingMessengerProvider>
        <Probe />
        <PageOne />
      </FloatingMessengerProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open conv-1" }));
    expect(screen.getByTestId("open-id")).toHaveTextContent("conv-1");

    // Simulates a Next.js route change: the layout (and this Provider)
    // never unmounts, only its children swap.
    rerender(
      <FloatingMessengerProvider>
        <Probe />
        <PageTwo />
      </FloatingMessengerProvider>,
    );

    expect(screen.getByText("Page two content")).toBeInTheDocument();
    expect(screen.getByTestId("open-id")).toHaveTextContent("conv-1");
  });

  it("useFloatingMessenger has a safe no-op default when there is no Provider ancestor", () => {
    render(<Probe />);
    expect(screen.getByTestId("open-id")).toHaveTextContent("none");
    fireEvent.click(screen.getByRole("button", { name: "Open conv-1" }));
    // No Provider means openConversation is a no-op -- never throws.
    expect(screen.getByTestId("open-id")).toHaveTextContent("none");
  });
});
