import { describe, expect, it } from "vitest";

import {
  advanceLabel,
  advanceLimitMessage,
  effectiveAdvanceRule,
  horizonDate,
  isValidAdvanceRule,
  isWithinHorizon,
} from "./advance-booking";
import { capacityWarningForStaff, capacityWarningMessage, evaluateCapacity } from "./capacity";
import { roomPolicySummary } from "./policy";

const settings = { default_max_advance_value: 8, default_max_advance_unit: "week" as const };

describe("advance booking", () => {
  it("uses the room's own rule, or the application default", () => {
    expect(effectiveAdvanceRule({ max_advance_value: 4, max_advance_unit: "week" }, settings)).toEqual({ value: 4, unit: "week" });
    expect(effectiveAdvanceRule({ max_advance_value: null, max_advance_unit: null }, settings)).toEqual({ value: 8, unit: "week" });
  });

  it("computes the last selectable date (inclusive), matching the brief's example", () => {
    // "If today is October 1 and a room allows reservations up to 4 weeks in advance…"
    expect(horizonDate("2026-10-01", { value: 4, unit: "week" })).toBe("2026-10-29");
    expect(horizonDate("2026-10-01", { value: 90, unit: "day" })).toBe("2026-12-30");
    expect(horizonDate("2026-10-01", { value: 3, unit: "month" })).toBe("2027-01-01");
  });

  it("clamps months to the end of the month", () => {
    expect(horizonDate("2027-01-31", { value: 1, unit: "month" })).toBe("2027-02-28");
    expect(horizonDate("2028-01-31", { value: 1, unit: "month" })).toBe("2028-02-29");
  });

  it("checks whether a date is bookable", () => {
    const rule = { value: 4, unit: "week" } as const;
    expect(isWithinHorizon("2026-10-29", "2026-10-01", rule)).toBe(true);
    expect(isWithinHorizon("2026-10-30", "2026-10-01", rule)).toBe(false);
    expect(isWithinHorizon("2026-09-30", "2026-10-01", rule)).toBe(false);
  });

  it("describes the rule", () => {
    expect(advanceLabel({ value: 4, unit: "week" })).toBe("4 weeks");
    expect(advanceLabel({ value: 1, unit: "month" })).toBe("1 month");
    expect(advanceLimitMessage({ value: 4, unit: "week" })).toBe("This room may only be reserved up to 4 weeks in advance.");
  });

  it("validates bounds like the database", () => {
    expect(isValidAdvanceRule({ value: 24, unit: "month" })).toBe(true);
    expect(isValidAdvanceRule({ value: 25, unit: "month" })).toBe(false);
    expect(isValidAdvanceRule({ value: 0, unit: "day" })).toBe(false);
    expect(isValidAdvanceRule({ value: 1.5, unit: "week" })).toBe(false);
  });
});

describe("capacity warning", () => {
  it("warns when attendance exceeds capacity, without changing the number", () => {
    const check = evaluateCapacity(32, 25);
    expect(check).toEqual({ exceeds: true, capacity: 25, estimated: 32, overBy: 7 });
    if (check.exceeds) {
      expect(capacityWarningMessage(check)).toBe(
        "This room is configured for a maximum of 25 people, but you entered 32 attendees. Please consider selecting a larger room.",
      );
      expect(capacityWarningForStaff(check)).toBe("Estimated attendance (32) exceeds this room's capacity of 25 by 7.");
    }
  });

  it("does not warn at or below capacity", () => {
    expect(evaluateCapacity(25, 25).exceeds).toBe(false);
    expect(evaluateCapacity(1, 25).exceeds).toBe(false);
  });
});

describe("policy summary", () => {
  it("reads naturally for both approval modes", () => {
    expect(
      roomPolicySummary({ capacity: 15, approvalRequired: true, foodDrinksAllowed: false, advance: { value: 4, unit: "week" } }),
    ).toBe("Guests may reserve this room up to 4 weeks in advance. Reservations require approval. Food and drinks are not allowed.");
    expect(
      roomPolicySummary({ capacity: 15, approvalRequired: false, foodDrinksAllowed: true, advance: { value: 3, unit: "month" } }),
    ).toBe("Guests may reserve this room up to 3 months in advance. Reservations are confirmed immediately. Food and drinks are allowed.");
  });
});
