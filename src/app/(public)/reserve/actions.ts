"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { isLocalDate } from "@/lib/datetime";
import { getBusyBlocks } from "@/lib/data/availability";
import { loadCatalog } from "@/lib/data/catalog";
import type { BusyBlock } from "@/lib/domain/availability";
import { GUEST_COOKIE_MAX_AGE, GUEST_TOKEN_COOKIE, guestCookiePath } from "@/lib/domain/guest-cookie";
import { isProductionDeployment } from "@/lib/env/server";
import { createGuestReservation, type SubmissionMeta, type SubmitFailure } from "@/lib/reservations/guest";

/**
 * Submits a guest reservation. On success the guest is redirected to their reservation
 * page, carrying the management token in a path-scoped HttpOnly cookie (never the URL).
 */
export async function submitReservation(input: unknown, meta: SubmissionMeta): Promise<SubmitFailure> {
  const result = await createGuestReservation(input, meta);
  if (!result.ok) return result;

  const store = await cookies();
  store.set(GUEST_TOKEN_COOKIE, result.token, {
    httpOnly: true,
    secure: isProductionDeployment() || process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: guestCookiePath(result.reference),
    maxAge: GUEST_COOKIE_MAX_AGE,
  });
  redirect(`${guestCookiePath(result.reference)}?submitted=1`);
}

/** Occupied times for one room on one day (public data), for the time pickers. */
export async function fetchDayAvailability(
  roomId: string,
  date: string,
): Promise<{ ok: true; busy: BusyBlock[] } | { ok: false }> {
  if (!isLocalDate(date) || !/^[0-9a-f-]{36}$/i.test(roomId)) return { ok: false };
  const catalog = await loadCatalog();
  if (!catalog.ok || !catalog.catalog.rooms.some((r) => r.id === roomId)) return { ok: false };
  try {
    const busy = await getBusyBlocks([roomId], date, 1, catalog.catalog.settings.timeZone);
    return { ok: true, busy: busy.get(roomId) ?? [] };
  } catch (error) {
    console.error("[reserve] fetchDayAvailability failed", error);
    return { ok: false };
  }
}
