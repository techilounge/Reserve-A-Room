import "server-only";

import { getAppUrl } from "@/lib/app-url";
import { getTurnstileSiteKey } from "@/lib/env/public";
import { getServerEnv } from "@/lib/env/server";

/** Turnstile is optional: enabled only when both site and secret keys are configured. */
export function isTurnstileEnabled(): boolean {
  return Boolean(getTurnstileSiteKey() && getServerEnv().TURNSTILE_SECRET_KEY);
}

export async function verifyTurnstile(token: string | undefined, ip: string): Promise<boolean> {
  if (!isTurnstileEnabled()) return true;
  if (!token) return false;
  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret: getServerEnv().TURNSTILE_SECRET_KEY!, response: token, remoteip: ip }),
      cache: "no-store",
    });
    const result = (await response.json()) as { success?: boolean; action?: string; hostname?: string; "error-codes"?: string[] };
    const expectedHostname = new URL(getAppUrl()).hostname;
    const valid = result.success === true && result.action === "reserve" && result.hostname === expectedHostname;
    if (!valid) {
      console.warn("[turnstile] verification rejected", {
        action: result.action,
        hostname: result.hostname,
        errorCodes: result["error-codes"],
      });
    }
    return valid;
  } catch (error) {
    console.error("[turnstile] verification failed", error);
    return false;
  }
}
