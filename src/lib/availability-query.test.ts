import { describe, expect, it } from "vitest";

import { parseAvailabilityQuery, timeGrid, toSearch } from "./availability-query";

const grid = timeGrid("06:00", "22:00", 30);
const bounds = { today: "2026-10-01", maxDate: "2026-11-26", grid };

describe("parseAvailabilityQuery", () => {
  it("defaults to today", () => {
    expect(parseAvailabilityQuery({}, bounds)).toEqual({ date: "2026-10-01", room: "", capacity: "", from: "", to: "" });
  });

  it("clamps dates to the bookable range", () => {
    expect(parseAvailabilityQuery({ date: "2026-09-01" }, bounds).date).toBe("2026-10-01");
    expect(parseAvailabilityQuery({ date: "2027-06-01" }, bounds).date).toBe("2026-11-26");
    expect(parseAvailabilityQuery({ date: "not-a-date" }, bounds).date).toBe("2026-10-01");
  });

  it("sanitizes room slugs and capacity", () => {
    const q = parseAvailabilityQuery({ room: "<script>conference-room", capacity: "-5" }, bounds);
    expect(q.room).toBe("scriptconference-room");
    expect(q.capacity).toBe("");
    expect(parseAvailabilityQuery({ capacity: "12" }, bounds).capacity).toBe("12");
  });

  it("keeps a time window only when both ends are valid grid times in order", () => {
    expect(parseAvailabilityQuery({ from: "09:00", to: "10:30" }, bounds)).toMatchObject({ from: "09:00", to: "10:30" });
    expect(parseAvailabilityQuery({ from: "10:30", to: "09:00" }, bounds)).toMatchObject({ from: "", to: "" });
    expect(parseAvailabilityQuery({ from: "09:15", to: "10:00" }, bounds)).toMatchObject({ from: "", to: "" });
    expect(parseAvailabilityQuery({ from: "09:00" }, bounds)).toMatchObject({ from: "", to: "" });
  });

  it("round-trips through toSearch", () => {
    const q = parseAvailabilityQuery({ date: "2026-10-05", room: "conference-room", from: "09:00", to: "10:00" }, bounds);
    expect(toSearch(q)).toBe("/availability?date=2026-10-05&room=conference-room&from=09%3A00&to=10%3A00");
  });
});

describe("timeGrid", () => {
  it("lists every boundary on the interval", () => {
    expect(timeGrid("06:00", "08:00", 30)).toEqual(["06:00", "06:30", "07:00", "07:30", "08:00"]);
  });
});
