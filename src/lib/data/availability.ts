import "server-only";

import { addDaysToLocalDate, localToUtc, type LocalDate } from "@/lib/datetime";
import type { BusyBlock } from "@/lib/domain/availability";
import { createSupabasePublicClient } from "@/lib/supabase/public";

/**
 * Occupied times (pending + approved) for the given rooms over whole local days.
 * Contains no personal data. Never cached: availability must be current.
 */
export async function getBusyBlocks(
  roomIds: readonly string[],
  fromDate: LocalDate,
  days: number,
  timeZone: string,
): Promise<Map<string, BusyBlock[]>> {
  const from = localToUtc(fromDate, "00:00", timeZone);
  const to = localToUtc(addDaysToLocalDate(fromDate, days), "00:00", timeZone);
  const byRoom = new Map<string, BusyBlock[]>(roomIds.map((id) => [id, []]));
  if (!from || !to || roomIds.length === 0) return byRoom;

  const { data, error } = await createSupabasePublicClient().rpc("get_public_busy_blocks", {
    p_from: from.toISOString(),
    p_to: to.toISOString(),
    p_room_ids: [...roomIds],
  });
  if (error) throw error;

  for (const row of data) {
    byRoom.get(row.room_id)?.push({ start_at: row.start_at, end_at: row.end_at });
  }
  return byRoom;
}
