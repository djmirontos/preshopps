import "server-only";
import { Resend } from "resend";
import { getResendApiKey, getEmailFromAddressOrNull, getTestRecipientOverride } from "./env";

export type SendEmailParams = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

/**
 * `reason` distinguishes "we never actually attempted delivery" (missing
 * RESEND_API_KEY/EMAIL_FROM_ADDRESS) from "we attempted delivery and the
 * provider rejected/errored." Callers (processEmailOutbox) must treat
 * these differently: "not_configured" must never consume one of the
 * bounded retry attempts or drive a row toward terminal 'failed', while
 * "provider_error" is a genuine attempt and uses the normal bounded
 * retry/backoff strategy.
 */
export type SendEmailResult =
  | { ok: true }
  | { ok: false; reason: "not_configured"; error: string }
  | { ok: false; reason: "provider_error"; error: string };

/**
 * Thin, mockable wrapper around the Resend SDK -- the only place in this
 * codebase that talks to the email provider. Every test mocks this whole
 * module; no unit test ever reaches the real network.
 *
 * Returns { ok: false, reason: "not_configured" } (never throws, never
 * calls the SDK) when RESEND_API_KEY or EMAIL_FROM_ADDRESS is missing --
 * this is not a delivery attempt. In normal operation this branch is
 * unreachable, because processEmailOutbox already checks
 * isEmailProviderConfigured() before ever claiming a row; it exists here
 * as defense-in-depth for any other caller.
 */
export async function sendEmailViaResend(params: SendEmailParams): Promise<SendEmailResult> {
  const apiKey = getResendApiKey();
  const from = getEmailFromAddressOrNull();

  if (!apiKey || !from) {
    return {
      ok: false,
      reason: "not_configured",
      error: "Email provider is not configured (RESEND_API_KEY and/or EMAIL_FROM_ADDRESS is missing).",
    };
  }

  const override = getTestRecipientOverride();
  const to = override ?? params.to;

  try {
    const resend = new Resend(apiKey);
    const { error } = await resend.emails.send({
      from,
      to,
      subject: params.subject,
      html: params.html,
      text: params.text,
    });

    if (error) {
      return { ok: false, reason: "provider_error", error: error.message };
    }

    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: "provider_error",
      error: err instanceof Error ? err.message : "Unknown error calling the email provider.",
    };
  }
}
