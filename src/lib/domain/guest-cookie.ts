/**
 * Guest-link cookie details shared by the proxy and server actions. Kept free of
 * `server-only`/Node imports because the proxy imports it.
 */

export const GUEST_TOKEN_COOKIE = "rar_guest_token";

/** 180 days — long enough to check or cancel a reservation made months ahead. */
export const GUEST_COOKIE_MAX_AGE = 60 * 60 * 24 * 180;

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** 32 random bytes in base64url is always exactly 43 URL-safe characters. */
export function isWellFormedGuestToken(token: string | undefined | null): token is string {
  return typeof token === "string" && TOKEN_PATTERN.test(token);
}

/** The cookie is only ever sent to that one reservation's page. */
export function guestCookiePath(reference: string): string {
  return `/reservation/${reference}`;
}
