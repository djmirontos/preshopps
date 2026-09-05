import { beforeEach, describe, expect, it, vi } from "vitest";

type QueryResult = { data: unknown; error: { message: string } | null };

function makeQueryBuilder(result: QueryResult) {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  builder.select = vi.fn(chain);
  builder.order = vi.fn(async () => result);
  builder.eq = vi.fn(chain);
  builder.maybeSingle = vi.fn(async () => result);
  return builder;
}

const fromMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ from: fromMock })),
}));

import { getCategories, getProvinces, resolveLocationContext } from "@/lib/marketplace/reference-data";

describe("reference-data", () => {
  beforeEach(() => {
    fromMock.mockReset();
  });

  it("getCategories returns the live rows in order", async () => {
    fromMock.mockReturnValue(
      makeQueryBuilder({ data: [{ id: 1, slug: "women", name: "Women" }], error: null }),
    );
    const categories = await getCategories();
    expect(categories).toEqual([{ id: 1, slug: "women", name: "Women" }]);
    expect(fromMock).toHaveBeenCalledWith("categories");
  });

  it("getCategories fails safe (empty array, no throw) on a query error", async () => {
    fromMock.mockReturnValue(makeQueryBuilder({ data: null, error: { message: "boom" } }));
    await expect(getCategories()).resolves.toEqual([]);
  });

  it("getProvinces fails safe on error", async () => {
    fromMock.mockReturnValue(makeQueryBuilder({ data: null, error: { message: "boom" } }));
    await expect(getProvinces()).resolves.toEqual([]);
  });

  it("resolveLocationContext resolves a lone barangay id up to its city and province", async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === "barangays") return makeQueryBuilder({ data: { city_id: 12 }, error: null });
      if (table === "cities_municipalities") return makeQueryBuilder({ data: { province_id: 3 }, error: null });
      throw new Error(`unexpected table ${table}`);
    });

    const resolved = await resolveLocationContext({ provinceId: null, cityId: null, barangayId: 45 });
    expect(resolved).toEqual({ provinceId: 3, cityId: 12, barangayId: 45 });
  });

  it("resolveLocationContext drops an unresolvable barangay id instead of throwing", async () => {
    fromMock.mockReturnValue(makeQueryBuilder({ data: null, error: null }));

    const resolved = await resolveLocationContext({ provinceId: null, cityId: null, barangayId: 999 });
    expect(resolved).toEqual({ provinceId: null, cityId: null, barangayId: null });
  });

  it("resolveLocationContext leaves a fully-specified location untouched (no lookups needed)", async () => {
    const resolved = await resolveLocationContext({ provinceId: 3, cityId: 12, barangayId: 45 });
    expect(resolved).toEqual({ provinceId: 3, cityId: 12, barangayId: 45 });
    expect(fromMock).not.toHaveBeenCalled();
  });
});
