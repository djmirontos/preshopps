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

createClientMock.mockResolvedValue({ from: fromMock });
fromMock.mockReturnValue({ select: selectMock });
selectMock.mockReturnValue({ maybeSingle: maybeSingleMock });

import { getMyShopProfile } from "@/lib/seller/get-my-shop-profile";

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "shop-1",
    slug: "annes-closet",
    name: "Anne's Closet",
    description: "Quality finds",
    logo_storage_path: null,
    province_id: 1,
    city_id: 2,
    barangay_id: null,
    messenger_link: null,
    status: "active",
    featured_listing_id: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  fromMock.mockReturnValue({ select: selectMock });
  selectMock.mockReturnValue({ maybeSingle: maybeSingleMock });
});

describe("getMyShopProfile", () => {
  it("reads from the shops table directly, relying on shops_select_owner RLS -- no RPC call", async () => {
    maybeSingleMock.mockResolvedValue({ data: row(), error: null });
    await getMyShopProfile();
    expect(fromMock).toHaveBeenCalledWith("shops");
  });

  it("returns null when the caller has no shop (RLS-scoped zero rows)", async () => {
    maybeSingleMock.mockResolvedValue({ data: null, error: null });
    const result = await getMyShopProfile();
    expect(result).toBeNull();
  });

  it("returns null on a query error rather than throwing", async () => {
    maybeSingleMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    const result = await getMyShopProfile();
    expect(result).toBeNull();
  });

  it("maps the full editable shape, including raw location ids (not display names)", async () => {
    maybeSingleMock.mockResolvedValue({
      data: row({ province_id: 5, city_id: 12, barangay_id: 99, messenger_link: "https://m.me/x", status: "away" }),
      error: null,
    });
    const result = await getMyShopProfile();

    expect(result).toEqual({
      id: "shop-1",
      slug: "annes-closet",
      name: "Anne's Closet",
      description: "Quality finds",
      logoStoragePath: null,
      logoUrl: undefined,
      provinceId: 5,
      cityId: 12,
      barangayId: 99,
      messengerLink: "https://m.me/x",
      status: "away",
      featuredListingId: null,
    });
  });
});
