import { describe, expect, it } from "vitest";

import {
  clearReservationDraft,
  initialReservationValues,
  loadReservationDraft,
  prefillKeyOf,
  RESERVATION_DRAFT_KEY,
  sanitizeReservationDraft,
  saveReservationDraft,
  toDraftValues,
  type ReservationDraftContext,
  type ReservationDraftValues,
} from "./reservation-draft";

const ROOM = "00000000-0000-4000-8000-000000000001";
const OTHER_ROOM = "00000000-0000-4000-8000-000000000002";
const MINISTRY = "00000000-0000-4000-8000-100000000010";

const rooms = [
  { id: ROOM, horizon: "2026-12-31" },
  { id: OTHER_ROOM, horizon: "2026-11-01" },
];
const initial = initialReservationValues({}, rooms);
const context: ReservationDraftContext = {
  rooms,
  ministryIds: [MINISTRY],
  today: "2026-10-05",
  now: 5_000_000,
  initial,
  prefillKey: prefillKeyOf({}),
};

const complete: ReservationDraftValues = {
  roomId: ROOM,
  date: "2026-11-07",
  start: "10:00",
  end: "11:00",
  firstName: "Jamie",
  lastName: "Rivera",
  email: "jamie@example.org",
  phone: "(512) 555-0123",
  ministryId: MINISTRY,
  otherMinistryName: "",
  purpose: "Weekly prayer circle",
  estimatedAttendance: "12",
  setupRequirements: "Chairs in a circle",
  requesterNotes: "",
};

function memoryStorage(initialData: Record<string, string> = {}) {
  const data = new Map(Object.entries(initialData));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
    data,
  };
}

const save = (storage: ReturnType<typeof memoryStorage>, step: "schedule" | "details" | "review", values = complete) =>
  saveReservationDraft(storage, { values, step, startedAt: 4_000_000, prefillKey: context.prefillKey }, initial);

describe("saving and restoring a reservation draft", () => {
  it("round-trips the answers and the step the visitor was on", () => {
    for (const step of ["schedule", "details", "review"] as const) {
      const storage = memoryStorage();
      save(storage, step);
      const restored = loadReservationDraft(storage, context);
      expect(restored?.values).toEqual(complete);
      expect(restored?.step).toBe(step);
      expect(restored?.startedAt).toBe(4_000_000);
    }
  });

  it("never stores or restores the consent checkbox", () => {
    const storage = memoryStorage();
    save(storage, "review");
    expect(storage.data.get(RESERVATION_DRAFT_KEY)).not.toContain("legalAccepted");
    expect(Object.keys(loadReservationDraft(storage, context)!.values)).not.toContain("legalAccepted");
  });

  it("removes the draft when the form is back to its untouched state", () => {
    const storage = memoryStorage();
    save(storage, "details");
    expect(storage.data.has(RESERVATION_DRAFT_KEY)).toBe(true);
    save(storage, "schedule", initial);
    expect(storage.data.has(RESERVATION_DRAFT_KEY)).toBe(false);
  });

  it("clears on request", () => {
    const storage = memoryStorage();
    save(storage, "details");
    clearReservationDraft(storage);
    expect(loadReservationDraft(storage, context)).toBeNull();
  });
});

describe("what is allowed to come back", () => {
  it("never restores past a step whose answers no longer hold", () => {
    // Review requested, but the details are incomplete: back to details.
    expect(sanitizeReservationDraft({ values: { ...complete, email: "" }, step: "review", prefillKey: "|||" }, context)?.step).toBe("details");
    // A chosen date that has passed breaks the schedule: back to step 1, with that date cleared.
    const stale = sanitizeReservationDraft({ values: { ...complete, date: "2026-09-01" }, step: "review", prefillKey: "|||" }, context);
    expect(stale?.step).toBe("schedule");
    expect(stale?.values).toMatchObject({ date: "", start: "", end: "", firstName: "Jamie" });
  });

  it("drops a room that is gone and a date past the room's booking horizon", () => {
    const gone = sanitizeReservationDraft({ values: { ...complete, roomId: "no-such-room" }, step: "details", prefillKey: "|||" }, context);
    expect(gone?.values).toMatchObject({ roomId: "", date: "", start: "", end: "" });
    expect(gone?.step).toBe("schedule");

    const tooFar = sanitizeReservationDraft({ values: { ...complete, roomId: OTHER_ROOM }, step: "details", prefillKey: "|||" }, context);
    expect(tooFar?.values).toMatchObject({ roomId: OTHER_ROOM, date: "" });
    expect(tooFar?.step).toBe("schedule");
  });

  it("drops a ministry that is no longer offered but keeps 'Other'", () => {
    const removed = sanitizeReservationDraft({ values: { ...complete, ministryId: "00000000-0000-4000-8000-1000000000ff" }, step: "details", prefillKey: "|||" }, context);
    expect(removed?.values.ministryId).toBe("");
    const other = sanitizeReservationDraft(
      { values: { ...complete, ministryId: "other", otherMinistryName: "Garden Club" }, step: "review", prefillKey: "|||" },
      context,
    );
    expect(other).toMatchObject({ step: "review", values: { ministryId: "other", otherMinistryName: "Garden Club" } });
  });

  it("belongs to the link it was started from", () => {
    const storage = memoryStorage();
    saveReservationDraft(
      storage,
      { values: complete, step: "details", startedAt: 1, prefillKey: prefillKeyOf({ roomId: ROOM, date: "2026-11-07" }) },
      initial,
    );
    // Same link (a refresh): restored.
    expect(loadReservationDraft(storage, { ...context, prefillKey: prefillKeyOf({ roomId: ROOM, date: "2026-11-07" }) })).not.toBeNull();
    // A different pre-filled link, or none: the old draft doesn't override it.
    expect(loadReservationDraft(storage, { ...context, prefillKey: prefillKeyOf({ roomId: ROOM, date: "2026-11-14" }) })).toBeNull();
    expect(loadReservationDraft(storage, context)).toBeNull();
  });

  it("restores nothing when the draft is just the untouched form", () => {
    expect(sanitizeReservationDraft({ values: initial, step: "schedule", prefillKey: "|||" }, context)).toBeNull();
    const prefilled = initialReservationValues({ roomId: ROOM, date: "2026-11-07" }, rooms);
    const key = prefillKeyOf({ roomId: ROOM, date: "2026-11-07" });
    expect(sanitizeReservationDraft({ values: prefilled, step: "schedule", prefillKey: key }, { ...context, initial: prefilled, prefillKey: key })).toBeNull();
  });

  it("ignores damaged, hostile or oversized stored data", () => {
    expect(loadReservationDraft(memoryStorage({ [RESERVATION_DRAFT_KEY]: "{broken" }), context)).toBeNull();
    for (const raw of [null, "x", { prefillKey: "|||" }, { values: 3, prefillKey: "|||" }]) {
      expect(sanitizeReservationDraft(raw, context)).toBeNull();
    }
    const long = sanitizeReservationDraft({ values: { ...complete, purpose: "x".repeat(9_000) }, step: "details", prefillKey: "|||" }, context);
    expect(long?.values.purpose).toHaveLength(500);
    const odd = sanitizeReservationDraft({ values: { ...complete, firstName: 5, email: { a: 1 } }, step: "bogus", prefillKey: "|||" }, context);
    expect(odd?.values).toMatchObject({ firstName: "", email: "" });
    expect(odd?.step).toBe("schedule");
    // The form-shown time can't be set in the future to dodge the minimum-fill-time check.
    expect(sanitizeReservationDraft({ values: complete, step: "details", startedAt: context.now + 1e6, prefillKey: "|||" }, context)?.startedAt).toBe(context.now);
  });

  it("never throws when storage is unavailable", () => {
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(loadReservationDraft(blocked, context)).toBeNull();
    expect(() => saveReservationDraft(blocked, { values: complete, step: "details", startedAt: 1, prefillKey: "|||" }, initial)).not.toThrow();
    expect(() => clearReservationDraft(blocked)).not.toThrow();
  });
});

describe("helpers", () => {
  it("turns form values into plain strings", () => {
    expect(toDraftValues({ firstName: "Jo", estimatedAttendance: 12, legalAccepted: true, roomId: undefined })).toMatchObject({
      firstName: "Jo",
      estimatedAttendance: "12",
      roomId: "",
    });
  });

  it("preselects a lone room, and applies URL pre-fill", () => {
    expect(initialReservationValues({}, [{ id: ROOM }]).roomId).toBe(ROOM);
    expect(initialReservationValues({}, rooms).roomId).toBe("");
    expect(initialReservationValues({ roomId: OTHER_ROOM, start: "09:00" }, rooms)).toMatchObject({ roomId: OTHER_ROOM, start: "09:00" });
  });
});
