import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { getCronSecretMock, createServiceRoleClientMock, processEmailOutboxMock } = vi.hoisted(() => ({
  getCronSecretMock: vi.fn(),
  createServiceRoleClientMock: vi.fn(),
  processEmailOutboxMock: vi.fn(),
}));

vi.mock("@/lib/email/env", () => ({ getCronSecret: getCronSecretMock }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: createServiceRoleClientMock }));
vi.mock("@/lib/email/process-email-outbox", () => ({ processEmailOutbox: processEmailOutboxMock }));

import { GET } from "@/app/api/cron/process-email-outbox/route";

function makeRequest(headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost:3000/api/cron/process-email-outbox", { headers });
}

beforeEach(() => {
  getCronSecretMock.mockReset();
  createServiceRoleClientMock.mockReset();
  processEmailOutboxMock.mockReset();
});

describe("GET /api/cron/process-email-outbox", () => {
  it("returns 401 and never touches the database when CRON_SECRET is not configured", async () => {
    getCronSecretMock.mockReturnValue(null);

    const response = await GET(makeRequest({ authorization: "Bearer anything" }));

    expect(response.status).toBe(401);
    expect(createServiceRoleClientMock).not.toHaveBeenCalled();
    expect(processEmailOutboxMock).not.toHaveBeenCalled();
  });

  it("returns 401 when the Authorization header does not match the configured secret", async () => {
    getCronSecretMock.mockReturnValue("secret123");

    const response = await GET(makeRequest({ authorization: "Bearer wrong" }));

    expect(response.status).toBe(401);
    expect(processEmailOutboxMock).not.toHaveBeenCalled();
  });

  it("returns 401 when no Authorization header is present at all -- no plain browser access", async () => {
    getCronSecretMock.mockReturnValue("secret123");

    const response = await GET(makeRequest());

    expect(response.status).toBe(401);
    expect(processEmailOutboxMock).not.toHaveBeenCalled();
  });

  it("processes the outbox via the service-role client and returns its summary when the secret matches", async () => {
    getCronSecretMock.mockReturnValue("secret123");
    const fakeClient = { rpc: vi.fn() };
    createServiceRoleClientMock.mockReturnValue(fakeClient);
    processEmailOutboxMock.mockResolvedValue({ claimed: 3, sent: 2, failed: 1 });

    const response = await GET(makeRequest({ authorization: "Bearer secret123" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ claimed: 3, sent: 2, failed: 1 });
    expect(processEmailOutboxMock).toHaveBeenCalledWith({ supabase: fakeClient });
  });

  it("returns 500 without leaking the internal error message when processing throws", async () => {
    getCronSecretMock.mockReturnValue("secret123");
    createServiceRoleClientMock.mockReturnValue({ rpc: vi.fn() });
    processEmailOutboxMock.mockRejectedValue(new Error("claim_pending_emails failed: db down"));

    const response = await GET(makeRequest({ authorization: "Bearer secret123" }));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(JSON.stringify(body)).not.toContain("db down");
  });
});
