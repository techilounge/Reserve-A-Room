import "server-only";

import { isLocalDate, localToUtc, todayInZone } from "@/lib/datetime";
import { getBusyBlocks } from "@/lib/data/availability";
import { loadCatalog } from "@/lib/data/catalog";
import { isRangeAvailable, type BusyBlock, type DayWindow } from "@/lib/domain/availability";
import { friendlyMessage, toAppError, type AppErrorKind } from "@/lib/domain/errors";
import { newGuestToken } from "@/lib/domain/guest-token";
import { advanceLabel, advanceLimitMessage, isWithinHorizon } from "@/lib/domain/rooms/advance-booking";
import { hitRateLimit, RATE_LIMITS } from "@/lib/security/rate-limit";
import { clientIp } from "@/lib/security/request";
import { verifyTurnstile } from "@/lib/security/turnstile";
import type { Enums } from "@/lib/supabase/database.types";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { fieldErrors, OTHER_MINISTRY, reservationSchema } from "@/lib/validation/reservation";

/** Anti-bot metadata sent alongside the form (never stored). */
export type SubmissionMeta = {
  /** Honeypot — a hidden field real people never fill in. */
  website?: string;
  /** When the form was first shown (ms since epoch). */
  startedAt?: number;
  turnstileToken?: string;
};

export type Step = "schedule" | "details" | "review";

export type SubmitFailure = {
  ok: false;
  message: string;
  kind: AppErrorKind;
  step: Step;
  fieldErrors?: Record<string, string>;
};

export type SubmitSuccess = {
  ok: true;
  reference: string;
  status: Enums<"reservation_status">;
  token: string;
};

/** Minimum time a person plausibly needs to fill in the form. */
const MIN_FILL_MS = 3000;

const SCHEDULE_KINDS: ReadonlySet<AppErrorKind> = new Set([
  "conflict",
  "beyond_horizon",
  "room_unavailable",
  "too_soon",
  "invalid_time",
]);

const fail = (kind: AppErrorKind, message: string, step: Step, errors?: Record<string, string>): SubmitFailure => ({
  ok: false,
  kind,
  message,
  step,
  fieldErrors: errors,
});

/**
 * The trusted guest reservation path. Every check here is repeated by the database, which
 * stays the final authority (conflicts, horizon, room state, approval rule).
 */
export async function createGuestReservation(raw: unknown, meta: SubmissionMeta): Promise<SubmitSuccess | SubmitFailure> {
  // 1. Cheap bot defenses. Deliberately vague so bots learn nothing.
  const tooFast = typeof meta.startedAt !== "number" || Date.now() - meta.startedAt < MIN_FILL_MS;
  if (meta.website || tooFast) {
    return fail("validation", "We couldn't submit your reservation. Please review the form and try again.", "review");
  }

  // 2. Validate everything server-side.
  const parsed = reservationSchema.safeParse(raw);
  if (!parsed.success) {
    const errors = fieldErrors(parsed.error);
    const scheduleError = ["roomId", "date", "start", "end"].some((f) => f in errors);
    return fail("validation", friendlyMessage("validation"), scheduleError ? "schedule" : "details", errors);
  }
  const input = parsed.data;

  // 3. Abuse protection.
  const ip = await clientIp();
  if (!(await verifyTurnstile(meta.turnstileToken, ip))) {
    return fail("validation", "Please complete the verification and try again.", "review");
  }
  const [ipOk, emailOk] = await Promise.all([
    hitRateLimit(RATE_LIMITS.reservationPerIp, ip),
    hitRateLimit(RATE_LIMITS.reservationPerEmail, input.email),
  ]);
  if (!ipOk || !emailOk) return fail("rate_limited", friendlyMessage("rate_limited"), "review");

  // 4. Room + policy pre-checks for precise, friendly messages.
  const catalog = await loadCatalog();
  if (!catalog.ok) return fail("unexpected", friendlyMessage("unexpected"), "review");
  const { settings } = catalog.catalog;
  const room = catalog.catalog.rooms.find((r) => r.id === input.roomId);
  if (!room || !room.reservable) {
    return fail("room_unavailable", friendlyMessage("room_unavailable"), "schedule", { roomId: friendlyMessage("room_unavailable") });
  }

  const today = todayInZone(settings.timeZone);
  if (!isLocalDate(input.date) || !isWithinHorizon(input.date, today, room.advance)) {
    const message = input.date < today ? "Please choose today or a future date." : advanceLimitMessage(room.advance);
    return fail("beyond_horizon", message, "schedule", { date: message });
  }

  const startAt = localToUtc(input.date, input.start, settings.timeZone);
  const endAt = localToUtc(input.date, input.end, settings.timeZone);
  if (!startAt || !endAt) {
    const message = "That time doesn't exist on this date because of the daylight saving time change. Please choose another time.";
    return fail("invalid_time", message, "schedule", { start: message });
  }

  // 5. Fresh availability check (UX). The exclusion constraint is the real guard.
  let busy: BusyBlock[] = [];
  try {
    busy = (await getBusyBlocks([room.id], input.date, 1, settings.timeZone)).get(room.id) ?? [];
  } catch (error) {
    console.error("[reserve] availability pre-check failed; relying on database constraint", error);
  }
  const window: DayWindow = {
    date: input.date,
    timeZone: settings.timeZone,
    dayStart: settings.dayStart,
    dayEnd: settings.dayEnd,
    intervalMinutes: settings.intervalMinutes,
    leadMinutes: settings.leadMinutes,
  };
  if (!isRangeAvailable(window, busy, input.start, input.end)) {
    return fail("conflict", friendlyMessage("conflict"), "schedule");
  }

  // 6. Create atomically in the database.
  const link = newGuestToken();
  const { data, error } = await createSupabaseServiceClient()
    .rpc("create_guest_reservation", {
      p_room_id: room.id,
      p_start_at: startAt.toISOString(),
      p_end_at: endAt.toISOString(),
      p_first_name: input.firstName,
      p_last_name: input.lastName,
      p_email: input.email,
      p_phone: input.phone,
      p_ministry_id: input.ministryId === OTHER_MINISTRY ? undefined : input.ministryId,
      p_other_ministry_name: input.otherMinistryName,
      p_purpose: input.purpose,
      p_estimated_attendance: input.estimatedAttendance,
      p_setup_requirements: input.setupRequirements,
      p_requester_notes: input.requesterNotes,
      p_token_hash: link.hash,
      p_token_seed: link.seed,
    })
    .single();

  if (error || !data) {
    const appError = toAppError(error, { advanceLimitLabel: advanceLabel(room.advance) });
    if (appError.kind === "unexpected") console.error("[reserve] create_guest_reservation failed", error);
    if (error?.code === "RAR10") {
      return fail("validation", "Please choose your ministry or group from the list.", "details", {
        ministryId: "Please choose your ministry or group from the list.",
      });
    }
    return fail(appError.kind, appError.message, SCHEDULE_KINDS.has(appError.kind) ? "schedule" : "review");
  }

  return { ok: true, reference: data.reference_code, status: data.status, token: link.token };
}
