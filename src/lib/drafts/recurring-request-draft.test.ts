import { describe, expect, it } from "vitest";

import {
  clearDraft,
  DRAFT_STORAGE_KEY,
  emptyDraftValues,
  loadDraft,
  sanitizeDraft,
  saveDraft,
  type DraftContext,
} from "./recurring-request-draft";

const ROOM = "00000000-0000-4000-8000-000000000001";
const context: DraftContext = {
  roomIds: [ROOM],
  timeOptions: ["09:00", "10:00", "11:00", "12:00"],
  today: "2026-10-05",
  now: 2_000_000,
};

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
    data,
  };
}

const filled = {
  ...emptyDraftValues(),
  roomId: ROOM,
  preferredStartDate: "2026-11-07",
  start: "10:00",
  end: "12:00",
  recurrenceDescription: "Every Saturday through December",
  firstName: "Jamie",
  lastName: "Rivera",
  email: "jamie@example.org",
  phone: "(512) 555-0123",
  purpose: "Weekly prayer circle",
  estimatedAttendance: "12",
  requesterNotes: "Call after 5.",
};

describe("saving and restoring a recurring-request draft", () => {
  it("round-trips every field except consent", () => {
    const storage = memoryStorage();
    saveDraft(storage, { ...filled, legalAccepted: true }, 1_500_000);
    expect(storage.data.get(DRAFT_STORAGE_KEY)).not.toContain("legalAccepted");

    const restored = loadDraft(storage, context);
    expect(restored?.values).toEqual({ ...filled, legalAccepted: false });
    expect(restored?.startedAt).toBe(1_500_000);
  });

  it("removes the saved draft once the form is emptied", () => {
    const storage = memoryStorage();
    saveDraft(storage, filled, 1);
    expect(storage.data.has(DRAFT_STORAGE_KEY)).toBe(true);
    saveDraft(storage, { ...emptyDraftValues(), legalAccepted: true }, 1);
    expect(storage.data.has(DRAFT_STORAGE_KEY)).toBe(false);
  });

  it("clears on request", () => {
    const storage = memoryStorage();
    saveDraft(storage, filled, 1);
    clearDraft(storage);
    expect(loadDraft(storage, context)).toBeNull();
  });

  it("drops choices the form no longer offers instead of restoring an impossible state", () => {
    const draft = sanitizeDraft(
      {
        values: { ...filled, roomId: "gone-room", preferredStartDate: "2026-09-01", start: "03:00", end: "12:00" },
        startedAt: 1,
      },
      context,
    );
    expect(draft?.values).toMatchObject({ roomId: "", preferredStartDate: "", start: "", end: "", firstName: "Jamie" });
    // An end time earlier than the start is dropped too.
    const reversed = sanitizeDraft({ values: { ...filled, start: "12:00", end: "09:00" } }, context);
    expect(reversed?.values).toMatchObject({ start: "12:00", end: "" });
  });

  it("ignores damaged, hostile or oversized stored data", () => {
    expect(loadDraft(memoryStorage({ [DRAFT_STORAGE_KEY]: "{not json" }), context)).toBeNull();
    expect(sanitizeDraft(null, context)).toBeNull();
    expect(sanitizeDraft({ values: "x" }, context)).toBeNull();
    expect(sanitizeDraft({ values: { firstName: 42, email: { a: 1 } } }, context)).toBeNull();
    const long = sanitizeDraft({ values: { ...filled, purpose: "x".repeat(5_000) } }, context);
    expect(long?.values.purpose).toHaveLength(500);
    // A start time from the future can't be used to dodge the minimum-fill-time check.
    expect(sanitizeDraft({ values: filled, startedAt: context.now + 99_999 }, context)?.startedAt).toBe(context.now);
    expect(sanitizeDraft({ values: filled, startedAt: "soon" }, context)?.startedAt).toBe(context.now);
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
    expect(loadDraft(blocked, context)).toBeNull();
    expect(() => saveDraft(blocked, filled, 1)).not.toThrow();
    expect(() => clearDraft(blocked)).not.toThrow();
  });
});
