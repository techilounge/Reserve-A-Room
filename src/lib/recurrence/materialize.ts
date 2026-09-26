import "server-only";

import { compareLocalDates, localToUtc, normalizeTime, type LocalDate } from "@/lib/datetime";
import { newGuestToken } from "@/lib/domain/guest-token";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

import { expandRecurrenceDates } from "./dates";
import { recurrenceRuleFromStorage } from "./preview";

type Totals = { claimed: number; created: number; exceptions: number; failed: number };

export async function materializeDueReservationSeries(limit = 20): Promise<Totals> {
  const supabase = createSupabaseServiceClient();
  const { data: claims, error } = await supabase.rpc("claim_series_to_materialize", { p_limit: limit });
  if (error) throw error;

  const totals: Totals = { claimed: claims?.length ?? 0, created: 0, exceptions: 0, failed: 0 };
  for (const claim of claims ?? []) {
    try {
      const rule = recurrenceRuleFromStorage(claim);
      if (!rule) throw new Error(`Recurring series ${claim.id} has an invalid stored rule.`);

      const dates = expandRecurrenceDates(
        {
          startDate: claim.start_date,
          endDate: claim.end_date ?? undefined,
          start: normalizeTime(claim.local_start_time),
          end: normalizeTime(claim.local_end_time),
          rule,
        },
        { throughDate: claim.target_through },
      )
        .filter((date) => !claim.materialized_through || compareLocalDates(date, claim.materialized_through) > 0)
        .slice(0, Math.max(0, claim.instance_limit - claim.occurrence_count));

      const occurrences: Record<string, string>[] = [];
      const exceptions: { occurrence_date: LocalDate; reason: string; message: string }[] = [];
      for (const date of dates) {
        const startAt = localToUtc(date, normalizeTime(claim.local_start_time), claim.timezone);
        const endAt = localToUtc(date, normalizeTime(claim.local_end_time), claim.timezone);
        if (!startAt || !endAt) {
          exceptions.push({
            occurrence_date: date,
            reason: "invalid_local_time",
            message: "The configured wall-clock time does not exist on this date because of daylight saving time.",
          });
          continue;
        }
        const link = newGuestToken();
        occurrences.push({
          occurrence_date: date,
          start_at: startAt.toISOString(),
          end_at: endAt.toISOString(),
          token_hash: link.hash.replace(/^\\x/, ""),
          token_seed: link.seed.replace(/^\\x/, ""),
        });
      }

      const { data: result, error: materializeError } = await supabase
        .rpc("materialize_series_occurrences", {
          p_series_id: claim.id,
          p_claim_id: claim.claim_id,
          p_occurrences: occurrences,
          p_materialized_through: claim.target_through,
          p_exceptions: exceptions,
        })
        .single();
      if (materializeError || !result) throw materializeError ?? new Error("Materialization returned no result.");
      totals.created += result.created_count;
      totals.exceptions += result.exception_count;
    } catch (error) {
      totals.failed += 1;
      console.error("[recurrence] series materialization failed", claim.id, error);
    }
  }
  return totals;
}
