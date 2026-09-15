/**
 * UX-only mirror of update_my_profile's own mobile-number acceptance
 * shape (0092_account_profile_management.sql): PH local format
 * (09XXXXXXXXX) or an already-E.164-shaped number. The RPC remains the
 * authoritative validator/normalizer -- this only decides whether to
 * show a client-side error before ever calling it, so a network round
 * trip isn't required just to catch an obviously malformed number.
 */
export function isPlausibleMobileNumber(trimmedValue: string): boolean {
  if (/^09\d{9}$/.test(trimmedValue)) return true;
  if (/^\+[1-9]\d{7,14}$/.test(trimmedValue)) return true;
  return false;
}
