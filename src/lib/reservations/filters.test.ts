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

  it("uses the current calendar year when export dates are omitted", () => {
    const result = parseReservationExportFilters(new URLSearchParams(), TZ);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const year = todayInZone(TZ).slice(0, 4);
    expect(result.filters).toMatchObject({ from: `${year}-01-01`, to: `${year}-12-31`, pageSize: 1000 });
  });

  it("rejects reversed and over-one-year export ranges", () => {
    expect(parseReservationExportFilters(new URLSearchParams("from=2026-10-01&to=2026-09-01"), TZ).ok).toBe(false);
    expect(parseReservationExportFilters(new URLSearchParams("from=2026-01-01&to=2027-01-02"), TZ).ok).toBe(false);
  });
});
