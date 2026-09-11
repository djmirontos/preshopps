import "server-only";

function readOptionalEnvVar(value: string | undefined): string | null {
  if (!value || value.trim() === "") return null;
  return value.trim();
}

// Absent until a real Resend account/domain is configured -- callers must
// treat null as "email delivery is disabled," never throw.
export function getResendApiKey(): string | null {
  return readOptionalEnvVar(process.env.RESEND_API_KEY);
}

// Non-throwing: callers on the send path must treat null as "email
// delivery is disabled" (see isEmailProviderConfigured), never throw --
// a missing sender address is provider misconfiguration, not a bug.
export function getEmailFromAddressOrNull(): string | null {
  return readOptionalEnvVar(process.env.EMAIL_FROM_ADDRESS);
}

/**
 * True only when every variable actual delivery needs is present. Checked
 * by the processor BEFORE claiming any email_outbox row -- missing
 * configuration must never be treated as a delivery attempt (it would
 * otherwise consume one of the bounded 5 retry attempts and could drive a
 * row to a terminal 'failed' state for a reason that has nothing to do
 * with that specific email).
 */
export function isEmailProviderConfigured(): boolean {
  return getResendApiKey() !== null && getEmailFromAddressOrNull() !== null;
}

/**
 * Dev/preview-only recipient override, for testing without emailing real
 * users. Never applied when NODE_ENV === "production", regardless of
 * whether this variable is set -- a hard safety rail, not a toggle.
 */
export function getTestRecipientOverride(): string | null {
  if (process.env.NODE_ENV === "production") return null;
  return readOptionalEnvVar(process.env.EMAIL_TEST_RECIPIENT_OVERRIDE);
}

// Shared secret for the two cron-invoked route handlers. Absent by
// default -- both routes fail closed (401) when this is not configured,
// never open by default.
export function getCronSecret(): string | null {
  return readOptionalEnvVar(process.env.CRON_SECRET);
}
