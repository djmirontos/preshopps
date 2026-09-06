// Exactly one leading slash, never a second slash right after it
// (protocol-relative, e.g. //evil.com), and no whitespace/backslash
// (some browsers normalize \\ to // when resolving a URL). Anything with
// a scheme (https://, javascript:, data:, ...) never starts with "/" at
// all, so it's already excluded by the leading-slash requirement.
const SAFE_INTERNAL_PATH = /^\/(?!\/)[^\s\\]*$/;

export const DEFAULT_SAFE_PATH = "/";

/**
 * Validates a `next=` redirect target so auth flows can never be turned
 * into an open redirect. Only an internal, same-origin relative path is
 * ever returned; anything else (absolute URLs, protocol-relative URLs,
 * javascript:/data: schemes, malformed values) falls back to "/".
 */
export function getSafeNextPath(rawValue: string | null | undefined): string {
  const value = rawValue?.trim();
  if (!value) return DEFAULT_SAFE_PATH;
  return SAFE_INTERNAL_PATH.test(value) ? value : DEFAULT_SAFE_PATH;
}
