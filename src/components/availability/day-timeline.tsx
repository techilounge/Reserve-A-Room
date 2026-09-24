import { Ban, CircleCheck, Clock } from "lucide-react";
import Link from "next/link";

import { formatTime, formatTimeRange, minutesOfDay, timeFromMinutes, type LocalDate, type LocalTime } from "@/lib/datetime";
import type { Segment, SegmentState } from "@/lib/domain/availability";
import { cn } from "@/lib/utils";

const STATE = {
  available: { label: "Available", icon: CircleCheck, bar: "bg-success-soft border-success-border", text: "text-success-soft-foreground" },
  // Stripes give "unavailable" a non-color cue on the visual bar.
  unavailable: {
    label: "Unavailable",
    icon: Ban,
    bar: "border-neutral-border bg-[repeating-linear-gradient(135deg,var(--neutral-soft)_0_6px,var(--neutral-border)_6px_8px)]",
    text: "text-foreground",
  },
  past: { label: "Past", icon: Clock, bar: "bg-muted border-transparent", text: "text-muted-foreground" },
} satisfies Record<SegmentState, { label: string; icon: typeof Ban; bar: string; text: string }>;

function tickLabels(dayStart: LocalTime, dayEnd: LocalTime): LocalTime[] {
  const start = minutesOfDay(dayStart);
  const end = minutesOfDay(dayEnd);
  const first = Math.ceil(start / 120) * 120;
  const ticks: LocalTime[] = [];
  for (let m = first; m <= end; m += 120) ticks.push(timeFromMinutes(m));
  return ticks;
}

/**
 * One room's day: a proportional bar (visual summary, hidden from screen readers) and a
 * list of time blocks (the accessible content). Fits any width — no horizontal scroll.
 */
export function DayTimeline({
  segments,
  dayStart,
  dayEnd,
  reserveHref,
}: {
  segments: readonly Segment[];
  dayStart: LocalTime;
  dayEnd: LocalTime;
  /** Builds a reservation link pre-filled with a start time; omitted when not reservable. */
  reserveHref?: (start: LocalTime) => string;
}) {
  const total = minutesOfDay(dayEnd) - minutesOfDay(dayStart);
  const width = (s: Segment) => ((minutesOfDay(s.end) - minutesOfDay(s.start)) / total) * 100;
  const offset = (t: LocalTime) => ((minutesOfDay(t) - minutesOfDay(dayStart)) / total) * 100;

  return (
    <div className="space-y-3">
      <div aria-hidden className="hidden sm:block">
        <div className="flex h-8 overflow-hidden rounded-md border">
          {segments.map((s) => (
            <div
              key={s.start}
              className={cn("h-full border-r last:border-r-0", STATE[s.state].bar)}
              style={{ width: `${width(s)}%` }}
            />
          ))}
        </div>
        <div className="relative mt-1 h-4 text-[0.7rem] text-muted-foreground">
          {tickLabels(dayStart, dayEnd).map((t) => (
            <span key={t} className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: `${offset(t)}%` }}>
              {formatTime(t).replace(":00", "")}
            </span>
          ))}
        </div>
      </div>

      <ul className="divide-y rounded-lg border">
        {segments.map((s) => {
          const { label, icon: Icon, text } = STATE[s.state];
          return (
            <li key={s.start} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2.5 text-sm">
              <span className={cn("inline-flex items-center gap-2", text)}>
                <Icon className="size-4 shrink-0" aria-hidden />
                <span className="font-medium">{label}</span>
              </span>
              <span className="flex items-center gap-3">
                <span className="tabular-nums text-muted-foreground">{formatTimeRange(s.start, s.end)}</span>
                {s.state === "available" && reserveHref ? (
                  <Link
                    href={reserveHref(s.start)}
                    className="font-medium text-foreground underline underline-offset-4 hover:no-underline"
                  >
                    Reserve<span className="sr-only"> starting {formatTime(s.start)}</span>
                  </Link>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function reserveLink(slug: string, date: LocalDate, start?: LocalTime, end?: LocalTime): string {
  const params = new URLSearchParams({ room: slug, date });
  if (start) params.set("start", start);
  if (end) params.set("end", end);
  return `/reserve?${params.toString()}`;
}
