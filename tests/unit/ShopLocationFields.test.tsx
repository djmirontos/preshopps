import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ShopLocationFields } from "@/components/seller/ShopLocationFields";

const PROVINCES = [
  { id: 1, name: "Misamis Occidental" },
  { id: 2, name: "Cebu" },
];
const CITIES = [{ id: 10, name: "Tangub City" }];
const BARANGAYS = [{ id: 100, name: "Barangay Uno" }];

describe("ShopLocationFields -- empty reference tables", () => {
  it("shows a graceful empty-state message instead of a dead dropdown when provinces is empty", () => {
    const loadCities = vi.fn();
    const loadBarangays = vi.fn();
    render(
      <ShopLocationFields
        provinces={[]}
        initialCities={[]}
        initialBarangays={[]}
        initialValue={{ provinceId: null, cityId: null, barangayId: null }}
        loadCities={loadCities}
        loadBarangays={loadBarangays}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByText(/location options are not available yet/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/province/i)).not.toBeInTheDocument();
    expect(loadCities).not.toHaveBeenCalled();
  });
});

describe("ShopLocationFields -- dependent selects", () => {
  it("province is required and rendered; city select is deferred until a province is chosen", () => {
    render(
      <ShopLocationFields
        provinces={PROVINCES}
        initialCities={[]}
        initialBarangays={[]}
        initialValue={{ provinceId: null, cityId: null, barangayId: null }}
        loadCities={vi.fn()}
        loadBarangays={vi.fn()}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByText("Province")).toBeInTheDocument();
    expect(screen.getByText(/choose a province first/i)).toBeInTheDocument();
  });

  it("choosing a province loads cities and resets any previously selected city/barangay", async () => {
    const loadCities = vi.fn().mockResolvedValue(CITIES);
    const onChange = vi.fn();
    render(
      <ShopLocationFields
        provinces={PROVINCES}
        initialCities={[]}
        initialBarangays={[]}
        initialValue={{ provinceId: null, cityId: 999, barangayId: 888 }}
        loadCities={loadCities}
        loadBarangays={vi.fn()}
        onChange={onChange}
      />,
    );

    const provinceSelect = screen.getAllByRole("combobox")[0];
    fireEvent.change(provinceSelect, { target: { value: "1" } });

    expect(onChange).toHaveBeenCalledWith({ provinceId: 1, cityId: null, barangayId: null });
    await waitFor(() => expect(loadCities).toHaveBeenCalledWith(1));
    await waitFor(() => expect(screen.getByRole("option", { name: "Tangub City" })).toBeInTheDocument());
  });

  it("choosing a city loads barangays and resets any previously selected barangay", async () => {
    const loadBarangays = vi.fn().mockResolvedValue(BARANGAYS);
    const onChange = vi.fn();
    render(
      <ShopLocationFields
        provinces={PROVINCES}
        initialCities={CITIES}
        initialBarangays={[]}
        initialValue={{ provinceId: 1, cityId: null, barangayId: 888 }}
        loadCities={vi.fn()}
        loadBarangays={loadBarangays}
        onChange={onChange}
      />,
    );

    fireEvent.change(screen.getAllByRole("combobox")[1], { target: { value: "10" } });

    expect(onChange).toHaveBeenCalledWith({ provinceId: 1, cityId: 10, barangayId: null });
    await waitFor(() => expect(loadBarangays).toHaveBeenCalledWith(10));
  });

  it("barangay selection is optional and reports the chosen id", () => {
    const onChange = vi.fn();
    render(
      <ShopLocationFields
        provinces={PROVINCES}
        initialCities={CITIES}
        initialBarangays={BARANGAYS}
        initialValue={{ provinceId: 1, cityId: 10, barangayId: null }}
        loadCities={vi.fn()}
        loadBarangays={vi.fn()}
        onChange={onChange}
      />,
    );

    const barangaySelect = screen.getAllByRole("combobox")[2];
    fireEvent.change(barangaySelect, { target: { value: "100" } });

    expect(onChange).toHaveBeenCalledWith({ provinceId: 1, cityId: 10, barangayId: 100 });
  });

  it("shows a graceful message when a province has no cities yet, rather than an empty dropdown", () => {
    render(
      <ShopLocationFields
        provinces={PROVINCES}
        initialCities={[]}
        initialBarangays={[]}
        initialValue={{ provinceId: 2, cityId: null, barangayId: null }}
        loadCities={vi.fn()}
        loadBarangays={vi.fn()}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByText(/no cities\/municipalities available for this province yet/i)).toBeInTheDocument();
  });

  it("never writes free-text location values -- only numeric ids are ever emitted", () => {
    const onChange = vi.fn();
    render(
      <ShopLocationFields
        provinces={PROVINCES}
        initialCities={[]}
        initialBarangays={[]}
        initialValue={{ provinceId: null, cityId: null, barangayId: null }}
        loadCities={vi.fn().mockResolvedValue([])}
        loadBarangays={vi.fn()}
        onChange={onChange}
      />,
    );

    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "2" } });
    const [call] = onChange.mock.calls;
    expect(typeof call[0].provinceId).toBe("number");
  });
});
