import { Clock, Phone, UsersRound } from "lucide-react";
import Link from "next/link";

import { ReservationActions } from "@/components/admin/reservation-actions";
import { CapacityWarning } from "@/components/reservations/capacity-warning";
import { Button } from "@/components/ui/button";
import { formatInstant, formatLongDate, formatTimeRange, toLocalParts } from "@/lib/datetime";
import type { AdminReservationRow } from "@/lib/data/admin";
import { formatPhone } from "@/lib/format";

/** Everything needed to decide on a request, without opening it (brief §26). */
export function PendingRequestCard({ row, timeZone }: { row: AdminReservationRow; timeZone: string }) {
  const start = toLocalParts(row.start_at, timeZone);
  const end = toLocalParts(row.end_at, timeZone);
  return (
    <article className="flex flex-col gap-3 rounded-xl border bg-card p-4 sm:p-5" aria-labelledby={`pending-${row.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 id={`pending-${row.id}`} className="font-semibold">
            {row.room_name}
          </h3>
          <p className="text-sm text-muted-foreground">
            {formatLongDate(start.date)} · {formatTimeRange(start.time, end.time)}
          </p>
        </div>
        <span className="font-mono text-xs text-muted-foreground">{row.reference_code}</span>
      </div>

      <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="sr-only">Requester</dt>
          <dd className="font-medium">
            {row.requester_first_name} {row.requester_last_name}
          </dd>
        </div>
        <div>
          <dt className="sr-only">Phone</dt>
          <dd className="inline-flex items-center gap-1.5">
            <Phone className="size-3.5 text-muted-foreground" aria-hidden />
            <a href={`tel:${row.requester_phone}`} className="underline-offset-4 hover:underline">
              {formatPhone(row.requester_phone)}
            </a>
          </dd>
        </div>
        <div>
          <dt className="sr-only">Ministry</dt>
          <dd>{row.ministry_name}</dd>
        </div>
        <div>
          <dt className="sr-only">Estimated attendance</dt>
          <dd className="inline-flex items-center gap-1.5">
            <UsersRound className="size-3.5 text-muted-foreground" aria-hidden />
            {row.estimated_attendance} expected · room holds {row.room_capacity}
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="sr-only">Purpose</dt>
          <dd className="line-clamp-2 text-muted-foreground">{row.purpose}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="sr-only">Submitted</dt>
          <dd className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="size-3.5" aria-hidden />
            Submitted {formatInstant(row.created_at, timeZone)}
          </dd>
        </div>
      </dl>

      <CapacityWarning estimated={row.estimated_attendance} capacity={row.room_capacity} audience="staff" />

      <div className="flex flex-wrap gap-2">
        <ReservationActions reservationId={row.id} reference={row.reference_code} status={row.status} size="sm" include={["approve"]} />
        <Button asChild size="sm" variant="outline">
          <Link href={`/admin/reservations/${row.id}`}>
            Review<span className="sr-only"> {row.reference_code}</span>
          </Link>
        </Button>
      </div>
    </article>
  );
}
