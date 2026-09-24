import { ChevronLeft, ChevronRight, Plus, SearchX, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PaginationLink } from "@/components/admin/pagination-link";
import { ReservationFilters } from "@/components/admin/reservation-filters";
import { EmptyState } from "@/components/feedback/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { StatusBadge } from "@/components/reservations/status-badge";
import { Button } from "@/components/ui/button";
import { formatShortDate, formatTimeRange, isLocalDate, toLocalParts, todayInZone } from "@/lib/datetime";
import { listReservations, SORTS, type AdminReservationRow, type ReservationFilters as Filters } from "@/lib/data/admin";
import { loadCatalog } from "@/lib/data/catalog";
import { evaluateCapacity } from "@/lib/domain/rooms/capacity";
import { approvalLabel } from "@/lib/reservations/labels";
import type { Enums } from "@/lib/supabase/database.types";

export const metadata: Metadata = {
  title: "Reservations",
};

const PAGE_SIZE = 25;
const STATUSES = ["pending", "approved", "declined", "cancelled"] as const;
const UUID = /^[0-9a-f-]{36}$/i;

export default async function AdminReservationsPage({ searchParams }: PageProps<"/admin/reservations">) {
  const raw = await searchParams;
  const one = (key: string) => (typeof raw[key] === "string" ? (raw[key] as string) : "");

  const catalog = await loadCatalog();
  const timeZone = catalog.ok ? catalog.catalog.settings.timeZone : "America/Chicago";
  const status = one("status");
  const filters: Filters = {
    search: one("q").slice(0, 100),
    statuses:
      status === "upcoming"
        ? ["pending", "approved"]
        : (STATUSES as readonly string[]).includes(status)
          ? [status as Enums<"reservation_status">]
          : undefined,
    roomId: UUID.test(one("room")) ? one("room") : undefined,
    ministryId: UUID.test(one("ministry")) ? one("ministry") : undefined,
    from: isLocalDate(one("from")) ? one("from") : status === "upcoming" ? todayInZone(timeZone) : undefined,
    to: isLocalDate(one("to")) ? one("to") : undefined,
    approval: one("approval") === "required" || one("approval") === "instant" ? (one("approval") as "required" | "instant") : undefined,
    sort: (SORTS as readonly string[]).includes(one("sort")) ? (one("sort") as Filters["sort"]) : "start_asc",
    page: Math.max(1, Number.parseInt(one("page"), 10) || 1),
    pageSize: PAGE_SIZE,
  };

  const { rows, total } = await listReservations(filters);
  const page = filters.page ?? 1;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageHref = (p: number) => {
    const next = new URLSearchParams(Object.entries(raw).filter(([, v]) => typeof v === "string") as [string, string][]);
    next.set("page", String(p));
    return `/admin/reservations?${next.toString()}`;
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Reservations"
        description="Search, review and manage every reservation."
        actions={
          <Button asChild>
            <Link href="/admin/reservations/new">
              <Plus data-icon="inline-start" aria-hidden />
              New reservation
            </Link>
          </Button>
        }
      />
      <ReservationFilters
        rooms={catalog.ok ? catalog.catalog.rooms.map(({ id, name }) => ({ id, name })) : []}
        ministries={catalog.ok ? catalog.catalog.ministries : []}
      />

      <p className="text-sm text-muted-foreground" aria-live="polite">
        {total === 0 ? "No reservations found." : `${total} reservation${total === 1 ? "" : "s"}`}
      </p>

      {rows.length === 0 ? (
        <EmptyState icon={SearchX} title="No reservations match">
          Try a different search or clear the filters.
        </EmptyState>
      ) : (
        <>
          {/* Cards on phones and tablets */}
          <ul className="grid gap-3 lg:hidden">
            {rows.map((row) => (
              <li key={row.id}>
                <ReservationCard row={row} timeZone={timeZone} />
              </li>
            ))}
          </ul>

          {/* Table on desktop */}
          <div className="hidden overflow-hidden rounded-xl border bg-card lg:block">
            <table className="w-full text-sm">
              <caption className="sr-only">Reservations</caption>
              <thead className="border-b bg-muted/50 text-left text-xs tracking-wide text-muted-foreground uppercase">
                <tr>
                  <th scope="col" className="px-4 py-3 font-semibold">When</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Room</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Requester</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Ministry / purpose</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((row) => {
                  const start = toLocalParts(row.start_at, timeZone);
                  const end = toLocalParts(row.end_at, timeZone);
                  const over = evaluateCapacity(row.estimated_attendance, row.room_capacity).exceeds;
                  return (
                    <tr key={row.id} className="align-top hover:bg-accent/50">
                      <td className="px-4 py-3 whitespace-nowrap">
                        <Link href={`/admin/reservations/${row.id}`} className="font-medium underline-offset-4 hover:underline">
                          {formatShortDate(start.date)}
                        </Link>
                        <div className="text-muted-foreground">{formatTimeRange(start.time, end.time)}</div>
                        <div className="font-mono text-xs text-muted-foreground">{row.reference_code}</div>
                      </td>
                      <td className="px-4 py-3">
                        {row.room_name}
                        <div className="text-muted-foreground">
                          {row.estimated_attendance} / {row.room_capacity}
                          {over ? (
                            <span className="ml-1.5 inline-flex items-center gap-1 text-warning-soft-foreground">
                              <TriangleAlert className="size-3.5" aria-hidden />
                              Over capacity
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {row.requester_first_name} {row.requester_last_name}
                        <div className="max-w-56 truncate text-muted-foreground">{row.requester_email}</div>
                      </td>
                      <td className="max-w-72 px-4 py-3">
                        {row.ministry_name}
                        <div className="truncate text-muted-foreground">{row.purpose}</div>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={row.status} />
                        <div className="mt-1 text-xs text-muted-foreground">{approvalLabel(row)}</div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {pages > 1 ? (
            <nav aria-label="Pagination" className="flex items-center justify-between gap-2">
              <PaginationLink href={page > 1 ? pageHref(page - 1) : null}>
                <ChevronLeft data-icon="inline-start" aria-hidden />
                Previous
              </PaginationLink>
              <span className="text-sm text-muted-foreground">
                Page {page} of {pages}
              </span>
              <PaginationLink href={page < pages ? pageHref(page + 1) : null}>
                Next
                <ChevronRight data-icon="inline-end" aria-hidden />
              </PaginationLink>
            </nav>
          ) : null}
        </>
      )}
    </div>
  );
}

function ReservationCard({ row, timeZone }: { row: AdminReservationRow; timeZone: string }) {
  const start = toLocalParts(row.start_at, timeZone);
  const end = toLocalParts(row.end_at, timeZone);
  const over = evaluateCapacity(row.estimated_attendance, row.room_capacity).exceeds;
  return (
    <Link href={`/admin/reservations/${row.id}`} className="block rounded-xl border bg-card p-4 hover:border-ring">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold">
            {formatShortDate(start.date)} · {formatTimeRange(start.time, end.time)}
          </p>
          <p className="text-sm text-muted-foreground">{row.room_name}</p>
        </div>
        <StatusBadge status={row.status} />
      </div>
      <p className="mt-2 text-sm">
        {row.requester_first_name} {row.requester_last_name} · {row.ministry_name}
      </p>
      <p className="truncate text-sm text-muted-foreground">{row.purpose}</p>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="font-mono">{row.reference_code}</span>
        <span>{approvalLabel(row)}</span>
        {over ? (
          <span className="inline-flex items-center gap-1 text-warning-soft-foreground">
            <TriangleAlert className="size-3.5" aria-hidden />
            Over capacity
          </span>
        ) : null}
      </div>
    </Link>
  );
}
