import { LIMITS, OTHER_MINISTRY, reservationSchema, STEP_FIELDS } from "@/lib/validation/reservation";

/**
 * Keeps a half-finished one-time reservation (the 3-step form) across a page refresh.
 * The same rules as the recurring-request draft apply:
 *
 * - `sessionStorage`: survives a refresh, is tied to the tab, and is discarded when the tab
 *   closes, so personal details don't linger on a shared computer.
 * - The Privacy Policy / Terms acceptance is never stored; consent is given again each time.
 * - Restored data is untrusted and re-checked against what the form currently offers.
 * - A draft belongs to the link it was started from. If the URL's pre-fill (room, date,
 *   times) has changed, the draft is discarded so a new link isn't overridden by an old one.
 */

export const RESERVATION_DRAFT_KEY = "rar:reservation-draft:v1";

export type ReservationStep = "schedule" | "details" | "review";
const STEPS: readonly ReservationStep[] = ["schedule", "details", "review"];

const FIELD_LIMITS = {
  roomId: 36,
  date: 10,
  start: 5,
  end: 5,
  firstName: LIMITS.name,
  lastName: LIMITS.name,
  email: 254,
  phone: 40,
  ministryId: 36,
  otherMinistryName: LIMITS.otherMinistry,
  purpose: LIMITS.purpose,
  estimatedAttendance: 6,
  setupRequirements: LIMITS.notes,
  requesterNotes: LIMITS.notes,
} as const;

type DraftField = keyof typeof FIELD_LIMITS;
const FIELDS = Object.keys(FIELD_LIMITS) as DraftField[];

export type ReservationDraftValues = Record<DraftField, string>;

export type ReservePrefillLike = { roomId?: string; date?: string; start?: string; end?: string };

export type ReservationDraftContext = {
  rooms: readonly { id: string; horizon: string }[];
  ministryIds: readonly string[];
  /** Today's date in the church timezone, "YYYY-MM-DD". */
  today: string;
  /** Current time in ms since epoch. */
  now: number;
  /** What the untouched form holds (URL pre-fill applied). */
  initial: ReservationDraftValues;
  prefillKey: string;
};

export type RestoredReservationDraft = { values: ReservationDraftValues; step: ReservationStep; startedAt: number };

/** Identifies the link the form was opened from. */
export function prefillKeyOf(prefill: ReservePrefillLike): string {
  return [prefill.roomId, prefill.date, prefill.start, prefill.end].map((part) => part ?? "").join("|");
}

/** The untouched form: URL pre-fill applied, and a lone room preselected. */
export function initialReservationValues(
  prefill: ReservePrefillLike,
  rooms: readonly { id: string }[],
): ReservationDraftValues {
  const values = Object.fromEntries(FIELDS.map((field) => [field, ""])) as ReservationDraftValues;
  values.roomId = prefill.roomId ?? (rooms.length === 1 ? rooms[0].id : "");
  values.date = prefill.date ?? "";
  values.start = prefill.start ?? "";
  values.end = prefill.end ?? "";
  return values;
}

/** Form values (any shape react-hook-form holds) as plain strings. */
export function toDraftValues(input: Partial<Record<string, unknown>>): ReservationDraftValues {
  const values = Object.fromEntries(FIELDS.map((field) => [field, ""])) as ReservationDraftValues;
  for (const field of FIELDS) {
    const value = input[field];
    if (typeof value === "string") values[field] = value;
    else if (typeof value === "number" && Number.isFinite(value)) values[field] = String(value);
  }
  return values;
}

function isPristine(values: ReservationDraftValues, initial: ReservationDraftValues): boolean {
  return FIELDS.every((field) => values[field].trim() === initial[field].trim());
}

/** Validates untrusted stored data. Returns null when it should not be restored. */
export function sanitizeReservationDraft(raw: unknown, context: ReservationDraftContext): RestoredReservationDraft | null {
  if (!raw || typeof raw !== "object") return null;
  const stored = raw as { values?: unknown; step?: unknown; startedAt?: unknown; prefillKey?: unknown };
  if (stored.prefillKey !== context.prefillKey) return null;
  if (!stored.values || typeof stored.values !== "object") return null;

  const values = Object.fromEntries(FIELDS.map((field) => [field, ""])) as ReservationDraftValues;
  for (const field of FIELDS) {
    const value = (stored.values as Record<string, unknown>)[field];
    if (typeof value === "string") values[field] = value.slice(0, FIELD_LIMITS[field]);
  }

  const room = context.rooms.find((candidate) => candidate.id === values.roomId);
  if (!room) {
    values.roomId = "";
    values.date = "";
  } else if (!/^\d{4}-\d{2}-\d{2}$/.test(values.date) || values.date < context.today || values.date > room.horizon) {
    values.date = "";
  }
  if (!values.date) {
    values.start = "";
    values.end = "";
  }
  if (values.ministryId !== OTHER_MINISTRY && !context.ministryIds.includes(values.ministryId)) values.ministryId = "";

  // Return to the step the visitor was on, but never past a step whose answers no longer hold.
  const requested = STEPS.includes(stored.step as ReservationStep) ? (stored.step as ReservationStep) : "schedule";
  const parsed = reservationSchema.safeParse({ ...values, legalAccepted: true });
  const failing = new Set<string>(parsed.success ? [] : parsed.error.issues.map((issue) => String(issue.path[0])));
  const scheduleBroken = STEP_FIELDS.schedule.some((field) => failing.has(field));
  const detailsBroken = STEP_FIELDS.details.some((field) => failing.has(field));
  const step: ReservationStep = scheduleBroken ? "schedule" : requested === "review" && detailsBroken ? "details" : requested;

  if (step === "schedule" && isPristine(values, context.initial)) return null;

  const started = stored.startedAt;
  const startedAt = typeof started === "number" && Number.isFinite(started) && started <= context.now ? started : context.now;
  return { values, step, startedAt };
}

export function loadReservationDraft(
  storage: Pick<Storage, "getItem">,
  context: ReservationDraftContext,
): RestoredReservationDraft | null {
  try {
    const text = storage.getItem(RESERVATION_DRAFT_KEY);
    return text ? sanitizeReservationDraft(JSON.parse(text), context) : null;
  } catch {
    // Storage blocked or the saved text is damaged: start with an empty form.
    return null;
  }
}

/** Saves the draft, or removes it when the form is back to its untouched state. */
export function saveReservationDraft(
  storage: Pick<Storage, "setItem" | "removeItem">,
  draft: { values: ReservationDraftValues; step: ReservationStep; startedAt: number; prefillKey: string },
  initial: ReservationDraftValues,
): void {
  try {
    if (draft.step === "schedule" && isPristine(draft.values, initial)) {
      storage.removeItem(RESERVATION_DRAFT_KEY);
      return;
    }
    // Only the text fields are written; the consent checkbox is deliberately left out.
    storage.setItem(
      RESERVATION_DRAFT_KEY,
      JSON.stringify({
        values: Object.fromEntries(FIELDS.map((field) => [field, draft.values[field]])),
        step: draft.step,
        startedAt: draft.startedAt,
        prefillKey: draft.prefillKey,
      }),
    );
  } catch {
    // Private mode or a full quota: the form still works, it just can't survive a refresh.
  }
}

export function clearReservationDraft(storage: Pick<Storage, "removeItem">): void {
  try {
    storage.removeItem(RESERVATION_DRAFT_KEY);
  } catch {
    // Nothing to clear.
  }
}
