export type PesosParseResult = { ok: true; cents: number | null } | { ok: false };

const PESOS_FORMAT = /^\d+(\.\d{1,2})?$/;

/**
 * Converts a seller-entered pesos string to integer cents without any
 * floating-point arithmetic -- `parseFloat(x) * 100` can drift (e.g.
 * `19.99 * 100 === 1998.9999999999998` in JS); the whole and fractional
 * parts are parsed and combined as integers instead. Blank input is a
 * valid "no price yet" Draft state (`{ ok: true, cents: null }`); ₱0 is a
 * valid price (`{ ok: true, cents: 0 }`). Anything else that isn't a
 * plain non-negative amount with at most 2 decimal places is rejected so
 * the caller can show a field error before ever calling create_listing --
 * the RPC's own PRICE_INVALID/ORIGINAL_PRICE_INVALID checks remain the
 * authoritative validation regardless.
 */
export function parsePesosToCents(value: string): PesosParseResult {
  const trimmed = value.trim();
  if (trimmed === "") return { ok: true, cents: null };
  if (!PESOS_FORMAT.test(trimmed)) return { ok: false };

  const [wholePart, fractionPart = ""] = trimmed.split(".");
  const cents = Number(wholePart) * 100 + Number(fractionPart.padEnd(2, "0").slice(0, 2));
  return { ok: true, cents };
}

/**
 * The inverse of parsePesosToCents, for prefilling an edit form from a
 * stored price -- also integer-only (no `cents / 100` float division used
 * for display), so a value round-trips through parse -> format -> parse
 * exactly. `null` (no price set) displays as an empty input, matching
 * parsePesosToCents' own blank = null convention; ₱0 displays as "0.00",
 * never blank, since it is a real, distinct, valid price.
 */
export function centsToPesosInput(cents: number | null): string {
  if (cents === null) return "";
  const pesos = Math.trunc(cents / 100);
  const centavos = Math.abs(cents % 100)
    .toString()
    .padStart(2, "0");
  return `${pesos}.${centavos}`;
}
