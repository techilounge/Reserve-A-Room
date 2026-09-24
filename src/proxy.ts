import { createServerClient } from "@supabase/ssr";
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

/** Admin pages reachable without a session. */
const PUBLIC_ADMIN_PATHS = ["/admin/login", "/admin/forgot-password", "/admin/auth/"];

/**
 * Refreshes the staff session cookie on every admin request and sends signed-out visitors
 * to sign in. This is a convenience gate only: every page and action re-verifies the
 * user and their role, and the database enforces RLS.
 */
async function handleAdmin(request: NextRequest): Promise<NextResponse> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  let response = NextResponse.next({ request });
  if (!url || !key) return response;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        for (const [header, value] of Object.entries(headers ?? {})) response.headers.set(header, value);
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_ADMIN_PATHS.some((p) => path === p || path.startsWith(p));
  if (!user && !isPublic) {
    const login = request.nextUrl.clone();
    login.pathname = "/admin/login";
    login.search = "";
    login.searchParams.set("next", `${path}${request.nextUrl.search}`);
    const redirect = NextResponse.redirect(login);
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
    return redirect;
  }
  return response;
}

export async function proxy(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/admin")) return handleAdmin(request);
  return handleGuestLink(request) ?? NextResponse.next();
}

export const config = {
  matcher: ["/reservation/:path*", "/admin", "/admin/:path*"],
};
