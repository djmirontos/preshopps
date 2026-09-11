import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { getCronSecretMock, createServiceRoleClientMock } = vi.hoisted(() => ({
  getCronSecretMock: vi.fn(),
  createServiceRoleClientMock: vi.fn(),
}));

vi.mock("@/lib/email/env", () => ({ getCronSecret: getCronSecretMock }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: createServiceRoleClientMock }));

import { GET } from "@/app/api/cron/order-expiry-reminders/route";

function makeRequest(headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost:3000/api/cron/order-expiry-reminders", { headers });
}

beforeEach(() => {
  getCronSecretMock.mockReset();
  createServiceRoleClientMock.mockReset();
});

describe("GET /api/cron/order-expiry-reminders", () => {
  it("returns 401 and never touches the database when CRON_SECRET is not configured", async () => {
    getCronSecretMock.mockReturnValue(null);

    const response = await GET(makeRequest({ authorization: "Bearer x" }));

    expect(response.status).toBe(401);
    expect(createServiceRoleClientMock).not.toHaveBeenCalled();
  });

  it("returns 401 on a mismatched secret", async () => {
    getCronSecretMock.mockReturnValue("s3cr3t");

    const response = await GET(makeRequest({ authorization: "Bearer wrong" }));

    expect(response.status).toBe(401);
    expect(createServiceRoleClientMock).not.toHaveBeenCalled();
  });

  it("calls enqueue_pending_order_expiry_reminders via the service-role client and returns the enqueued count", async () => {
    getCronSecretMock.mockReturnValue("s3cr3t");
    const rpc = vi.fn().mockResolvedValue({ data: [{ order_id: "o1" }, { order_id: "o2" }], error: null });
    createServiceRoleClientMock.mockReturnValue({ rpc });

    const response = await GET(makeRequest({ authorization: "Bearer s3cr3t" }));
    const body = await response.json();

    expect(rpc).toHaveBeenCalledWith("enqueue_pending_order_expiry_reminders", { p_limit: 200 });
    expect(response.status).toBe(200);
    expect(body).toEqual({ enqueued: 2 });
  });

  it("returns enqueued: 0 when nothing is eligible", async () => {
    getCronSecretMock.mockReturnValue("s3cr3t");
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null });
    createServiceRoleClientMock.mockReturnValue({ rpc });

    const response = await GET(makeRequest({ authorization: "Bearer s3cr3t" }));
    const body = await response.json();

    expect(body).toEqual({ enqueued: 0 });
  });

  it("returns 500 without leaking the raw database error when the RPC errors", async () => {
    getCronSecretMock.mockReturnValue("s3cr3t");
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "connection reset by peer" } });
    createServiceRoleClientMock.mockReturnValue({ rpc });

    const response = await GET(makeRequest({ authorization: "Bearer s3cr3t" }));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(JSON.stringify(body)).not.toContain("connection reset");
  });
});
