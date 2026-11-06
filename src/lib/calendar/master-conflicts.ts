import type { Database } from "@/lib/supabase/database.types";

type Entry = Database["public"]["Functions"]["calendar_master_entries_with_occupancy"]["Returns"][number];
type Conflict = Database["public"]["Functions"]["calendar_master_conflicts"]["Returns"][number];

/** Conflict windows and occurrence occupancy use the same half-open interval. */
export function hasOccurrenceConflict(entry: Entry, conflicts: Conflict[]): boolean {
  if (!entry.event_id) return false;
  return conflicts.some(c => (c.event_id === entry.event_id || c.other_event_id === entry.event_id ||
    (c.details && typeof c.details === "object" && !Array.isArray(c.details) && Array.isArray(c.details.participants) &&
      c.details.participants.some(p => p && typeof p === "object" && !Array.isArray(p) && p.event_id === entry.event_id))) &&
    new Date(c.starts_at).getTime() < new Date(entry.occupancy_end).getTime() &&
    new Date(c.ends_at).getTime() > new Date(entry.occupancy_start).getTime());
}
