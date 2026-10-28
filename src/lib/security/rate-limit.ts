import "server-only";

import { createHmac, randomUUID } from "node:crypto";

import { getServerEnv, isProductionDeployment } from "@/lib/env/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * Postgres-backed rate limiting (ADR-14). Works across stateless serverless instances
 * without another service. Keys are HMACs, so raw IPs/emails are never stored.
 */

export type RateLimitRule = { bucket: string; limit: number; windowSeconds: number };
export type RateLimitResult = "allowed" | "denied" | "unavailable";

export const RATE_LIMITS = {
  reservationPerIp: { bucket: "reserve:ip", limit: 10, windowSeconds: 60 * 60 },
  reservationPerEmail: { bucket: "reserve:email", limit: 8, windowSeconds: 24 * 60 * 60 },
  recurringRequestPerIp: { bucket: "recurring:ip", limit: 5, windowSeconds: 60 * 60 },
  recurringRequestPerEmail: { bucket: "recurring:email", limit: 3, windowSeconds: 24 * 60 * 60 },
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
 * Records a hit and distinguishes policy denial from infrastructure failure. Callers
 * choose a workflow-appropriate, fail-closed user response.
 */
export async function hitRateLimit(rule: RateLimitRule, value: string): Promise<RateLimitResult> {
  try {
    const { data, error } = await createSupabaseServiceClient().rpc("hit_rate_limit", {
      p_bucket: rule.bucket,
      p_key_hash: rateLimitKey(value),
      p_limit: rule.limit,
      p_window_seconds: rule.windowSeconds,
    });
    if (error) throw error;
    if (data === true) return "allowed";
    if (data === false) return "denied";
    throw new Error("Rate limiter returned no decision.");
  } catch (error) {
    console.error("[rate-limit] check unavailable", {
      bucket: rule.bucket,
      correlationId: randomUUID(),
      error: error instanceof Error ? error.message : "Unknown limiter error",
    });
    return "unavailable";
  }
}
