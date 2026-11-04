import { describe, expect, it } from "vitest";
import { calendarNoticeIdempotencyKey, calendarNoticeRetrySafe } from "./calendar-notice-retry";

describe("calendar notice retries", () => {
  it("uses the same provider key for every attempt", () => {
    expect(calendarNoticeIdempotencyKey("example")).toBe("calendar-notice-example");
  });
  it("rejects invalid timestamps and uncertain retries beyond the safe window", () => {
    const now = Date.parse("2027-01-02T12:00:00Z");
    expect(calendarNoticeRetrySafe("bad",1,now)).toBe(false);
    expect(calendarNoticeRetrySafe("2027-01-01T12:00:00Z",1,now)).toBe(true);
    expect(calendarNoticeRetrySafe("2027-01-01T12:00:00Z",2,now)).toBe(false);
    expect(calendarNoticeRetrySafe("2027-01-01T14:00:00Z",2,now)).toBe(true);
  });
});
