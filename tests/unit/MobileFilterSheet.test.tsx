import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MobileFilterSheet } from "@/components/search/MobileFilterSheet";
import { parseSearchFilters } from "@/lib/marketplace/search-params";
import type { CategoryRef, LocationRef } from "@/lib/marketplace/reference-data";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const categories: CategoryRef[] = [{ id: 1, slug: "women", name: "Women" }];
const provinces: LocationRef[] = [{ id: 3, name: "Misamis Occidental" }];

function renderSheet(rawParams: Record<string, string> = {}) {
  const filters = parseSearchFilters(rawParams);
  return render(
    <MobileFilterSheet
      filters={filters}
      categories={categories}
      provinces={provinces}
      cities={[]}
      barangays={[]}
    />,
  );
}

describe("MobileFilterSheet", () => {
  it("is closed by default and shows an active-filter count badge on the trigger", () => {
    renderSheet({ category: "women", type: "preloved" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    const trigger = screen.getByRole("button", { name: /filters/i });
    expect(trigger).toHaveTextContent("2");
  });

  it("opens an accessible dialog when the trigger is clicked", () => {
    renderSheet();
    fireEvent.click(screen.getByRole("button", { name: /filters/i }));
    const dialog = screen.getByRole("dialog", { name: "Filters" });
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute("aria-modal", "true");
  });

  it("closes via the close button", () => {
    renderSheet();
    fireEvent.click(screen.getByRole("button", { name: /^filters$/i }));
    fireEvent.click(screen.getByRole("button", { name: /close filters/i }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes on Escape", () => {
    renderSheet();
    fireEvent.click(screen.getByRole("button", { name: /^filters$/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
