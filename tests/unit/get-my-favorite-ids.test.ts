import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUser } from "@/lib/auth/session";

const { getAuthUserMock, selectMock, eqMock, fromMock } = vi.hoisted(() => {
  const eqMock = vi.fn();
  const selectMock = vi.fn(() => ({ eq: eqMock }));
  const fromMock = vi.fn(() => ({ select: selectMock }));
  return {
    getAuthUserMock: vi.fn<() => Promise<AuthUser | null>>(),
    selectMock,
    eqMock,
    fromMock,
  };
});

vi.mock("@/lib/auth/session", () => ({
  getAuthUser: getAuthUserMock,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ from: fromMock })),
}));

import { getMyFavoriteListingIds } from "@/lib/favorites/get-my-favorite-ids";

describe("getMyFavoriteListingIds", () => {
  beforeEach(() => {
    getAuthUserMock.mockReset();
    fromMock.mockClear();
    selectMock.mockClear();
    eqMock.mockReset();
  });

  it("returns an empty array for a guest without ever querying the database", async () => {
    getAuthUserMock.mockResolvedValue(null);
    await expect(getMyFavoriteListingIds()).resolves.toEqual([]);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("returns the caller's own favorited listing ids for a signed-in user", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: "buyer@example.com" });
    eqMock.mockResolvedValue({
      data: [{ listing_id: "listing-1" }, { listing_id: "listing-2" }],
      error: null,
    });

    await expect(getMyFavoriteListingIds()).resolves.toEqual(["listing-1", "listing-2"]);
    expect(fromMock).toHaveBeenCalledWith("favorites");
    expect(selectMock).toHaveBeenCalledWith("listing_id");
    expect(eqMock).toHaveBeenCalledWith("user_id", "u1");
  });

  it("only ever filters by the server-resolved user id, never a client-supplied one", async () => {
    getAuthUserMock.mockResolvedValue({ id: "server-resolved-id", email: null });
    eqMock.mockResolvedValue({ data: [], error: null });

    await getMyFavoriteListingIds();
    expect(eqMock).toHaveBeenCalledWith("user_id", "server-resolved-id");
  });

  it("returns an empty array (never throws) when the query fails", async () => {
    getAuthUserMock.mockResolvedValue({ id: "u1", email: null });
    eqMock.mockResolvedValue({ data: null, error: { message: "boom" } });

    await expect(getMyFavoriteListingIds()).resolves.toEqual([]);
  });
});
