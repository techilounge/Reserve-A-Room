import { describe, expect, it } from "vitest";
import type { Database } from "@/lib/supabase/database.types";
import { hasOccurrenceConflict } from "./master-conflicts";

type Entry = Database["public"]["Functions"]["calendar_master_entries_with_occupancy"]["Returns"][number];
type Conflict = Database["public"]["Functions"]["calendar_master_conflicts"]["Returns"][number];
const entry = (occupancy_start: string, occupancy_end: string): Entry => ({
  event_id:"recurring-event", occupancy_start, occupancy_end,
} as Entry);
const conflict = (starts_at: string, ends_at: string): Conflict => ({
  event_id:"recurring-event", other_event_id:null, starts_at, ends_at, details:null,
} as unknown as Conflict);

describe("master calendar conflict association", () => {
  it("matches setup-only and cleanup-only intervals but keeps another occurrence clean", () => {
    const setup = entry("2026-11-10T13:30:00Z", "2026-11-10T15:00:00Z");
    const clean = entry("2026-11-17T13:30:00Z", "2026-11-17T15:00:00Z");
    const cleanup = entry("2026-11-24T14:00:00Z", "2026-11-24T15:30:00Z");
    const conflicts = [conflict("2026-11-10T13:30:00Z", "2026-11-10T14:00:00Z"),
      conflict("2026-11-24T15:00:00Z", "2026-11-24T15:30:00Z")];
    const rows = [setup, clean, cleanup].map(row => ({ row, conflict:hasOccurrenceConflict(row, conflicts) }));
    expect(rows.map(row => row.conflict)).toEqual([true, false, true]);
    expect(rows.filter(row => row.conflict).map(row => row.row)).toEqual([setup, cleanup]);
    expect(rows.filter(row => !row.conflict).map(row => row.row)).toEqual([clean]);
  });

  it("respects half-open endpoints and requires a participating event", () => {
    const item = entry("2026-11-10T13:30:00Z", "2026-11-10T15:30:00Z");
    expect(hasOccurrenceConflict(item, [conflict("2026-11-10T15:30:00Z", "2026-11-10T16:00:00Z")])).toBe(false);
    expect(hasOccurrenceConflict({ ...item, event_id:null } as unknown as Entry, [conflict(item.occupancy_start, item.occupancy_end)])).toBe(false);
    expect(hasOccurrenceConflict(item, [{ ...conflict(item.occupancy_start, item.occupancy_end), event_id:"other", details:{ participants:[{ event_id:item.event_id }] } }])).toBe(true);
  });
});
