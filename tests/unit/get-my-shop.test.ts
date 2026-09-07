import { beforeEach, describe, expect, it, vi } from "vitest";

const { maybeSingleMock, selectMock, fromMock, createClientMock } = vi.hoisted(() => ({
  maybeSingleMock: vi.fn(),
  selectMock: vi.fn(),
  fromMock: vi.fn(),
  createClientMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: createClientMock,
}));

// Overrides the "no shop" global default mock from
// tests/setup/vitest.setup.ts for this file specifically -- this is the
// one file that needs the real implementation (to test it), not a stub.
vi.mock("@/lib/seller/get-my-shop", async (importOriginal) => {
  return importOriginal<typeof import("@/lib/seller/get-my-shop")>();
});

createClientMock.mockResolvedValue({ from: fromMock });
fromMock.mockReturnValue({ select: selectMock });
selectMock.mockReturnValue({ maybeSingle: maybeSingleMock });

import { getMyShop } from "@/lib/seller/get-my-shop";

beforeEach(() => {
  fromMock.mockClear();
  selectMock.mockClear();
  maybeSingleMock.mockReset();
});

describe("getMyShop", () => {
  it("reads directly from the shops table, relying on shops_select_owner RLS (no shop id argument, no RPC)", async () => {
    maybeSingleMock.mockResolvedValue({ data: { id: "shop-1", slug: "annes-closet", name: "Anne's Closet" }, error: null });
    await getMyShop();
    expect(fromMock).toHaveBeenCalledWith("shops");
    expect(selectMock).toHaveBeenCalledWith("id, slug, name");
  });

  it("returns the shop when the caller owns one", async () => {
    maybeSingleMock.mockResolvedValue({ data: { id: "shop-1", slug: "annes-closet", name: "Anne's Closet" }, error: null });
    const result = await getMyShop();
    expect(result).toEqual({ id: "shop-1", slug: "annes-closet", name: "Anne's Closet" });
  });

  it("returns null when the caller has no shop (zero rows, not an error)", async () => {
    maybeSingleMock.mockResolvedValue({ data: null, error: null });
    const result = await getMyShop();
    expect(result).toBeNull();
  });

  it("returns null on a query error rather than throwing", async () => {
    maybeSingleMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    const result = await getMyShop();
    expect(result).toBeNull();
  });
});
