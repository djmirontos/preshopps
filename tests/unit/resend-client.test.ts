// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { sendMock, ResendMock } = vi.hoisted(() => {
  const sendMock = vi.fn();
  // A plain function (not an arrow function) so `new Resend(apiKey)` works
  // -- arrow functions can never be used as a constructor.
  const ResendMock = vi.fn().mockImplementation(function ResendConstructorMock() {
    return { emails: { send: sendMock } };
  });
  return { sendMock, ResendMock };
});

// Resolves to an empty module in Next.js's server bundle via the
// "react-server" export condition, which plain Node/Vitest doesn't set.
vi.mock("server-only", () => ({}));

vi.mock("resend", () => ({ Resend: ResendMock }));

vi.mock("@/lib/email/env", () => ({
  getResendApiKey: vi.fn(),
  getEmailFromAddressOrNull: vi.fn(),
  getTestRecipientOverride: vi.fn(),
}));

import { sendEmailViaResend } from "@/lib/email/resend-client";
import { getResendApiKey, getEmailFromAddressOrNull, getTestRecipientOverride } from "@/lib/email/env";

beforeEach(() => {
  sendMock.mockReset();
  ResendMock.mockClear();
  vi.mocked(getResendApiKey).mockReset();
  vi.mocked(getEmailFromAddressOrNull).mockReset();
  vi.mocked(getTestRecipientOverride).mockReset();
});

describe("sendEmailViaResend", () => {
  it("returns reason: not_configured without ever constructing a Resend client when RESEND_API_KEY is unset", async () => {
    vi.mocked(getResendApiKey).mockReturnValue(null);
    vi.mocked(getEmailFromAddressOrNull).mockReturnValue("Preshopps <no-reply@preshopps.com>");

    const result = await sendEmailViaResend({ to: "a@example.com", subject: "s", html: "<p>h</p>", text: "h" });

    expect(result).toEqual({ ok: false, reason: "not_configured", error: expect.stringContaining("not configured") });
    expect(ResendMock).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("returns reason: not_configured without ever constructing a Resend client when EMAIL_FROM_ADDRESS is unset, even with a valid API key", async () => {
    vi.mocked(getResendApiKey).mockReturnValue("re_test_key");
    vi.mocked(getEmailFromAddressOrNull).mockReturnValue(null);

    const result = await sendEmailViaResend({ to: "a@example.com", subject: "s", html: "<p>h</p>", text: "h" });

    expect(result).toEqual({ ok: false, reason: "not_configured", error: expect.stringContaining("not configured") });
    expect(ResendMock).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("calls the Resend SDK with the configured API key and from address", async () => {
    vi.mocked(getResendApiKey).mockReturnValue("re_test_key");
    vi.mocked(getEmailFromAddressOrNull).mockReturnValue("Preshopps <no-reply@preshopps.com>");
    vi.mocked(getTestRecipientOverride).mockReturnValue(null);
    sendMock.mockResolvedValue({ data: { id: "abc" }, error: null });

    const result = await sendEmailViaResend({ to: "buyer@example.com", subject: "Hi", html: "<p>hi</p>", text: "hi" });

    expect(ResendMock).toHaveBeenCalledWith("re_test_key");
    expect(sendMock).toHaveBeenCalledWith({
      from: "Preshopps <no-reply@preshopps.com>",
      to: "buyer@example.com",
      subject: "Hi",
      html: "<p>hi</p>",
      text: "hi",
    });
    expect(result).toEqual({ ok: true });
  });

  it("redirects to the test recipient override when set", async () => {
    vi.mocked(getResendApiKey).mockReturnValue("re_test_key");
    vi.mocked(getEmailFromAddressOrNull).mockReturnValue("Preshopps <no-reply@preshopps.com>");
    vi.mocked(getTestRecipientOverride).mockReturnValue("dev-inbox@example.com");
    sendMock.mockResolvedValue({ data: { id: "abc" }, error: null });

    await sendEmailViaResend({ to: "real-user@example.com", subject: "s", html: "h", text: "h" });

    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({ to: "dev-inbox@example.com" }));
  });

  it("never overrides the recipient when getTestRecipientOverride returns null (its own production guard lives in env.ts)", async () => {
    vi.mocked(getResendApiKey).mockReturnValue("re_test_key");
    vi.mocked(getEmailFromAddressOrNull).mockReturnValue("Preshopps <no-reply@preshopps.com>");
    vi.mocked(getTestRecipientOverride).mockReturnValue(null);
    sendMock.mockResolvedValue({ data: { id: "abc" }, error: null });

    await sendEmailViaResend({ to: "real-user@example.com", subject: "s", html: "h", text: "h" });

    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({ to: "real-user@example.com" }));
  });

  it("returns reason: provider_error (never throws) when Resend responds with an error -- a genuine delivery attempt", async () => {
    vi.mocked(getResendApiKey).mockReturnValue("re_test_key");
    vi.mocked(getEmailFromAddressOrNull).mockReturnValue("Preshopps <no-reply@preshopps.com>");
    vi.mocked(getTestRecipientOverride).mockReturnValue(null);
    sendMock.mockResolvedValue({ data: null, error: { message: "invalid_from_address", statusCode: 422, name: "invalid_from_address" } });

    const result = await sendEmailViaResend({ to: "a@example.com", subject: "s", html: "h", text: "h" });
    expect(result).toEqual({ ok: false, reason: "provider_error", error: "invalid_from_address" });
    expect(sendMock).toHaveBeenCalled();
  });

  it("returns reason: provider_error when the SDK call itself throws -- a genuine delivery attempt", async () => {
    vi.mocked(getResendApiKey).mockReturnValue("re_test_key");
    vi.mocked(getEmailFromAddressOrNull).mockReturnValue("Preshopps <no-reply@preshopps.com>");
    vi.mocked(getTestRecipientOverride).mockReturnValue(null);
    sendMock.mockRejectedValue(new Error("network error"));

    const result = await sendEmailViaResend({ to: "a@example.com", subject: "s", html: "h", text: "h" });
    expect(result).toEqual({ ok: false, reason: "provider_error", error: "network error" });
  });

  it("never sends a real network request in this test file -- the resend module is fully mocked", () => {
    expect(vi.isMockFunction(ResendMock)).toBe(true);
    expect(vi.isMockFunction(sendMock)).toBe(true);
  });
});
