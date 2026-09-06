import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/auth/use-is-authenticated", async (importOriginal) => importOriginal());

import { AuthStatusProvider } from "@/components/auth/AuthStatusProvider";
import { useIsAuthenticated } from "@/lib/auth/use-is-authenticated";

function Probe() {
  const isAuthenticated = useIsAuthenticated();
  return <span>{String(isAuthenticated)}</span>;
}

describe("AuthStatusProvider", () => {
  it("exposes guest (false) to consumers", () => {
    render(
      <AuthStatusProvider isAuthenticated={false}>
        <Probe />
      </AuthStatusProvider>,
    );
    expect(screen.getByText("false")).toBeInTheDocument();
  });

  it("exposes authenticated (true) to consumers", () => {
    render(
      <AuthStatusProvider isAuthenticated={true}>
        <Probe />
      </AuthStatusProvider>,
    );
    expect(screen.getByText("true")).toBeInTheDocument();
  });

  it("defaults to guest (false) when rendered with no provider", () => {
    render(<Probe />);
    expect(screen.getByText("false")).toBeInTheDocument();
  });
});
