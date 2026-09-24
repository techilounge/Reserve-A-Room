import { CalendarCheck, CalendarClock, CalendarDays, Hourglass, Inbox, Plus, type LucideIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PendingRequestCard } from "@/components/admin/pending-request-card";
import { EmptyState } from "@/components/feedback/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { StatusBadge } from "@/components/reservations/status-badge";
import { Button } from "@/components/ui/button";
import { formatLongDate, formatTimeRange, toLocalParts, todayInZone } from "@/lib/datetime";
import { getCalendar, getDashboardCounts, listReservations } from "@/lib/data/admin";
import { loadCatalog } from "@/lib/data/catalog";

export const metadata: Metadata = {
  title: "Dashboard",
};

function Stat({ label, value, icon: Icon, href }: { label: string; value: number; icon: LucideIcon; href: string }) {
  return (
    <Link href={href} className="group flex items-center gap-4 rounded-xl border bg-card p-4 transition-colors hover:border-ring">
      <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
        <Icon className="size-5" aria-hidden />
      </span>
      <span className="min-w-0">
        <span className="block text-2xl font-bold tabular-nums">{value}</span>
        <span className="block text-sm text-muted-foreground group-hover:text-foreground">{label}</span>
      </span>
    </Link>
  );
}

export default async function AdminDashboardPage() {
  const catalog = await loadCatalog();
  const timeZone = catalog.ok ? catalog.catalog.settings.timeZone : "America/Chicago";
  const today = todayInZone(timeZone);

  const [counts, pending, todays] = await Promise.all([
    getDashboardCounts(),
    listReservations({ statuses: ["pending"], sort: "start_asc", pageSize: 20 }),
    getCalendar(today, today),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Dashboard"
        description={formatLongDate(today)}
        actions={
          <Button asChild>
            <Link href="/admin/reservations/new">
              <Plus data-icon="inline-start" aria-hidden />
              New reservation
            </Link>
          </Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Pending approval" value={counts.pending_count} icon={Hourglass} href="/admin/reservations?status=pending" />
        <Stat label="Approved today" value={counts.approved_today_count} icon={CalendarCheck} href="/admin/reservations?status=approved&sort=created_desc" />
        <Stat label="Upcoming reservations" value={counts.upcoming_count} icon={CalendarClock} href="/admin/reservations?status=upcoming" />
        <Stat label="Reservations this week" value={counts.week_count} icon={CalendarDays} href="/admin/calendar?view=week" />
      </div>

      <section aria-labelledby="pending-heading" className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <h2 id="pending-heading" className="text-xl font-semibold">
            Pending Approval
          </h2>
          {pending.total > pending.rows.length ? (
            <Link href="/admin/reservations?status=pending" className="text-sm font-medium underline-offset-4 hover:underline">
              View all {pending.total}
            </Link>
          ) : null}
        </div>
        {pending.rows.length === 0 ? (
          <EmptyState icon={Inbox} title="No Pending Requests">
            No reservation requests are waiting for approval.
          </EmptyState>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {pending.rows.map((row) => (
              <PendingRequestCard key={row.id} row={row} timeZone={timeZone} />
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="today-heading" className="space-y-4">
        <h2 id="today-heading" className="text-xl font-semibold">
          Today
        </h2>
        {todays.length === 0 ? (
          <p className="rounded-xl border border-dashed bg-card p-6 text-center text-sm text-muted-foreground">
            No reservations today.
          </p>
        ) : (
          <ul className="divide-y rounded-xl border bg-card">
            {todays.map((entry) => (
              <li key={entry.id}>
                <Link
                  href={`/admin/reservations/${entry.id}`}
                  className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 p-4 hover:bg-accent"
                >
                  <span className="min-w-0">
                    <span className="block font-medium">
                      {formatTimeRange(toLocalParts(entry.start_at, timeZone).time, toLocalParts(entry.end_at, timeZone).time)} ·{" "}
                      {entry.room_name}
                    </span>
                    <span className="block truncate text-sm text-muted-foreground">
                      {entry.requester_first_name} {entry.requester_last_name} · {entry.ministry_name}
                    </span>
                  </span>
                  <StatusBadge status={entry.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
