import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ rpc: rpcMock }),
}));

import { refreshMyCart } from "@/lib/cart/refresh-my-cart-client";

beforeEach(() => {
  rpcMock.mockReset();
});

describe("refreshMyCart", () => {
  it("calls get_my_cart with no arguments and maps rows the same way as the server path", async () => {
    rpcMock.mockResolvedValue({
      data: [
        {
          cart_item_id: "ci-1",
          listing_id: "listing-1",
          public_code: "PLS-ABC",
          slug: "nike",
          title: "Nike Air Max",
          cover_image_storage_path: null,
          price_cents: 100000,
          price_cents_snapshot: 100000,
          price_changed: false,
          status: "available",
          is_inquiry_only: false,
          requested_quantity: 1,
          current_available_quantity: 5,
          is_submittable: true,
          unavailable_reason: null,
          shop_id: "shop-1",
          shop_slug: "annes-closet",
          shop_name: "Anne's Closet",
          fulfillment_methods: ["meetup", "shipping"],
          added_at: "2026-01-01T00:00:00.000Z",
        },
      ],
      error: null,
    });

    const result = await refreshMyCart();

    expect(rpcMock).toHaveBeenCalledWith("get_my_cart");
    expect(result.hadError).toBe(false);
    expect(result.lines).toEqual([
      {
        cartItemId: "ci-1",
        listingId: "listing-1",
        publicCode: "PLS-ABC",
        title: "Nike Air Max",
        imageUrl: undefined,
        priceCents: 100000,
        priceCentsSnapshot: 100000,
        priceChanged: false,
        status: "available",
        isInquiryOnly: false,
        quantity: 1,
        availableQuantity: 5,
        isSubmittable: true,
        unavailableReason: null,
        shopId: "shop-1",
        shopSlug: "annes-closet",
        shopName: "Anne's Closet",
        fulfillmentMethods: ["meetup", "shipping"],
        addedAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
  });

  it("returns hadError: true, empty lines, on an RPC error", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    const result = await refreshMyCart();
    expect(result).toEqual({ lines: [], hadError: true });
  });

  it("returns hadError: true, empty lines, when the RPC throws", async () => {
    rpcMock.mockRejectedValue(new Error("network down"));
    const result = await refreshMyCart();
    expect(result).toEqual({ lines: [], hadError: true });
  });
});
