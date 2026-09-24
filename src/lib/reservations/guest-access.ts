import "server-only";

import { cookies } from "next/headers";

import { toAppError, type AppError } from "@/lib/domain/errors";
import { GUEST_TOKEN_COOKIE, hashGuestToken, isWellFormedGuestToken } from "@/lib/domain/guest-token";
import { normalizeReference } from "@/lib/domain/reference-code";
import { hitRateLimit, RATE_LIMITS } from "@/lib/security/rate-limit";
import { clientIp } from "@/lib/security/request";
import type { Database } from "@/lib/supabase/database.types";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

/** Requester-safe view of a reservation (no admin notes, contact details or tokens). */
export type GuestReservation = Database["public"]["Functions"]["get_guest_reservation"]["Returns"][number];

export type GuestLookup =
  | { ok: true; reservation: GuestReservation }
  | { ok: false; reason: "invalid_reference" | "no_token" | "not_found" | "rate_limited" | "unavailable" };

/** Reads the path-scoped token cookie for this reservation page. */
async function tokenFromCookie(): Promise<string | null> {
  const token = (await cookies()).get(GUEST_TOKEN_COOKIE)?.value;
  return isWellFormedGuestToken(token) ? token : null;
}

export async function loadGuestReservation(rawReference: string): Promise<GuestLookup> {
  const reference = normalizeReference(rawReference);
  if (!reference) return { ok: false, reason: "invalid_reference" };
  const token = await tokenFromCookie();
  if (!token) return { ok: false, reason: "no_token" };
  if (!(await hitRateLimit(RATE_LIMITS.guestLookupPerIp, await clientIp()))) {
    return { ok: false, reason: "rate_limited" };
  }

  const { data, error } = await createSupabaseServiceClient()
    .rpc("get_guest_reservation", { p_reference: reference, p_token_hash: hashGuestToken(token) })
    .maybeSingle();
  if (error) {
    if (error.code === "RAR08") return { ok: false, reason: "not_found" };
    console.error("[guest] lookup failed", error);
    return { ok: false, reason: "unavailable" };
  }
  return data ? { ok: true, reservation: data } : { ok: false, reason: "not_found" };
}

export async function cancelGuestReservation(rawReference: string): Promise<{ ok: true } | { ok: false; error: AppError }> {
  const reference = normalizeReference(rawReference);
  const token = await tokenFromCookie();
  if (!reference || !token) return { ok: false, error: toAppError({ code: "RAR08" }) };
  if (!(await hitRateLimit(RATE_LIMITS.guestCancelPerIp, await clientIp()))) {
    return { ok: false, error: toAppError({ code: "RAR07" }) };
  }

  const { error } = await createSupabaseServiceClient().rpc("cancel_guest_reservation", {
    p_reference: reference,
    p_token_hash: hashGuestToken(token),
  });
  if (error) {
    const appError = toAppError(error);
    if (appError.kind === "unexpected") console.error("[guest] cancel failed", error);
    return { ok: false, error: appError };
  }
  return { ok: true };
}
