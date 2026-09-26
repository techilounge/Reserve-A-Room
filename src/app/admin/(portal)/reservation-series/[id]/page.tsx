import { ArrowLeft, CircleCheck, CircleX, Clock3, Repeat2, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { EndSeriesButton } from "@/components/admin/end-series-button";
import { StatusBadge } from "@/components/reservations/status-badge";
import { Badge } from "@/components/ui/badge";
import { formatInstant, formatLongDate, formatTimeRange, normalizeTime } from "@/lib/datetime";
import { getReservationSeries } from "@/lib/data/admin";
import { loadCatalog } from "@/lib/data/catalog";
import { recurrenceRuleFromStorage, recurrenceRuleLabel } from "@/lib/recurrence/preview";

export const metadata: Metadata = { title: "Recurring reservation" };

const SERIES_STATUS = {
  active: { label: "Active", variant: "default" as const },
  paused: { label: "Paused", variant: "destructive" as const },
  ended: { label: "Ended", variant: "outline" as const },
  cancelled: { label: "Cancelled", variant: "outline" as const },
};

export default async function ReservationSeriesPage({ params, searchParams }: PageProps<"/admin/reservation-series/[id]">) {
  const { id } = await params;
  const flags = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [detail, catalog] = await Promise.all([getReservationSeries(id), loadCatalog()]);
  if (!detail) notFound();

  const { series, occurrences, exceptions } = detail;
  const timeZone = catalog.ok ? catalog.catalog.settings.timeZone : series.timezone;
  const room = catalog.ok ? catalog.catalog.rooms.find((candidate) => candidate.id === series.room_id) : null;
  const ministry = catalog.ok ? catalog.catalog.ministries.find((candidate) => candidate.id === series.ministry_id) : null;
  const rule = recurrenceRuleFromStorage(series);
  const schedule = `${rule ? recurrenceRuleLabel(rule) : "Recurring schedule"}, ${formatTimeRange(normalizeTime(series.local_start_time), normalizeTime(series.local_end_time))}`;
  const status = SERIES_STATUS[series.status as keyof typeof SERIES_STATUS] ?? SERIES_STATUS.ended;
  const canEnd = series.status === "active" || series.status === "paused";

  return (
    <div className="flex flex-col gap-6">
      <Link href="/admin/reservations" className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden />
        All reservations
      </Link>

      {flags.created === "1" ? (
        <p role="status" className="flex items-center gap-2 rounded-lg border border-success-border bg-success-soft p-3 text-sm text-success-soft-foreground">
          <CircleCheck className="size-4 shrink-0" aria-hidden />
          Recurring series created. All dates shown below are confirmed.
        </p>
      ) : null}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Repeat2 className="size-5 text-primary" aria-hidden />
            <Badge variant={status.variant}>{status.label}</Badge>
          </div>
          <h1 className="text-2xl font-bold sm:text-3xl">{room?.name ?? "Recurring reservation"}</h1>
          <p className="text-lg text-muted-foreground">{schedule}</p>
          <p className="text-sm text-muted-foreground">
            Starts {formatLongDate(series.start_date)} · {series.end_date ? `Ends ${formatLongDate(series.end_date)}` : "Up to one year or 50 instances"}
          </p>
        </div>
        {canEnd ? <EndSeriesButton seriesId={series.id} /> : null}
      </div>

      {series.status === "paused" && series.paused_reason ? (
        <p role="alert" className="flex items-start gap-2 rounded-lg border border-warning-border bg-warning-soft p-3 text-sm text-warning-soft-foreground">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          {series.paused_reason}
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
        <section className="rounded-xl border bg-card p-5" aria-labelledby="series-details-heading">
          <h2 id="series-details-heading" className="mb-4 font-semibold">Series details</h2>
          <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-1">
            <div><dt className="text-muted-foreground">Requester</dt><dd className="font-medium">{series.requester_first_name} {series.requester_last_name}</dd></div>
            <div><dt className="text-muted-foreground">Email</dt><dd className="break-all font-medium">{series.requester_email}</dd></div>
            <div><dt className="text-muted-foreground">Ministry / group</dt><dd className="font-medium">{ministry?.name ?? series.other_ministry_name}</dd></div>
            <div><dt className="text-muted-foreground">Purpose</dt><dd className="font-medium">{series.purpose}</dd></div>
            <div><dt className="text-muted-foreground">Attendance</dt><dd className="font-medium">{series.estimated_attendance}</dd></div>
            <div><dt className="text-muted-foreground">Generated through</dt><dd className="font-medium">{series.materialized_through ? formatLongDate(series.materialized_through) : "Not yet"}</dd></div>
            <div><dt className="text-muted-foreground">Created</dt><dd className="font-medium">{formatInstant(series.created_at, timeZone)}</dd></div>
          </dl>
          <p className="mt-5 text-xs text-muted-foreground">
            Editing or cancelling one occurrence affects only that date. To change the overall schedule, end this series and create a new one.
          </p>
        </section>

        <section className="rounded-xl border bg-card p-5" aria-labelledby="occurrences-heading">
          <h2 id="occurrences-heading" className="font-semibold">Confirmed occurrences</h2>
          <p className="mb-4 text-sm text-muted-foreground">{occurrences.length} reservation{occurrences.length === 1 ? "" : "s"}</p>
          <ul className="divide-y">
            {occurrences.map((occurrence) => (
              <li key={occurrence.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <div>
                  <Link href={`/admin/reservations/${occurrence.id}`} className="font-medium underline-offset-4 hover:underline">
                    {formatLongDate(occurrence.occurrence_date)}
                  </Link>
                  <p className="font-mono text-xs text-muted-foreground">{occurrence.reference_code}</p>
                </div>
                <StatusBadge status={occurrence.status} />
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="rounded-xl border bg-card p-5" aria-labelledby="exceptions-heading">
        <h2 id="exceptions-heading" className="font-semibold">Skipped or failed dates</h2>
        {exceptions.length ? (
          <ul className="mt-3 divide-y">
            {exceptions.map((exception) => (
              <li key={exception.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                {exception.resolved_at ? <CircleCheck className="mt-0.5 size-4 shrink-0 text-success-soft-foreground" aria-hidden /> : <CircleX className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />}
                <div>
                  <p className="font-medium">{formatLongDate(exception.occurrence_date)}</p>
                  <p className="text-sm text-muted-foreground">{exception.message}</p>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
            <Clock3 className="size-4" aria-hidden /> No skipped dates or materialization errors.
          </p>
        )}
      </section>
    </div>
  );
}
