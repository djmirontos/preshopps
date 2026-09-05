import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FilterControls } from "@/components/search/FilterControls";
import { parseSearchFilters } from "@/lib/marketplace/search-params";
import type { CategoryRef, LocationRef } from "@/lib/marketplace/reference-data";

const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

const categories: CategoryRef[] = [{ id: 1, slug: "women", name: "Women" }];
const provinces: LocationRef[] = [
  { id: 3, name: "Misamis Occidental" },
  { id: 9, name: "Zamboanga del Norte" },
];
const cities: LocationRef[] = [
  { id: 12, name: "Tangub City" },
  { id: 20, name: "Ozamiz City" },
];
const barangays: LocationRef[] = [{ id: 45, name: "Barra" }];

describe("FilterControls", () => {
  it("hides the Condition field entirely for Brand New (no redundant control)", () => {
    const filters = parseSearchFilters({ type: "brand_new" });
    render(
      <FilterControls
        filters={filters}
        categories={categories}
        provinces={provinces}
        cities={[]}
        barangays={[]}
      />,
    );
    expect(screen.queryByRole("radiogroup", { name: "Condition" })).not.toBeInTheDocument();
  });

  it("clears condition in the same navigation when switching Type to Brand New", () => {
    pushMock.mockClear();
    const filters = parseSearchFilters({ type: "preloved", condition: "good" });
    render(
      <FilterControls
        filters={filters}
        categories={categories}
        provinces={provinces}
        cities={[]}
        barangays={[]}
      />,
    );

    fireEvent.click(screen.getByRole("radio", { name: "Brand New" }));
    expect(pushMock).toHaveBeenCalledWith("/search?type=brand_new", { scroll: false });
  });

  it("shows a helper note that Condition only applies to pre-loved items when Type is All", () => {
    const filters = parseSearchFilters({});
    render(
      <FilterControls
        filters={filters}
        categories={categories}
        provinces={provinces}
        cities={[]}
        barangays={[]}
      />,
    );
    expect(screen.getByText(/applies to pre-loved items only/i)).toBeInTheDocument();
  });

  it("clears city and barangay when the province changes", () => {
    pushMock.mockClear();
    const filters = parseSearchFilters({ province: "3", city: "12", barangay: "45" });
    render(
      <FilterControls
        filters={filters}
        categories={categories}
        provinces={provinces}
        cities={cities}
        barangays={barangays}
      />,
    );

    fireEvent.change(screen.getByRole("combobox", { name: "Province" }), { target: { value: "9" } });
    expect(pushMock).toHaveBeenCalledWith("/search?province=9", { scroll: false });
  });

  it("clears only barangay when the city changes", () => {
    pushMock.mockClear();
    const filters = parseSearchFilters({ province: "3", city: "12", barangay: "45" });
    render(
      <FilterControls
        filters={filters}
        categories={categories}
        provinces={provinces}
        cities={cities}
        barangays={barangays}
      />,
    );

    fireEvent.change(screen.getByRole("combobox", { name: "City or municipality" }), {
      target: { value: "20" },
    });
    expect(pushMock).toHaveBeenCalledWith("/search?province=3&city=20", { scroll: false });
  });

  it("applies a price filter on blur, not per keystroke", () => {
    pushMock.mockClear();
    const filters = parseSearchFilters({});
    render(
      <FilterControls
        filters={filters}
        categories={categories}
        provinces={provinces}
        cities={[]}
        barangays={[]}
      />,
    );

    const minInput = screen.getByRole("spinbutton", { name: "Minimum price" });
    fireEvent.change(minInput, { target: { value: "500" } });
    expect(pushMock).not.toHaveBeenCalled();

    fireEvent.blur(minInput);
    expect(pushMock).toHaveBeenCalledWith("/search?min_price=500", { scroll: false });
  });
});
