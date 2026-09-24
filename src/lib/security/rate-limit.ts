import "server-only";

import { createHmac } from "node:crypto";

import { getServerEnv, isProductionDeployment } from "@/lib/env/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * Postgres-backed rate limiting (ADR-14). Works across stateless serverless instances
 * without another service. Keys are HMACs, so raw IPs/emails are never stored.
 */

export type RateLimitRule = { bucket: string; limit: number; windowSeconds: number };

export const RATE_LIMITS = {
  reservationPerIp: { bucket: "reserve:ip", limit: 10, windowSeconds: 60 * 60 },
  reservationPerEmail: { bucket: "reserve:email", limit: 8, windowSeconds: 24 * 60 * 60 },
  guestCancelPerIp: { bucket: "cancel:ip", limit: 20, windowSeconds: 60 * 60 },
  guestLookupPerIp: { bucket: "lookup:ip", limit: 60, windowSeconds: 60 * 60 },
  loginPerIp: { bucket: "login:ip", limit: 10, windowSeconds: 10 * 60 },
  loginPerEmail: { bucket: "login:email", limit: 10, windowSeconds: 60 * 60 },
  passwordResetPerIp: { bucket: "reset:ip", limit: 5, windowSeconds: 60 * 60 },
} as const satisfies Record<string, RateLimitRule>;

function secret(): string {
  const configured = getServerEnv().RATE_LIMIT_SECRET;
  if (configured) return configured;
  if (isProductionDeployment()) {
    throw new Error("RATE_LIMIT_SECRET must be set in production.");
  }
  return "development-only-rate-limit-secret";
}

export function rateLimitKey(value: string): string {
  return createHmac("sha256", secret()).update(value.trim().toLowerCase()).digest("hex");
}

/**
 * Records a hit and returns whether it is within the limit. Fails open (allows) if the
 * limiter itself is unavailable, so an outage never blocks legitimate reservations —
 * the other defenses (validation, honeypot, DB constraints) still apply.
 */
export async function hitRateLimit(rule: RateLimitRule, value: string): Promise<boolean> {
  try {
    const { data, error } = await createSupabaseServiceClient().rpc("hit_rate_limit", {
      p_bucket: rule.bucket,
      p_key_hash: rateLimitKey(value),
      p_limit: rule.limit,
      p_window_seconds: rule.windowSeconds,
    });
    if (error) throw error;
    return data !== false;
  } catch (error) {
    console.error("[rate-limit] check failed; allowing request", error);
    return true;
  }
}
