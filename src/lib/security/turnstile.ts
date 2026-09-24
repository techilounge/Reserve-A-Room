import "server-only";

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
    const result = (await response.json()) as { success?: boolean };
    return result.success === true;
  } catch (error) {
    console.error("[turnstile] verification failed", error);
    return false;
  }
}
