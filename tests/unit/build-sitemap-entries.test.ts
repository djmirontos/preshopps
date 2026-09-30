import { beforeEach, describe, expect, it, vi } from "vitest";

const rpcMock = vi.fn();

vi.mock("@/lib/supabase/public-client", () => ({
  createPublicClient: vi.fn(() => ({ rpc: rpcMock })),
}));

vi.mock("@/lib/env", () => ({
  getAppUrl: () => "https://preshopps.com",
}));

import { buildSitemapEntries, SitemapEnumerationError } from "@/lib/sitemap/build-sitemap-entries";

type Row = Record<string, unknown>;

function listingRow(overrides: Partial<Row> = {}): Row {
  return {
    listing_id: "11111111-0000-0000-0000-000000000000",
    public_code: "PLS-DEFAULT",
    created_at: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

function shopRow(overrides: Partial<Row> = {}): Row {
  return {
    shop_id: "22222222-0000-0000-0000-000000000000",
    slug: "default-shop",
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

/** Routes the shared rpcMock to a per-function-name handler, so each test
 * only has to describe browse_listings/list_public_shops behavior without
 * re-implementing the other call's plumbing every time. */
function mockRpc(handlers: {
  browse_listings?: (args: Record<string, unknown>) => { data: Row[] | null; error: { message: string } | null };
  list_public_shops?: (args: Record<string, unknown>) => { data: Row[] | null; error: { message: string } | null };
}) {
  rpcMock.mockImplementation(async (fnName: string, args: Record<string, unknown>) => {
    if (fnName === "browse_listings") {
      return handlers.browse_listings?.(args) ?? { data: [], error: null };
    }
    if (fnName === "list_public_shops") {
      return handlers.list_public_shops?.(args) ?? { data: [], error: null };
    }
    throw new Error(`unexpected rpc call: ${fnName}`);
  });
}

/** Builds a paged RPC handler that emits `total` rows, `factory(i)` each,
 * 50 per page (matching PAGE_SIZE), tracking its own cursor position via a
 * closed-over counter -- used by the large-dataset tests below instead of
 * pre-building one giant array up front. */
function makeCountingHandler(total: number, factory: (i: number) => Row) {
  let emitted = 0;
  return () => {
    if (emitted >= total) return { data: [], error: null };
    const take = Math.min(50, total - emitted);
    const rows = Array.from({ length: take }, (_, i) => factory(emitted + i));
    emitted += take;
    return { data: rows, error: null };
  };
}

function bulkListingRow(i: number): Row {
  return listingRow({
    listing_id: `listing-bulk-${String(i).padStart(7, "0")}`,
    public_code: `PLS-BULK-${i}`,
    created_at: new Date(2026, 0, 1, 0, 0, 0, 999_999 - i).toISOString(),
  });
}

function bulkShopRow(i: number): Row {
  return shopRow({
    shop_id: `shop-bulk-${String(i).padStart(7, "0")}`,
    slug: `shop-bulk-${i}`,
    created_at: new Date(2025, 0, 1, 0, 0, 0, 999_999 - i).toISOString(),
    updated_at: new Date(2025, 0, 1, 0, 0, 0, 999_999 - i).toISOString(),
  });
}

beforeEach(() => {
  rpcMock.mockReset();
});

describe("buildSitemapEntries: multi-page completeness", () => {
  it("walks browse_listings across multiple pages until a short page ends the walk, returning every row", async () => {
    const page1 = Array.from({ length: 50 }, (_, i) =>
      listingRow({
        listing_id: `11111111-0000-0000-0000-${String(i).padStart(12, "0")}`,
        public_code: `PLS-PAGE1-${i}`,
        created_at: new Date(2026, 8, 30, 0, 0, 50 - i).toISOString(),
      }),
    );
    const page2 = [
      listingRow({ listing_id: "11111111-0000-0000-0000-999999999999", public_code: "PLS-PAGE2-0", created_at: "2026-09-29T23:59:00.000Z" }),
    ];

    mockRpc({
      browse_listings: (args) => (args.p_before_id === null ? { data: page1, error: null } : { data: page2, error: null }),
    });

    const entries = await buildSitemapEntries();
    const itemUrls = entries.filter((e) => e.url.includes("/item/"));
    expect(itemUrls).toHaveLength(51);
    expect(itemUrls.map((e) => e.url)).toContain("https://preshopps.com/item/PLS-PAGE1-0");
    expect(itemUrls.map((e) => e.url)).toContain("https://preshopps.com/item/PLS-PAGE2-0");
  });

  it("walks list_public_shops across multiple pages the same way", async () => {
    const page1 = Array.from({ length: 50 }, (_, i) =>
      shopRow({
        shop_id: `22222222-0000-0000-0000-${String(i).padStart(12, "0")}`,
        slug: `shop-page1-${i}`,
        created_at: new Date(2026, 8, 30, 0, 0, 50 - i).toISOString(),
        updated_at: new Date(2026, 8, 30, 0, 0, 50 - i).toISOString(),
      }),
    );
    const page2 = [shopRow({ shop_id: "22222222-0000-0000-0000-999999999999", slug: "shop-page2-0" })];

    mockRpc({
      list_public_shops: (args) => (args.p_before_id === null ? { data: page1, error: null } : { data: page2, error: null }),
    });

    const entries = await buildSitemapEntries();
    const shopUrls = entries.filter((e) => e.url.includes("/shop/"));
    expect(shopUrls).toHaveLength(51);
    expect(shopUrls.map((e) => e.url)).toContain("https://preshopps.com/shop/shop-page1-0");
    expect(shopUrls.map((e) => e.url)).toContain("https://preshopps.com/shop/shop-page2-0");
  });

  it("stops after a single short page without requesting a further page", async () => {
    mockRpc({
      browse_listings: () => ({ data: [listingRow()], error: null }),
    });

    await buildSitemapEntries();
    const browseCalls = rpcMock.mock.calls.filter(([fn]) => fn === "browse_listings");
    expect(browseCalls).toHaveLength(1);
  });
});

describe("buildSitemapEntries: shops without listings", () => {
  it("includes a shop's URL even when browse_listings returns zero rows at all", async () => {
    mockRpc({
      browse_listings: () => ({ data: [], error: null }),
      list_public_shops: () => ({ data: [shopRow({ slug: "shop-with-no-listings" })], error: null }),
    });

    const entries = await buildSitemapEntries();
    expect(entries.map((e) => e.url)).toContain("https://preshopps.com/shop/shop-with-no-listings");
    expect(entries.filter((e) => e.url.includes("/item/"))).toHaveLength(0);
  });
});

describe("buildSitemapEntries: canonical URLs", () => {
  it("builds listing URLs as {appUrl}/item/{publicCode} using getAppUrl()", async () => {
    mockRpc({
      browse_listings: () => ({ data: [listingRow({ public_code: "PLS-CANON1" })], error: null }),
    });

    const entries = await buildSitemapEntries();
    const entry = entries.find((e) => e.url.includes("PLS-CANON1"));
    expect(entry?.url).toBe("https://preshopps.com/item/PLS-CANON1");
  });

  it("builds shop URLs as {appUrl}/shop/{currentSlug} using getAppUrl()", async () => {
    mockRpc({
      list_public_shops: () => ({ data: [shopRow({ slug: "canonical-shop" })], error: null }),
    });

    const entries = await buildSitemapEntries();
    const entry = entries.find((e) => e.url.includes("canonical-shop"));
    expect(entry?.url).toBe("https://preshopps.com/shop/canonical-shop");
  });

  it("includes the homepage exactly once, at the bare app URL", async () => {
    mockRpc({});
    const entries = await buildSitemapEntries();
    expect(entries.filter((e) => e.url === "https://preshopps.com")).toHaveLength(1);
  });

  it("omits lastModified entirely for listing entries -- browse_listings exposes only created_at (creation time, not a real edit signal), never surfaced as lastModified", async () => {
    mockRpc({
      browse_listings: () => ({ data: [listingRow({ public_code: "PLS-LM", created_at: "2026-01-15T00:00:00.000Z" })], error: null }),
    });

    const entries = await buildSitemapEntries();
    const entry = entries.find((e) => e.url.includes("PLS-LM"));
    expect(entry).toBeDefined();
    expect(entry?.lastModified).toBeUndefined();
    expect(Object.keys(entry!)).toEqual(["url"]);
  });

  it("sets shop lastModified from updated_at (a real, moddatetime-maintained timestamp), never created_at or a generated 'now'", async () => {
    mockRpc({
      list_public_shops: () => ({
        data: [shopRow({ slug: "shop-lm", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-02-02T00:00:00.000Z" })],
        error: null,
      }),
    });

    const entries = await buildSitemapEntries();
    const entry = entries.find((e) => e.url.includes("shop-lm"));
    expect(entry?.lastModified).toEqual(new Date("2026-02-02T00:00:00.000Z"));
  });
});

describe("buildSitemapEntries: exclusions", () => {
  it("never includes a /search URL", async () => {
    mockRpc({
      browse_listings: () => ({ data: [listingRow()], error: null }),
      list_public_shops: () => ({ data: [shopRow()], error: null }),
    });

    const entries = await buildSitemapEntries();
    expect(entries.some((e) => e.url.includes("/search"))).toBe(false);
  });

  it("calls browse_listings in global mode (no p_shop_id) -- the only mode whose own WHERE clause admits status = 'available' only, structurally excluding reserved/sold/archived/paused/draft", async () => {
    mockRpc({
      browse_listings: () => ({ data: [listingRow()], error: null }),
    });

    await buildSitemapEntries();
    const [, args] = rpcMock.mock.calls.find(([fn]) => fn === "browse_listings")!;
    expect(args).not.toHaveProperty("p_shop_id");
  });
});

describe("buildSitemapEntries: deduplication", () => {
  it("throws if two distinct, properly-paginated rows would still produce the same URL", async () => {
    mockRpc({
      browse_listings: () => ({
        data: [
          listingRow({ listing_id: "aaaa0000-0000-0000-0000-000000000001", public_code: "PLS-DUPE", created_at: "2026-09-01T00:00:01.000Z" }),
          listingRow({ listing_id: "aaaa0000-0000-0000-0000-000000000002", public_code: "PLS-DUPE", created_at: "2026-09-01T00:00:00.000Z" }),
        ],
        error: null,
      }),
    });

    await expect(buildSitemapEntries()).rejects.toThrow(SitemapEnumerationError);
  });
});

describe("buildSitemapEntries: later-page failure handling", () => {
  it("throws instead of returning a partial sitemap when a later page's RPC call errors", async () => {
    const page1 = Array.from({ length: 50 }, (_, i) =>
      listingRow({
        listing_id: `bbbb0000-0000-0000-0000-${String(i).padStart(12, "0")}`,
        public_code: `PLS-OK-${i}`,
        created_at: new Date(2026, 8, 30, 0, 0, 50 - i).toISOString(),
      }),
    );

    mockRpc({
      browse_listings: (args) =>
        args.p_before_id === null ? { data: page1, error: null } : { data: null, error: { message: "connection reset" } },
    });

    await expect(buildSitemapEntries()).rejects.toThrow(/browse_listings failed while building the sitemap/);
  });

  it("throws instead of returning a partial sitemap when a later page's RPC call throws", async () => {
    const page1 = Array.from({ length: 50 }, (_, i) =>
      shopRow({
        shop_id: `cccc0000-0000-0000-0000-${String(i).padStart(12, "0")}`,
        slug: `shop-ok-${i}`,
        created_at: new Date(2026, 8, 30, 0, 0, 50 - i).toISOString(),
      }),
    );

    let call = 0;
    rpcMock.mockImplementation(async (fnName: string) => {
      if (fnName === "browse_listings") return { data: [], error: null };
      call += 1;
      if (call === 1) return { data: page1, error: null };
      throw new Error("network down");
    });

    await expect(buildSitemapEntries()).rejects.toThrow("network down");
  });
});

describe("buildSitemapEntries: cursor non-progression / infinite-loop guard", () => {
  it("throws and stops calling the RPC if the cursor never advances between full pages", async () => {
    const stuckPage = Array.from({ length: 50 }, (_, i) =>
      listingRow({
        listing_id: `dddd0000-0000-0000-0000-${String(i).padStart(12, "0")}`,
        public_code: `PLS-STUCK-${i}`,
        created_at: "2026-09-01T00:00:00.000Z",
      }),
    );

    mockRpc({
      browse_listings: () => ({ data: stuckPage, error: null }),
    });

    await expect(buildSitemapEntries()).rejects.toThrow(/cursor did not advance/);
    const browseCalls = rpcMock.mock.calls.filter(([fn]) => fn === "browse_listings");
    expect(browseCalls.length).toBeLessThan(5);
  });
});

describe("buildSitemapEntries: per-RPC row-count bound (a loop/work bound only, not the sitemap-wide limit)", () => {
  it("throws once a single dataset exceeds the configured per-RPC row cap, rather than silently truncating the sitemap", async () => {
    let counter = 0;
    // Safety cap independent of the guard under test: if the guard were
    // ever broken, this test must fail fast (an unmet "rejects" assertion)
    // rather than hang forever paging a mock with no natural end.
    const HARD_STOP_ROWS = 60_000;
    mockRpc({
      browse_listings: () => {
        if (counter >= HARD_STOP_ROWS) return { data: [], error: null };
        const base = counter;
        counter += 50;
        const rows = Array.from({ length: 50 }, (_, i) => {
          const n = base + i;
          return listingRow({
            listing_id: `eeee0000-0000-0000-0000-${String(n).padStart(12, "0")}`,
            public_code: `PLS-BULK-${n}`,
            created_at: new Date(2026, 0, 1, 0, 0, 0, 999999 - n).toISOString(),
          });
        });
        return { data: rows, error: null };
      },
    });

    await expect(buildSitemapEntries()).rejects.toThrow(/more than .* rows/);
    // Bounded well short of "infinite": the cap is 45,000 rows at 50/page,
    // so this should trip in roughly 900 calls, not run away indefinitely.
    const browseCalls = rpcMock.mock.calls.filter(([fn]) => fn === "browse_listings");
    expect(browseCalls.length).toBeLessThan(1000);
  });
});

describe("buildSitemapEntries: combined sitemap-wide 50,000-URL limit (not the per-RPC bound)", () => {
  it("regression: each dataset individually stays under the per-RPC cap (45,000), but their combined total (plus the homepage) exceeds the sitemap limit -- must still throw", async () => {
    // 1 (homepage) + 20,000 (listings) + 30,000 (shops) = 50,001 -- one over
    // the limit -- while 20,000 and 30,000 are each comfortably under the
    // 45,000 per-RPC bound on their own. If only the per-RPC bound existed,
    // this would incorrectly succeed.
    mockRpc({
      browse_listings: makeCountingHandler(20_000, bulkListingRow),
      list_public_shops: makeCountingHandler(30_000, bulkShopRow),
    });

    // A single call: the counting handlers above carry their own internal
    // state, so a second call would resume from an already-exhausted
    // position rather than re-running the scenario -- both assertions
    // below are checked against the one resulting rejection instead.
    let caught: unknown;
    try {
      await buildSitemapEntries();
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(SitemapEnumerationError);
    expect((caught as Error).message).toMatch(/50,?001/);
    expect((caught as Error).message).toMatch(/exceeding the 50000-URL/);
  });

  it("valid boundary: exactly 50,000 total URLs (homepage + listings + shops) does not throw", async () => {
    // 1 (homepage) + 20,000 (listings) + 29,999 (shops) = 50,000 exactly.
    mockRpc({
      browse_listings: makeCountingHandler(20_000, bulkListingRow),
      list_public_shops: makeCountingHandler(29_999, bulkShopRow),
    });

    const entries = await buildSitemapEntries();
    expect(entries).toHaveLength(50_000);
  });
});
