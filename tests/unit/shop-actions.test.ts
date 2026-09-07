import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock, createClientMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  createClientMock: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: createClientMock,
}));

createClientMock.mockReturnValue({ rpc: rpcMock });

import { createShop, updateShop, CREATE_SHOP_ERROR_MESSAGES, type ShopFormInput } from "@/lib/seller/shop-actions";

function input(overrides: Partial<ShopFormInput> = {}): ShopFormInput {
  return {
    name: "Anne's Closet",
    description: "Quality finds",
    provinceId: 1,
    cityId: 2,
    barangayId: null,
    messengerLink: null,
    logoStoragePath: null,
    ...overrides,
  };
}

beforeEach(() => {
  rpcMock.mockReset();
});

describe("createShop", () => {
  it("calls create_shop with exactly the form fields plus p_slug:null when no slug is requested -- no client-supplied owner id", async () => {
    rpcMock.mockResolvedValue({ data: [{ shop_id: "shop-1", slug: "annes-closet", created_at: "2026-01-01T00:00:00.000Z" }], error: null });
    await createShop(input());

    expect(rpcMock).toHaveBeenCalledWith("create_shop", {
      p_name: "Anne's Closet",
      p_description: "Quality finds",
      p_province_id: 1,
      p_city_id: 2,
      p_barangay_id: null,
      p_messenger_link: null,
      p_logo_storage_path: null,
      p_slug: null,
    });
    const args = rpcMock.mock.calls[0][1];
    expect(Object.keys(args)).not.toContain("p_owner_id");
    expect(Object.keys(args)).not.toContain("p_is_trusted_seller");
    expect(Object.keys(args)).not.toContain("p_status");
  });

  it("passes a caller-provided custom slug through as p_slug", async () => {
    rpcMock.mockResolvedValue({ data: [{ shop_id: "shop-1", slug: "custom-url", created_at: "2026-01-01T00:00:00.000Z" }], error: null });
    await createShop(input(), "custom-url");

    expect(rpcMock).toHaveBeenCalledWith("create_shop", expect.objectContaining({ p_slug: "custom-url" }));
  });

  it("omitting the requested slug still lets the server generate one (p_slug: null)", async () => {
    rpcMock.mockResolvedValue({ data: [{ shop_id: "shop-1", slug: "annes-closet", created_at: "2026-01-01T00:00:00.000Z" }], error: null });
    await createShop(input(), null);

    expect(rpcMock).toHaveBeenCalledWith("create_shop", expect.objectContaining({ p_slug: null }));
  });

  it("maps SLUG_INVALID to safe copy", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "denied", details: "SLUG_INVALID" } });
    const result = await createShop(input(), "Not Valid!");
    expect(result).toEqual({ ok: false, code: "SLUG_INVALID" });
  });

  it("maps SLUG_UNAVAILABLE to the exact required safe copy (current or historical collision)", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "denied", details: "SLUG_UNAVAILABLE" } });
    const result = await createShop(input(), "taken-url");
    expect(result).toEqual({ ok: false, code: "SLUG_UNAVAILABLE" });
  });

  it("returns ok:true with the created shop id and slug", async () => {
    rpcMock.mockResolvedValue({ data: [{ shop_id: "shop-1", slug: "annes-closet", created_at: "2026-01-01T00:00:00.000Z" }], error: null });
    const result = await createShop(input());
    expect(result).toEqual({ ok: true, shopId: "shop-1", slug: "annes-closet", createdAt: "2026-01-01T00:00:00.000Z" });
  });

  it("maps SHOP_ALREADY_EXISTS to safe copy (duplicate shop prevented)", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "denied", details: "SHOP_ALREADY_EXISTS" } });
    const result = await createShop(input());
    expect(result).toEqual({ ok: false, code: "SHOP_ALREADY_EXISTS" });
  });

  it("maps location validation errors to safe copy", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "denied", details: "INVALID_CITY_FOR_PROVINCE" } });
    const result = await createShop(input());
    expect(result).toEqual({ ok: false, code: "INVALID_CITY_FOR_PROVINCE" });
  });

  it("maps an unrecognized error detail to UNKNOWN, never leaking a raw postgres error", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "raw postgres error", details: "23505" } });
    const result = await createShop(input());
    expect(result).toEqual({ ok: false, code: "UNKNOWN" });
  });

  it("returns UNKNOWN when the RPC throws", async () => {
    rpcMock.mockRejectedValue(new Error("network down"));
    const result = await createShop(input());
    expect(result).toEqual({ ok: false, code: "UNKNOWN" });
  });

  it("uses the exact required copy for a slug collision", () => {
    expect(CREATE_SHOP_ERROR_MESSAGES.SLUG_UNAVAILABLE).toBe("That shop URL is already taken. Try another one.");
  });
});

describe("updateShop", () => {
  it("calls update_shop with the form fields plus status -- no client-supplied owner id", async () => {
    rpcMock.mockResolvedValue({ data: [{ shop_id: "shop-1", slug: "annes-closet", updated_at: "2026-01-02T00:00:00.000Z" }], error: null });
    await updateShop(input(), "away");

    expect(rpcMock).toHaveBeenCalledWith("update_shop", {
      p_name: "Anne's Closet",
      p_description: "Quality finds",
      p_province_id: 1,
      p_city_id: 2,
      p_barangay_id: null,
      p_messenger_link: null,
      p_logo_storage_path: null,
      p_status: "away",
    });
  });

  it("never sends an owner/user id, a trusted-seller flag, or a slug -- edit mode has no slug-editing surface", async () => {
    rpcMock.mockResolvedValue({ data: [{ shop_id: "shop-1", slug: "annes-closet", updated_at: "2026-01-02T00:00:00.000Z" }], error: null });
    await updateShop(input(), "active");
    const args = rpcMock.mock.calls[0][1];
    expect(Object.keys(args)).not.toContain("p_owner_id");
    expect(Object.keys(args)).not.toContain("p_is_trusted_seller");
    expect(Object.keys(args)).not.toContain("p_trusted_seller_calculated_at");
    expect(Object.keys(args)).not.toContain("p_slug");
  });

  it("maps SHOP_NOT_FOUND to safe copy", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "denied", details: "SHOP_NOT_FOUND" } });
    const result = await updateShop(input(), "active");
    expect(result).toEqual({ ok: false, code: "SHOP_NOT_FOUND" });
  });

  it("maps INVALID_BARANGAY_FOR_CITY to safe copy", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "denied", details: "INVALID_BARANGAY_FOR_CITY" } });
    const result = await updateShop(input(), "active");
    expect(result).toEqual({ ok: false, code: "INVALID_BARANGAY_FOR_CITY" });
  });

  it("returns UNKNOWN when the RPC throws", async () => {
    rpcMock.mockRejectedValue(new Error("network down"));
    const result = await updateShop(input(), "active");
    expect(result).toEqual({ ok: false, code: "UNKNOWN" });
  });
});
