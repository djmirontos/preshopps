/**
 * PRD 25.5 / ARCHITECTURE.md 17: messages may contain plain-text external
 * links; the UI must warn that Preshopps does not verify third-party
 * sites. This is a display-only heuristic -- it never modifies, strips, or
 * linkifies the message body (URLs remain inert plain text, per the
 * locked "plain text only" rule); it only decides whether to show the
 * warning line beneath a given message.
 */
const URL_PATTERN = /\b(?:https?:\/\/|www\.)\S+/i;

export function containsExternalLink(body: string): boolean {
  return URL_PATTERN.test(body);
}
