import { NextResponse, type NextRequest } from "next/server";

import {
  GUEST_COOKIE_MAX_AGE,
  GUEST_TOKEN_COOKIE,
  guestCookiePath,
  isWellFormedGuestToken,
} from "@/lib/domain/guest-cookie";
import { normalizeReference } from "@/lib/domain/reference-code";

/**
 * Guest links arrive as /reservation/RAR-…?token=…  The token is moved into an
 * HttpOnly cookie scoped to that one reservation's path, and the browser is redirected
 * to the clean URL, so the secret never stays in the address bar, history, screenshots
 * or Referer headers (ADR-9). The page itself verifies the token against the database.
 */
function handleGuestLink(request: NextRequest): NextResponse | null {
  const match = /^\/reservation\/([^/]+)\/?$/.exec(request.nextUrl.pathname);
  const token = request.nextUrl.searchParams.get("token");
  if (!match || token === null) return null;

  const reference = normalizeReference(decodeURIComponent(match[1]));
  const clean = request.nextUrl.clone();
  clean.searchParams.delete("token");
  if (reference) clean.pathname = guestCookiePath(reference);

  const response = NextResponse.redirect(clean, 303);
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("Cache-Control", "no-store");
  if (reference && isWellFormedGuestToken(token)) {
    response.cookies.set(GUEST_TOKEN_COOKIE, token, {
      httpOnly: true,
      secure: request.nextUrl.protocol === "https:",
      sameSite: "lax",
      path: guestCookiePath(reference),
      maxAge: GUEST_COOKIE_MAX_AGE,
    });
  }
  return response;
}

export function proxy(request: NextRequest) {
  return handleGuestLink(request) ?? NextResponse.next();
}

export const config = {
  matcher: ["/reservation/:path*"],
};
