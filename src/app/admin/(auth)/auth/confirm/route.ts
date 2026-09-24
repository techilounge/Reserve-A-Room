import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { safeNextPath } from "@/lib/auth/guards";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const OTP_TYPES: readonly EmailOtpType[] = ["invite", "recovery", "email", "magiclink", "signup", "email_change"];

/**
 * Landing point for invitation and password-reset links. Exchanges the one-time token
 * for a session (cookies), then continues to `next` (normally /admin/set-password).
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const next = safeNextPath(searchParams.get("next"), "/admin/set-password");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const code = searchParams.get("code");

  const supabase = await createSupabaseServerClient();
  let ok = false;
  if (tokenHash && type && OTP_TYPES.includes(type)) {
    ok = !(await supabase.auth.verifyOtp({ token_hash: tokenHash, type })).error;
  } else if (code) {
    ok = !(await supabase.auth.exchangeCodeForSession(code)).error;
  }

  const destination = request.nextUrl.clone();
  destination.search = "";
  if (ok) {
    const [pathname, query] = next.split("?");
    destination.pathname = pathname;
    if (query) destination.search = `?${query}`;
  } else {
    destination.pathname = "/admin/login";
    destination.searchParams.set("error", "link_expired");
  }
  const response = NextResponse.redirect(destination);
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("Cache-Control", "no-store");
  return response;
}
