/**
 * Builds RFC 5322 "Display Name <address>" values. RESEND_FROM_EMAIL may be a bare address
 * or already carry a name; the display name comes from Settings (email_sender_name) so a
 * Super Admin can change it without a redeploy.
 */

const ANGLE = /<([^<>\s]+@[^<>\s]+)>\s*$/;
const BARE = /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/;

export function extractAddress(value: string): string | null {
  const trimmed = value.trim();
  const angled = ANGLE.exec(trimmed);
  const address = angled ? angled[1] : trimmed;
  return BARE.test(address) ? address : null;
}

/** Strips characters that could break the header or inject another one. */
export function sanitizeDisplayName(name: string): string {
  return name
    .replace(/[\r\n"<>\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
}

export function formatFrom(displayName: string | null | undefined, fromEnv: string): string | null {
  const address = extractAddress(fromEnv);
  if (!address) return null;
  const name = sanitizeDisplayName(displayName ?? "");
  return name ? `"${name}" <${address}>` : address;
}
