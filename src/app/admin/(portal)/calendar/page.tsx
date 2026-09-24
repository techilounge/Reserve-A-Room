import { Ban, ChevronLeft, ChevronRight, CircleCheck, CircleX, Hourglass } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { CALENDAR_VIEWS, datesBetween, shiftAnchor, viewRange, type CalendarView } from "@/lib/calendar";
import { formatLongDate, formatShortDate, formatTime, isLocalDate, toLocalParts, todayInZone, type LocalDate } from "@/lib/datetime";
import { getCalendar, type CalendarEntry } from "@/lib/data/admin";
import { loadCatalog } from "@/lib/data/catalog";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Calendar",
};

const STATUS_STYLE = {
  pending: { icon: Hourglass, label: "Pending", className: "border-warning-border bg-warning-soft text-warning-soft-foreground" },
  approved: { icon: CircleCheck, label: "Approved", className: "border-success-border bg-success-soft text-success-soft-foreground" },
  declined: { icon: CircleX, label: "Declined", className: "border-neutral-border bg-neutral-soft text-neutral-soft-foreground line-through" },
  cancelled: { icon: Ban, label: "Cancelled", className: "border-neutral-border bg-neutral-soft text-neutral-soft-foreground line-through" },
} as const;

type Entry = CalendarEntry & { date: LocalDate; start: string; end: string };

function EntryChip({ entry, compact = false }: { entry: Entry; compact?: boolean }) {
  const style = STATUS_STYLE[entry.status];
  const Icon = style.icon;
  return (
    <Link
      href={`/admin/reservations/${entry.id}`}
      className={cn("flex min-w-0 items-start gap-1.5 rounded-md border px-2 py-1 text-xs hover:brightness-95", style.className)}
    >
      <Icon className="mt-0.5 size-3 shrink-0" aria-hidden />
      <span className="min-w-0">
        <span className="sr-only">{style.label}: </span>
        <span className="font-semibold">{formatTime(entry.start)}</span>{" "}
        <span className={compact ? "block truncate" : ""}>{entry.room_name}</span>
        {!compact ? (
          <span className="block truncate opacity-90">
            {entry.requester_first_name} {entry.requester_last_name} · {entry.ministry_name}
          </span>
        ) : null}
      </span>
    </Link>
  );
}

export default async function AdminCalendarPage({ searchParams }: PageProps<"/admin/calendar">) {
  const raw = await searchParams;
  const catalog = await loadCatalog();
  const timeZone = catalog.ok ? catalog.catalog.settings.timeZone : "America/Chicago";
  const today = todayInZone(timeZone);
  const view: CalendarView = (CALENDAR_VIEWS as readonly string[]).includes(String(raw.view)) ? (raw.view as CalendarView) : "month";
  const anchor = typeof raw.date === "string" && isLocalDate(raw.date) ? raw.date : today;
  const roomId = typeof raw.room === "string" && /^[0-9a-f-]{36}$/i.test(raw.room) ? raw.room : undefined;
  const includeCancelled = raw.cancelled === "1";
  const { from, to } = viewRange(view, anchor);

  const entries: Entry[] = (await getCalendar(from, to, { roomId, includeCancelled })).map((e) => {
    const s = toLocalParts(e.start_at, timeZone);
    return { ...e, date: s.date, start: s.time, end: toLocalParts(e.end_at, timeZone).time };
  });
  const byDate = new Map<LocalDate, Entry[]>();
  for (const e of entries) byDate.set(e.date, [...(byDate.get(e.date) ?? []), e]);

  const href = (changes: Record<string, string | undefined>) => {
    const params = new URLSearchParams({ view, date: anchor, ...(roomId ? { room: roomId } : {}), ...(includeCancelled ? { cancelled: "1" } : {}) });
    for (const [k, v] of Object.entries(changes)) {
      if (v) params.set(k, v);
      else params.delete(k);
    }
    return `/admin/calendar?${params.toString()}`;
  };
  const days = datesBetween(from, to);
  const title =
    view === "month"
      ? new Date(`${anchor.slice(0, 7)}-01T12:00:00Z`).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })
      : view === "week"
        ? `${formatShortDate(from)} – ${formatShortDate(to)}`
        : formatLongDate(anchor);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Calendar" description="Reservations by day. Select one to review it." />

      <div className="flex flex-col gap-3 rounded-xl border bg-card p-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="icon" aria-label="Previous">
            <Link href={href({ date: shiftAnchor(view, anchor, -1) })}>
              <ChevronLeft aria-hidden />
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href={href({ date: today })}>Today</Link>
          </Button>
          <Button asChild variant="outline" size="icon" aria-label="Next">
            <Link href={href({ date: shiftAnchor(view, anchor, 1) })}>
              <ChevronRight aria-hidden />
            </Link>
          </Button>
          <h2 className="ml-1 text-lg font-semibold" aria-live="polite">
            {title}
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <nav aria-label="Calendar view" className="flex rounded-lg border p-0.5">
            {CALENDAR_VIEWS.map((v) => (
              <Link
                key={v}
                href={href({ view: v })}
                aria-current={v === view ? "page" : undefined}
                className={cn(
                  "min-h-9 rounded-md px-3 py-1.5 text-sm font-medium capitalize",
                  v === view ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent",
                )}
              >
                {v}
              </Link>
            ))}
          </nav>
          <form action="/admin/calendar" className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="view" value={view} />
            <input type="hidden" name="date" value={anchor} />
            <label className="sr-only" htmlFor="calendar-room">
              Room
            </label>
            <select
              id="calendar-room"
              name="room"
              defaultValue={roomId ?? ""}
              className="h-9 rounded-lg border border-input bg-background px-2 text-sm"
            >
              <option value="">All rooms</option>
              {catalog.ok
                ? catalog.catalog.rooms.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))
                : null}
            </select>
            <label className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" name="cancelled" value="1" defaultChecked={includeCancelled} className="size-4" />
              Show cancelled
            </label>
            <Button type="submit" size="sm" variant="secondary">
              Apply
            </Button>
          </form>
        </div>
      </div>

      {/* Agenda: always on phones; the main view for "day". */}
      <div className={cn("space-y-4", view !== "day" && "lg:hidden")}>
        {days.filter((d) => byDate.has(d) || d === anchor).length === 0 || entries.length === 0 ? (
          <p className="rounded-xl border border-dashed bg-card p-8 text-center text-sm text-muted-foreground">
            No reservations in this period.
          </p>
        ) : (
          days
            .filter((d) => byDate.has(d))
            .map((d) => (
              <section key={d} aria-label={formatLongDate(d)} className="rounded-xl border bg-card">
                <h3 className={cn("border-b px-4 py-2 text-sm font-semibold", d === today && "text-primary")}>
                  {formatLongDate(d)}
                  {d === today ? " · Today" : ""}
                </h3>
                <ul className="space-y-2 p-3">
                  {byDate.get(d)!.map((e) => (
                    <li key={e.id}>
                      <EntryChip entry={e} />
                    </li>
                  ))}
                </ul>
              </section>
            ))
        )}
      </div>

      {view !== "day" ? (
        <div className="hidden overflow-hidden rounded-xl border bg-card lg:block">
          <div className="grid grid-cols-7 border-b bg-muted/50 text-center text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
              <div key={d} className="py-2">
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {days.map((d) => {
              const list = byDate.get(d) ?? [];
              const limit = view === "month" ? 3 : 20;
              const outside = view === "month" && d.slice(0, 7) !== anchor.slice(0, 7);
              return (
                <div
                  key={d}
                  className={cn(
                    "min-h-28 border-r border-b p-1.5 last:border-r-0 [&:nth-child(7n)]:border-r-0",
                    view === "week" && "min-h-64",
                    outside && "bg-muted/30",
                  )}
                >
                  <Link
                    href={href({ view: "day", date: d })}
                    className={cn(
                      "mb-1 inline-flex size-7 items-center justify-center rounded-full text-xs font-medium hover:bg-accent",
                      d === today && "bg-primary text-primary-foreground hover:bg-primary",
                      outside && "text-muted-foreground",
                    )}
                    aria-label={`${formatLongDate(d)}${list.length ? `, ${list.length} reservation${list.length === 1 ? "" : "s"}` : ""}`}
                  >
                    {Number(d.slice(8))}
                  </Link>
                  <ul className="space-y-1">
                    {list.slice(0, limit).map((e) => (
                      <li key={e.id}>
                        <EntryChip entry={e} compact={view === "month"} />
                      </li>
                    ))}
                  </ul>
                  {list.length > limit ? (
                    <Link href={href({ view: "day", date: d })} className="mt-1 block text-xs font-medium underline-offset-4 hover:underline">
                      +{list.length - limit} more
                    </Link>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
