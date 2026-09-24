/**
 * Reservation reference codes: RAR-YYYYMMDD-XXXX (generated in the database). The suffix
 * alphabet is Crockford base32 without I, L, O, U, so codes are easy to read aloud.
 */

export const REFERENCE_PATTERN = /^RAR-\d{8}-[0-9A-HJKMNP-TV-Z]{4}$/;

/**
 * Normalizes what a person might type or paste ("rar-20261001-a7f4 ", "RAR 20261001 A7F4")
 * into the canonical form, or returns null if it can't be a reference code.
 */
export function normalizeReference(input: string): string | null {
  const compact = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const match = /^RAR(\d{8})([0-9A-Z]{4})$/.exec(compact);
  if (!match) return null;
  // Readers often confuse O/0 and I/L/1; map them like Crockford base32 does.
  const suffix = match[2].replace(/O/g, "0").replace(/[IL]/g, "1");
  const code = `RAR-${match[1]}-${suffix}`;
  return REFERENCE_PATTERN.test(code) ? code : null;
}
