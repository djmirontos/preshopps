import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { verifyOtpMock, exchangeCodeForSessionMock } = vi.hoisted(() => ({
  verifyOtpMock: vi.fn(),
  exchangeCodeForSessionMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      verifyOtp: verifyOtpMock,
      exchangeCodeForSession: exchangeCodeForSessionMock,
    },
  }),
}));

import { GET } from "@/app/auth/confirm/route";

function makeRequest(query: string) {
  return new NextRequest(`http://localhost:3000/auth/confirm${query}`);
}

function locationOf(response: Response) {
  return response.headers.get("location") ?? "";
}

describe("GET /auth/confirm", () => {
  beforeEach(() => {
    verifyOtpMock.mockReset();
    exchangeCodeForSessionMock.mockReset();
  });

  it("calls verifyOtp when token_hash and a valid, supported type are present", async () => {
    verifyOtpMock.mockResolvedValue({ error: null });
    await GET(makeRequest("?token_hash=abc123&type=signup&next=/account"));
    expect(verifyOtpMock).toHaveBeenCalledWith({ type: "signup", token_hash: "abc123" });
  });

  it("redirects to the validated next path after a successful verifyOtp", async () => {
    verifyOtpMock.mockResolvedValue({ error: null });
    const response = await GET(makeRequest("?token_hash=abc123&type=recovery&next=/account"));
    expect(locationOf(response)).toBe("http://localhost:3000/account");
  });

  it("produces safe invalid-link behavior when verifyOtp fails", async () => {
    verifyOtpMock.mockResolvedValue({ error: new Error("Token has expired") });
    const response = await GET(makeRequest("?token_hash=abc123&type=signup"));
    expect(locationOf(response)).toBe("http://localhost:3000/sign-in?auth_error=invalid_link");
  });

  it("calls exchangeCodeForSession when a code is present (no token_hash)", async () => {
    exchangeCodeForSessionMock.mockResolvedValue({ error: null });
    await GET(makeRequest("?code=pkce-code-123&next=/item/PSO-ABC"));
    expect(exchangeCodeForSessionMock).toHaveBeenCalledWith("pkce-code-123");
  });

  it("redirects to the validated next path after a successful code exchange", async () => {
    exchangeCodeForSessionMock.mockResolvedValue({ error: null });
    const response = await GET(makeRequest("?code=pkce-code-123&next=/item/PSO-ABC"));
    expect(locationOf(response)).toBe("http://localhost:3000/item/PSO-ABC");
  });

  it("produces safe invalid-link behavior when the code exchange fails", async () => {
    exchangeCodeForSessionMock.mockResolvedValue({ error: new Error("invalid code") });
    const response = await GET(makeRequest("?code=bad-code"));
    expect(locationOf(response)).toBe("http://localhost:3000/sign-in?auth_error=invalid_link");
  });

  it("treats neither code nor token_hash as invalid, never as a silent success", async () => {
    const response = await GET(makeRequest("?next=/account"));
    expect(locationOf(response)).toBe("http://localhost:3000/sign-in?auth_error=invalid_link");
    expect(verifyOtpMock).not.toHaveBeenCalled();
    expect(exchangeCodeForSessionMock).not.toHaveBeenCalled();
  });

  it("does not blindly pass an arbitrary/unsupported type through to verifyOtp", async () => {
    const response = await GET(makeRequest("?token_hash=abc123&type=totally_made_up"));
    expect(verifyOtpMock).not.toHaveBeenCalled();
    expect(exchangeCodeForSessionMock).not.toHaveBeenCalled();
    expect(locationOf(response)).toBe("http://localhost:3000/sign-in?auth_error=invalid_link");
  });

  it("rejects a malicious next and falls back to / even on a successful verification", async () => {
    verifyOtpMock.mockResolvedValue({ error: null });
    const response = await GET(makeRequest("?token_hash=abc123&type=signup&next=https://evil.com"));
    expect(locationOf(response)).toBe("http://localhost:3000/");
  });

  it("prefers a valid token_hash+type over code when both are present", async () => {
    verifyOtpMock.mockResolvedValue({ error: null });
    await GET(makeRequest("?token_hash=abc123&type=signup&code=pkce-code-123"));
    expect(verifyOtpMock).toHaveBeenCalled();
    expect(exchangeCodeForSessionMock).not.toHaveBeenCalled();
  });

  it("falls back to the code flow when type is unsupported but a code is also present", async () => {
    exchangeCodeForSessionMock.mockResolvedValue({ error: null });
    await GET(makeRequest("?token_hash=abc123&type=totally_made_up&code=pkce-code-123&next=/account"));
    expect(verifyOtpMock).not.toHaveBeenCalled();
    expect(exchangeCodeForSessionMock).toHaveBeenCalledWith("pkce-code-123");
  });

  it("never exposes the token, code, or raw error in the redirect", async () => {
    verifyOtpMock.mockResolvedValue({ error: new Error("Some raw postgres detail: relation xyz") });
    const response = await GET(makeRequest("?token_hash=super-secret-token&type=signup"));
    const location = locationOf(response);
    expect(location).not.toContain("super-secret-token");
    expect(location).not.toContain("postgres");
    expect(location).not.toContain("relation");
  });
});
