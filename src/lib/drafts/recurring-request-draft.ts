import type { RecurringRequestFormValues } from "@/app/(public)/recurring-request/actions";

/**
 * Keeps a half-finished recurring-date request across a page refresh.
 *
 * - Stored in `sessionStorage`: it survives a refresh but is tied to the browser tab and is
 *   discarded when the tab closes, so personal details don't linger on a shared computer.
 * - Never stores the Privacy Policy / Terms acceptance. Consent is given again for each
 *   submission so it stays an explicit, auditable act.
 * - Anything restored is re-checked against what the form currently offers (rooms, time
 *   grid, dates), so a stale draft can't put the form in a state the visitor couldn't reach.
 */

export const DRAFT_STORAGE_KEY = "rar:recurring-request-draft:v1";

type Draft = { values: RecurringRequestFormValues; startedAt: number };

export type DraftContext = {
  roomIds: readonly string[];
  timeOptions: readonly string[];
  /** Today's date in the church timezone, "YYYY-MM-DD". */
  today: string;
  /** Current time in ms since epoch. */
  now: number;
};

const MAX_LENGTH: Record<Exclude<keyof RecurringRequestFormValues, "legalAccepted">, number> = {
  roomId: 36,
  preferredStartDate: 10,
  start: 5,
  end: 5,
  recurrenceDescription: 1000,
  firstName: 80,
  lastName: 80,
  email: 254,
  phone: 40,
  purpose: 500,
  estimatedAttendance: 6,
  requesterNotes: 1000,
};

const TEXT_FIELDS = Object.keys(MAX_LENGTH) as (keyof typeof MAX_LENGTH)[];

export function emptyDraftValues(): RecurringRequestFormValues {
  return {
    roomId: "",
    preferredStartDate: "",
    start: "",
    end: "",
    recurrenceDescription: "",
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    purpose: "",
    estimatedAttendance: "",
    requesterNotes: "",
    legalAccepted: false,
  };
}

function hasContent(values: RecurringRequestFormValues): boolean {
  return TEXT_FIELDS.some((field) => values[field].trim() !== "");
}

/** Validates untrusted stored data. Returns null when there is nothing worth restoring. */
export function sanitizeDraft(raw: unknown, context: DraftContext): Draft | null {
  if (!raw || typeof raw !== "object") return null;
  const source = (raw as { values?: unknown }).values;
  if (!source || typeof source !== "object") return null;

  const values = emptyDraftValues();
  for (const field of TEXT_FIELDS) {
    const value = (source as Record<string, unknown>)[field];
    if (typeof value === "string") values[field] = value.slice(0, MAX_LENGTH[field]);
  }

  if (!context.roomIds.includes(values.roomId)) values.roomId = "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(values.preferredStartDate) || values.preferredStartDate < context.today) {
    values.preferredStartDate = "";
  }
  if (!context.timeOptions.includes(values.start)) values.start = "";
  if (!values.start || !context.timeOptions.includes(values.end) || values.end <= values.start) values.end = "";
  // Consent is never carried over.
  values.legalAccepted = false;

  if (!hasContent(values)) return null;

  const stored = (raw as { startedAt?: unknown }).startedAt;
  const startedAt = typeof stored === "number" && Number.isFinite(stored) && stored <= context.now ? stored : context.now;
  return { values, startedAt };
}

/** `sessionStorage`, or null where the browser blocks it (the property access itself can throw). */
export function browserStorage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function loadDraft(storage: Pick<Storage, "getItem">, context: DraftContext): Draft | null {
  try {
    const text = storage.getItem(DRAFT_STORAGE_KEY);
    return text ? sanitizeDraft(JSON.parse(text), context) : null;
  } catch {
    // Storage blocked or the saved text is damaged: start with an empty form.
    return null;
  }
}

/** Saves the draft, or removes it when the form has been emptied. */
export function saveDraft(
  storage: Pick<Storage, "setItem" | "removeItem">,
  values: RecurringRequestFormValues,
  startedAt: number,
): void {
  try {
    if (!hasContent(values)) {
      storage.removeItem(DRAFT_STORAGE_KEY);
      return;
    }
    // Only the text fields are written; the consent checkbox is deliberately left out.
    const saved = Object.fromEntries(TEXT_FIELDS.map((field) => [field, values[field]]));
    storage.setItem(DRAFT_STORAGE_KEY, JSON.stringify({ values: saved, startedAt }));
  } catch {
    // Private mode or a full quota: the form still works, it just can't survive a refresh.
  }
}

export function clearDraft(storage: Pick<Storage, "removeItem">): void {
  try {
    storage.removeItem(DRAFT_STORAGE_KEY);
  } catch {
    // Nothing to clear.
  }
}
