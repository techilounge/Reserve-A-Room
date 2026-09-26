import { describe, expect, it } from "vitest";

import { staffReservationSchema } from "./staff-reservation";

const reservation = {
  roomId: "5d1c0c2e-6f3a-4a8e-9c1d-2b7e8f9a0b1c",
  date: "2026-10-15",
  start: "14:00",
  end: "15:00",
  firstName: "Grace",
  lastName: "Hopper",
  email: "grace@example.org",
  phone: "(512) 555-0123",
  ministryId: "8a2f3b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b",
  otherMinistryName: "",
  purpose: "Planning meeting",
  estimatedAttendance: "12",
  setupRequirements: "",
  requesterNotes: "",
  legalAccepted: true,
};

describe("staffReservationSchema recurrence", () => {
  it("defaults existing single-reservation submissions to no recurrence", () => {
    expect(staffReservationSchema.parse({ reservation, notify: true }).recurrence).toEqual({ frequency: "none" });
  });

  it("accepts interval-weekly and ordinal-monthly schedules with optional inclusive end dates", () => {
    expect(
      staffReservationSchema.parse({
        reservation,
        recurrence: { frequency: "weekly", interval: 2, weekdays: [1, 4], endDate: "2027-10-15" },
        notify: true,
      }).recurrence,
    ).toEqual({ frequency: "weekly", interval: 2, weekdays: [1, 4], endDate: "2027-10-15" });
    expect(
      staffReservationSchema.parse({
        reservation,
        recurrence: { frequency: "monthly_nth_weekday", interval: 1, weekday: 6, ordinals: [2, 4], endDate: "" },
        notify: false,
      }).recurrence,
    ).toEqual({
      frequency: "monthly_nth_weekday",
      interval: 1,
      weekday: 6,
      ordinals: [2, 4],
      endDate: undefined,
    });
  });

  it("rejects duplicate or missing monthly week selections", () => {
    for (const ordinals of [[], [2, 2]]) {
      expect(
        staffReservationSchema.safeParse({
          reservation,
          recurrence: { frequency: "monthly_nth_weekday", interval: 1, weekday: 6, ordinals },
          notify: true,
        }).success,
      ).toBe(false);
    }
  });

  it("accepts daily, weekday, calendar-monthly, and yearly schedules", () => {
    for (const recurrence of [
      { frequency: "daily", interval: 3 },
      { frequency: "weekdays" },
      { frequency: "monthly_day", interval: 3, dayOfMonth: 15 },
      { frequency: "yearly_date", month: 12, dayOfMonth: 25 },
      { frequency: "yearly_nth_weekday", month: 11, weekday: 4, ordinal: 4 },
    ]) {
      expect(staffReservationSchema.safeParse({ reservation, recurrence, notify: true }).success).toBe(true);
    }
  });

  it("rejects end dates before the start or more than one year later", () => {
    for (const endDate of ["2026-10-14", "2027-10-16"]) {
      const result = staffReservationSchema.safeParse({
        reservation,
        recurrence: { frequency: "weekly", interval: 1, weekdays: [4], endDate },
        notify: true,
      });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.issues.some((issue) => issue.path.join(".") === "recurrence.endDate")).toBe(true);
    }
  });
});
