/**
 * Masks an email address for display only -- e.g. "daniel@gmail.com" ->
 * "d***@gmail.com". Never used for anything but on-screen copy; the real,
 * unmasked email is always what's actually sent to verifyOtp()/resend().
 * Malformed input (no "@", or "@" as the very first character) is
 * returned as-is rather than guessed at.
 */
export function maskEmail(email: string): string {
  const atIndex = email.indexOf("@");
  if (atIndex <= 0) return email;

  const localPart = email.slice(0, atIndex);
  const domain = email.slice(atIndex);
  return `${localPart[0]}***${domain}`;
}
