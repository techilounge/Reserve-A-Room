import { CalendarClock, ChevronLeft, ChevronRight, Mail, Phone } from "lucide-react";
import type { Metadata } from "next";

import { PaginationLink } from "@/components/admin/pagination-link";
import { EmptyState } from "@/components/feedback/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { formatCompactDate, formatInstant, formatTime, normalizeTime } from "@/lib/datetime";
import { loadCatalog } from "@/lib/data/catalog";
import { getRecurringReservationRequests } from "@/lib/data/super";

export const metadata: Metadata = { title: "Recurring Requests" };
const PAGE_SIZE = 20;

export default async function RecurringRequestsPage({ searchParams }: PageProps<"/admin/recurring-requests">) {
  const raw = await searchParams;
  let page = Math.max(1, Number.parseInt(String(raw.page ?? "1"), 10) || 1);
  const catalog = await loadCatalog();
  const timeZone = catalog.ok ? catalog.catalog.settings.timeZone : "America/Chicago";
  const roomNames = new Map(catalog.ok ? catalog.catalog.rooms.map((room) => [room.id, room.name]) : []);
  let result = await getRecurringReservationRequests(page, PAGE_SIZE);
  if (page > 1 && result.rows.length === 0) {
    page = 1;
    result = await getRecurringReservationRequests(page, PAGE_SIZE);
  }
  const pages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
  const href = (nextPage: number) => `/admin/recurring-requests?page=${nextPage}`;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Recurring Requests"
        description="Guest requests for repeating dates. Review availability and contact the requester before creating a staff reservation series."
      />
      {result.rows.length === 0 ? (
        <EmptyState icon={CalendarClock} title="No recurring requests yet">New requests will appear here and in Notifications.</EmptyState>
      ) : (
        <ol className="grid gap-4">
          {result.rows.map((request) => (
            <li key={request.id} id={request.id} className="space-y-4 rounded-xl border bg-card p-4 sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">{request.reference_code} · {roomNames.get(request.room_id) ?? "Room"}</p>
                  <p className="text-sm text-muted-foreground">Submitted {formatInstant(request.created_at, timeZone)}</p>
                </div>
                <span className="rounded-full bg-info-soft px-2.5 py-1 text-xs font-semibold text-info-soft-foreground capitalize">{request.status}</span>
              </div>
              <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <div><dt className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Preferred start</dt><dd>{formatCompactDate(request.preferred_start_date)}</dd></div>
                <div><dt className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Time</dt><dd>{formatTime(normalizeTime(request.local_start_time))} – {formatTime(normalizeTime(request.local_end_time))}</dd></div>
                <div><dt className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Attendance</dt><dd>{request.estimated_attendance}</dd></div>
                <div><dt className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Requester</dt><dd>{request.requester_first_name} {request.requester_last_name}</dd></div>
              </dl>
              <div className="space-y-1 text-sm"><p className="font-medium">Repeating schedule</p><p className="whitespace-pre-wrap text-muted-foreground">{request.recurrence_description}</p></div>
              <div className="space-y-1 text-sm"><p className="font-medium">Purpose</p><p className="whitespace-pre-wrap text-muted-foreground">{request.purpose}</p></div>
              {request.requester_notes ? <div className="space-y-1 text-sm"><p className="font-medium">Notes</p><p className="whitespace-pre-wrap text-muted-foreground">{request.requester_notes}</p></div> : null}
              <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
                <a className="inline-flex items-center gap-1.5 underline underline-offset-4" href={`mailto:${request.requester_email}`}><Mail className="size-4" aria-hidden />{request.requester_email}</a>
                <a className="inline-flex items-center gap-1.5 underline underline-offset-4" href={`tel:${request.requester_phone}`}><Phone className="size-4" aria-hidden />{request.requester_phone}</a>
              </div>
            </li>
          ))}
        </ol>
      )}
      {pages > 1 ? (
        <nav aria-label="Pagination" className="flex items-center justify-between">
          <PaginationLink href={page > 1 ? href(page - 1) : null}><ChevronLeft aria-hidden /> Newer</PaginationLink>
          <span className="text-sm text-muted-foreground">Page {page} of {pages}</span>
          <PaginationLink href={page < pages ? href(page + 1) : null}>Older <ChevronRight aria-hidden /></PaginationLink>
        </nav>
      ) : null}
    </div>
  );
}
