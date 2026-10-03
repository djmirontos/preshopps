import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock, createClientMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  createClientMock: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: createClientMock,
}));

import { getListingHideState, hideListing, unhideListing } from "@/lib/admin/listing-hide-actions";

const LISTING = "listing-1";
const TS = "2026-01-05T00:00:00.000Z";

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  createClientMock.mockReturnValue({ rpc: rpcMock });
});

describe("getListingHideState -- RPC contract and response validation", () => {
  it("calls admin_get_listing_hide_state with p_listing_id", async () => {
    rpcMock.mockResolvedValue({ data: [{ listing_id: LISTING, hidden_by_admin_at: null }], error: null });
    await getListingHideState(LISTING);
    expect(rpcMock).toHaveBeenCalledWith("admin_get_listing_hide_state", { p_listing_id: LISTING });
  });

  it("a single matching row with null timestamp is visible", async () => {
    rpcMock.mockResolvedValue({ data: [{ listing_id: LISTING, hidden_by_admin_at: null }], error: null });
    expect(await getListingHideState(LISTING)).toEqual({ ok: true, hiddenAt: null });
  });

  it("a single matching row with a valid timestamp is hidden", async () => {
    rpcMock.mockResolvedValue({ data: [{ listing_id: LISTING, hidden_by_admin_at: TS }], error: null });
    expect(await getListingHideState(LISTING)).toEqual({ ok: true, hiddenAt: TS });
  });

  it.each([
    ["empty array", []],
    ["null data", null],
    ["two rows", [{ listing_id: LISTING, hidden_by_admin_at: null }, { listing_id: LISTING, hidden_by_admin_at: null }]],
    ["mismatched listing_id", [{ listing_id: "listing-2", hidden_by_admin_at: null }]],
    ["missing timestamp key", [{ listing_id: LISTING }]],
    ["non-timestamp string", [{ listing_id: LISTING, hidden_by_admin_at: "not a date" }]],
    ["non-string timestamp", [{ listing_id: LISTING, hidden_by_admin_at: 12345 }]],
  ])("%s is a read failure, never visible", async (_label, data) => {
    rpcMock.mockResolvedValue({ data, error: null });
    expect(await getListingHideState(LISTING)).toEqual({ ok: false, code: "UNKNOWN" });
  });

  it("maps a known RPC error detail code", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "x", details: "LISTING_NOT_FOUND" } });
    expect(await getListingHideState(LISTING)).toEqual({ ok: false, code: "LISTING_NOT_FOUND" });
  });
});

describe("hideListing -- RPC contract and response validation", () => {
  it("calls admin_hide_listing with p_listing_id and p_reason", async () => {
    rpcMock.mockResolvedValue({ data: [{ listing_id: LISTING, hidden_by_admin_at: TS, was_already_hidden: false }], error: null });
    await hideListing(LISTING, "Scam.");
    expect(rpcMock).toHaveBeenCalledWith("admin_hide_listing", { p_listing_id: LISTING, p_reason: "Scam." });
  });

  it("a valid fresh hide returns the timestamp and wasAlreadyHidden=false", async () => {
    rpcMock.mockResolvedValue({ data: [{ listing_id: LISTING, hidden_by_admin_at: TS, was_already_hidden: false }], error: null });
    expect(await hideListing(LISTING, "Scam.")).toEqual({ ok: true, listingId: LISTING, hiddenAt: TS, wasAlreadyHidden: false });
  });

  it("a valid idempotent hide returns wasAlreadyHidden=true", async () => {
    rpcMock.mockResolvedValue({ data: [{ listing_id: LISTING, hidden_by_admin_at: TS, was_already_hidden: true }], error: null });
    expect(await hideListing(LISTING, "Scam.")).toMatchObject({ ok: true, wasAlreadyHidden: true });
  });

  it.each([
    ["empty array", []],
    ["two rows", [{ listing_id: LISTING, hidden_by_admin_at: TS, was_already_hidden: false }, { listing_id: LISTING, hidden_by_admin_at: TS, was_already_hidden: false }]],
    ["mismatched listing_id", [{ listing_id: "listing-2", hidden_by_admin_at: TS, was_already_hidden: false }]],
    ["null timestamp on a hide", [{ listing_id: LISTING, hidden_by_admin_at: null, was_already_hidden: false }]],
    ["missing timestamp key", [{ listing_id: LISTING, was_already_hidden: false }]],
    ["invalid timestamp", [{ listing_id: LISTING, hidden_by_admin_at: "garbage", was_already_hidden: false }]],
    ["missing was_already_hidden", [{ listing_id: LISTING, hidden_by_admin_at: TS }]],
    ["string was_already_hidden", [{ listing_id: LISTING, hidden_by_admin_at: TS, was_already_hidden: "false" }]],
  ])("%s is UNKNOWN (unconfirmed), never a success", async (_label, data) => {
    rpcMock.mockResolvedValue({ data, error: null });
    expect(await hideListing(LISTING, "Scam.")).toEqual({ ok: false, code: "UNKNOWN" });
  });

  it("a thrown RPC call is UNKNOWN (unconfirmed), not a failure with a known code", async () => {
    rpcMock.mockRejectedValue(new Error("network down"));
    expect(await hideListing(LISTING, "Scam.")).toEqual({ ok: false, code: "UNKNOWN" });
  });

  it("maps a known RPC error detail code to a definite failure", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "x", details: "NOT_ADMIN" } });
    expect(await hideListing(LISTING, "Scam.")).toEqual({ ok: false, code: "NOT_ADMIN" });
  });
});

describe("unhideListing -- RPC contract and response validation", () => {
  it("calls admin_unhide_listing with p_listing_id and p_note", async () => {
    rpcMock.mockResolvedValue({ data: [{ listing_id: LISTING, hidden_by_admin_at: null, was_already_visible: false }], error: null });
    await unhideListing(LISTING, null);
    expect(rpcMock).toHaveBeenCalledWith("admin_unhide_listing", { p_listing_id: LISTING, p_note: null });
  });

  it("a valid fresh unhide returns wasAlreadyVisible=false", async () => {
    rpcMock.mockResolvedValue({ data: [{ listing_id: LISTING, hidden_by_admin_at: null, was_already_visible: false }], error: null });
    expect(await unhideListing(LISTING, null)).toEqual({ ok: true, listingId: LISTING, wasAlreadyVisible: false });
  });

  it("a valid idempotent unhide returns wasAlreadyVisible=true", async () => {
    rpcMock.mockResolvedValue({ data: [{ listing_id: LISTING, hidden_by_admin_at: null, was_already_visible: true }], error: null });
    expect(await unhideListing(LISTING, null)).toMatchObject({ ok: true, wasAlreadyVisible: true });
  });

  it.each([
    ["empty array", []],
    ["two rows", [{ listing_id: LISTING, hidden_by_admin_at: null, was_already_visible: false }, { listing_id: LISTING, hidden_by_admin_at: null, was_already_visible: false }]],
    ["mismatched listing_id", [{ listing_id: "listing-2", hidden_by_admin_at: null, was_already_visible: false }]],
    ["non-null timestamp on an unhide", [{ listing_id: LISTING, hidden_by_admin_at: TS, was_already_visible: false }]],
    ["missing timestamp key", [{ listing_id: LISTING, was_already_visible: false }]],
    ["missing was_already_visible", [{ listing_id: LISTING, hidden_by_admin_at: null }]],
    ["numeric was_already_visible", [{ listing_id: LISTING, hidden_by_admin_at: null, was_already_visible: 0 }]],
  ])("%s is UNKNOWN (unconfirmed), never a success", async (_label, data) => {
    rpcMock.mockResolvedValue({ data, error: null });
    expect(await unhideListing(LISTING, null)).toEqual({ ok: false, code: "UNKNOWN" });
  });

  it("a thrown RPC call is UNKNOWN (unconfirmed)", async () => {
    rpcMock.mockRejectedValue(new Error("network down"));
    expect(await unhideListing(LISTING, null)).toEqual({ ok: false, code: "UNKNOWN" });
  });
});
