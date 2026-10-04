import { describe, expect, it } from "vitest";

import { todayInZone } from "@/lib/datetime";

import { parseReservationExportFilters, parseReservationListFilters } from "./filters";

const TZ = "America/Chicago";

describe("reservation filters", () => {
  it("shares validated list filters and ignores malformed values", () => {
    const filters = parseReservationListFilters(
      new URLSearchParams("status=pending&room=not-a-uuid&sort=created_desc&page=-2&q=%20Grace%20"),
      TZ,
    );
    expect(filters).toMatchObject({ search: "Grace", statuses: ["pending"], sort: "created_desc", page: 1 });
    expect(filters.roomId).toBeUndefined();
  });

  it("exports every date when none are chosen", () => {
    const result = parseReservationExportFilters(new URLSearchParams(), TZ);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.filters.from).toBeUndefined();
    expect(result.filters.to).toBeUndefined();
  });

  it("accepts open-ended and multi-year export ranges", () => {
    const wide = parseReservationExportFilters(new URLSearchParams("from=2020-01-01&to=2031-12-31"), TZ);
    expect(wide.ok && wide.filters).toMatchObject({ from: "2020-01-01", to: "2031-12-31" });
    const fromOnly = parseReservationExportFilters(new URLSearchParams("from=2026-03-01"), TZ);
    expect(fromOnly.ok && fromOnly.filters).toMatchObject({ from: "2026-03-01", to: undefined });
    const toOnly = parseReservationExportFilters(new URLSearchParams("to=2026-03-01"), TZ);
    expect(toOnly.ok && toOnly.filters).toMatchObject({ from: undefined, to: "2026-03-01" });
  });

  it("starts upcoming exports today, never in the past", () => {
    const today = todayInZone(TZ);
    const open = parseReservationExportFilters(new URLSearchParams("status=upcoming"), TZ);
    expect(open.ok && open.filters.from).toBe(today);
    const past = parseReservationExportFilters(new URLSearchParams("status=upcoming&from=2001-01-01"), TZ);
    expect(past.ok && past.filters.from).toBe(today);
  });

  it("rejects reversed and malformed export ranges", () => {
    expect(parseReservationExportFilters(new URLSearchParams("from=2026-10-01&to=2026-09-01"), TZ).ok).toBe(false);
    expect(parseReservationExportFilters(new URLSearchParams("from=nonsense"), TZ).ok).toBe(false);
    expect(parseReservationExportFilters(new URLSearchParams("to=2026-13-45"), TZ).ok).toBe(false);
  });
});
