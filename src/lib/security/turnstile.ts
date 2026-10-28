import "server-only";

import { getAppUrl } from "@/lib/app-url";
import { getTurnstileSiteKey } from "@/lib/env/public";
import { getServerEnv } from "@/lib/env/server";

import { TURNSTILE_ACTIONS } from "./turnstile-actions";

export type TurnstileConfiguration =
  | { status: "disabled"; siteKey: null }
  | { status: "enabled"; siteKey: string }
  | { status: "invalid"; siteKey: string | null };

/** Partial configuration is an operator error, never an implicit opt-out. */
export function getTurnstileConfiguration(): TurnstileConfiguration {
  const siteKey = getTurnstileSiteKey();
  const secretKey = getServerEnv().TURNSTILE_SECRET_KEY;
  if (siteKey && secretKey) return { status: "enabled", siteKey };
  if (!siteKey && !secretKey) return { status: "disabled", siteKey: null };
  return { status: "invalid", siteKey };
}

export function isTurnstileEnabled(): boolean {
  return getTurnstileConfiguration().status === "enabled";
}

export async function verifyTurnstile(
  token: string | undefined,
  ip: string,
  expectedAction: string = TURNSTILE_ACTIONS.reserve,
): Promise<boolean> {
  const configuration = getTurnstileConfiguration();
  if (configuration.status === "disabled") return true;
  if (configuration.status === "invalid") {
    console.error("[turnstile] incomplete configuration");
    return false;
  }
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
    const valid = result.success === true && result.action === expectedAction && result.hostname === expectedHostname;
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
