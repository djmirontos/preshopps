import { describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FloatingMessengerProvider, useFloatingMessenger } from "@/components/messaging/FloatingMessengerProvider";

function Probe() {
  const { isOpen, selectedConversationId, openMessenger, openConversation, minimize, close } = useFloatingMessenger();
  return (
    <div>
      <p data-testid="is-open">{String(isOpen)}</p>
      <p data-testid="selected-id">{selectedConversationId ?? "none"}</p>
      <button type="button" onClick={openMessenger}>
        Open messenger
      </button>
      <button type="button" onClick={() => openConversation("conv-1")}>
        Open conv-1
      </button>
      <button type="button" onClick={() => openConversation("conv-2")}>
        Open conv-2
      </button>
      <button type="button" onClick={minimize}>
        Minimize
      </button>
      <button type="button" onClick={close}>
        Close
      </button>
    </div>
  );
}

describe("FloatingMessengerProvider", () => {
  it("starts collapsed with no conversation selected", () => {
    render(
      <FloatingMessengerProvider>
        <Probe />
      </FloatingMessengerProvider>,
    );
    expect(screen.getByTestId("is-open")).toHaveTextContent("false");
    expect(screen.getByTestId("selected-id")).toHaveTextContent("none");
  });

  it("openMessenger opens the center without selecting any conversation", () => {
    render(
      <FloatingMessengerProvider>
        <Probe />
      </FloatingMessengerProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open messenger" }));
    expect(screen.getByTestId("is-open")).toHaveTextContent("true");
    expect(screen.getByTestId("selected-id")).toHaveTextContent("none");
  });

  it("openConversation selects the conversation and opens the center", () => {
    render(
      <FloatingMessengerProvider>
        <Probe />
      </FloatingMessengerProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open conv-1" }));
    expect(screen.getByTestId("selected-id")).toHaveTextContent("conv-1");
    expect(screen.getByTestId("is-open")).toHaveTextContent("true");
  });

  it("selecting a second conversation swaps the right-pane selection -- it never opens a second window", () => {
    render(
      <FloatingMessengerProvider>
        <Probe />
      </FloatingMessengerProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open conv-1" }));
    expect(screen.getByTestId("selected-id")).toHaveTextContent("conv-1");

    fireEvent.click(screen.getByRole("button", { name: "Open conv-2" }));
    expect(screen.getByTestId("selected-id")).toHaveTextContent("conv-2");
    // Still exactly one isOpen flag, one selectedConversationId -- no
    // second panel/window concept exists in this state at all.
    expect(screen.getByTestId("is-open")).toHaveTextContent("true");
  });

  it("minimize collapses the center without clearing the selected conversation", () => {
    render(
      <FloatingMessengerProvider>
        <Probe />
      </FloatingMessengerProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open conv-1" }));
    fireEvent.click(screen.getByRole("button", { name: "Minimize" }));
    expect(screen.getByTestId("is-open")).toHaveTextContent("false");
    expect(screen.getByTestId("selected-id")).toHaveTextContent("conv-1");
  });

  it("reopening after minimize resumes on the same selected conversation", () => {
    render(
      <FloatingMessengerProvider>
        <Probe />
      </FloatingMessengerProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open conv-1" }));
    fireEvent.click(screen.getByRole("button", { name: "Minimize" }));
    fireEvent.click(screen.getByRole("button", { name: "Open messenger" }));
    expect(screen.getByTestId("is-open")).toHaveTextContent("true");
    expect(screen.getByTestId("selected-id")).toHaveTextContent("conv-1");
  });

  it("close collapses the center exactly like minimize -- desktop MVP's close is non-destructive, it never clears the selection or removes messenger access", () => {
    render(
      <FloatingMessengerProvider>
        <Probe />
      </FloatingMessengerProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open conv-1" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.getByTestId("is-open")).toHaveTextContent("false");
    expect(screen.getByTestId("selected-id")).toHaveTextContent("conv-1");

    // The launcher (openMessenger) still works after close -- access was
    // collapsed, never destroyed.
    fireEvent.click(screen.getByRole("button", { name: "Open messenger" }));
    expect(screen.getByTestId("is-open")).toHaveTextContent("true");
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
    expect(screen.getByTestId("selected-id")).toHaveTextContent("conv-1");

    // Simulates a Next.js route change: the layout (and this Provider)
    // never unmounts, only its children swap.
    rerender(
      <FloatingMessengerProvider>
        <Probe />
        <PageTwo />
      </FloatingMessengerProvider>,
    );

    expect(screen.getByText("Page two content")).toBeInTheDocument();
    expect(screen.getByTestId("selected-id")).toHaveTextContent("conv-1");
    expect(screen.getByTestId("is-open")).toHaveTextContent("true");
  });

  it("useFloatingMessenger has a safe no-op default when there is no Provider ancestor", () => {
    render(<Probe />);
    expect(screen.getByTestId("selected-id")).toHaveTextContent("none");
    fireEvent.click(screen.getByRole("button", { name: "Open conv-1" }));
    // No Provider means openConversation is a no-op -- never throws.
    expect(screen.getByTestId("selected-id")).toHaveTextContent("none");
  });
});
