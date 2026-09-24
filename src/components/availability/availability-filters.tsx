"use client";

import { ChevronLeft, ChevronRight, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { DatePicker } from "@/components/forms/date-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { toSearch, type AvailabilityQuery } from "@/lib/availability-query";
import { addDaysToLocalDate, formatTime, type LocalDate, type LocalTime } from "@/lib/datetime";

export function AvailabilityFilters({
  initial,
  rooms,
  times,
  minDate,
  maxDate,
}: {
  initial: AvailabilityQuery;
  rooms: { slug: string; name: string; capacity: number }[];
  times: LocalTime[];
  minDate: LocalDate;
  maxDate: LocalDate;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState(initial);

  function apply(next: AvailabilityQuery) {
    setQuery(next);
    startTransition(() => router.replace(toSearch(next), { scroll: false }));
  }

  const prev = addDaysToLocalDate(query.date, -1);
  const next = addDaysToLocalDate(query.date, 1);

  return (
    <form
      action="/availability"
      onSubmit={(event) => {
        event.preventDefault();
        apply(query);
      }}
      className="rounded-xl border bg-card p-4 sm:p-5"
      aria-describedby="availability-filters-help"
    >
      <p id="availability-filters-help" className="sr-only">
        Results update as you change the filters.
      </p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[1.4fr_1.2fr_0.7fr_1.3fr]">
        <div className="space-y-1.5">
          <Label htmlFor="availability-date">Date</Label>
          <div className="flex gap-2">
            <Button asChild variant="outline" size="icon" aria-label="Previous day" className="shrink-0">
              {query.date > minDate ? (
                <Link href={toSearch({ ...query, date: prev })} scroll={false} onClick={() => setQuery({ ...query, date: prev })}>
                  <ChevronLeft aria-hidden />
                </Link>
              ) : (
                <span aria-disabled="true" className="pointer-events-none opacity-40">
                  <ChevronLeft aria-hidden />
                </span>
              )}
            </Button>
            <DatePicker
              id="availability-date"
              name="date"
              value={query.date}
              minDate={minDate}
              maxDate={maxDate}
              onChange={(date) => apply({ ...query, date })}
            />
            <Button asChild variant="outline" size="icon" aria-label="Next day" className="shrink-0">
              {query.date < maxDate ? (
                <Link href={toSearch({ ...query, date: next })} scroll={false} onClick={() => setQuery({ ...query, date: next })}>
                  <ChevronRight aria-hidden />
                </Link>
              ) : (
                <span aria-disabled="true" className="pointer-events-none opacity-40">
                  <ChevronRight aria-hidden />
                </span>
              )}
            </Button>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="availability-room">Room</Label>
          <NativeSelect
            id="availability-room"
            name="room"
            value={query.room}
            onChange={(e) => apply({ ...query, room: e.target.value })}
          >
            <option value="">All rooms</option>
            {rooms.map((room) => (
              <option key={room.slug} value={room.slug}>
                {room.name} (up to {room.capacity})
              </option>
            ))}
          </NativeSelect>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="availability-capacity">People</Label>
          <Input
            id="availability-capacity"
            name="capacity"
            type="number"
            inputMode="numeric"
            min={1}
            max={10000}
            placeholder="Any"
            value={query.capacity}
            onChange={(e) => setQuery({ ...query, capacity: e.target.value.replace(/\D/g, "") })}
            onBlur={() => query.capacity !== initial.capacity && apply(query)}
          />
        </div>

        <fieldset className="space-y-1.5">
          <legend className="mb-1.5 text-sm leading-none font-medium">Time (optional)</legend>
          <div className="grid grid-cols-2 gap-2">
            <NativeSelect
              aria-label="From"
              name="from"
              value={query.from}
              onChange={(e) => {
                const from = e.target.value;
                const next = { ...query, from, to: query.to && query.to > from ? query.to : "" };
                // A time window applies once both ends are chosen (or when it's cleared).
                if (!from) apply({ ...next, to: "" });
                else if (next.to) apply(next);
                else setQuery(next);
              }}
            >
              <option value="">From…</option>
              {times.slice(0, -1).map((t) => (
                <option key={t} value={t}>
                  {formatTime(t)}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect
              aria-label="To"
              name="to"
              value={query.to}
              onChange={(e) => {
                const to = e.target.value;
                if (!to) apply({ ...query, from: "", to: "" });
                else if (query.from) apply({ ...query, to });
                else setQuery({ ...query, to });
              }}
            >
              <option value="">To…</option>
              {times
                .slice(1)
                .filter((t) => !query.from || t > query.from)
                .map((t) => (
                  <option key={t} value={t}>
                    {formatTime(t)}
                  </option>
                ))}
            </NativeSelect>
          </div>
        </fieldset>
      </div>

      <div className="mt-4 flex items-center justify-end gap-3">
        <span role="status" aria-live="polite" className="text-sm text-muted-foreground">
          {pending ? (
            <span className="inline-flex items-center gap-1.5">
              <LoaderCircle className="size-4 animate-spin" aria-hidden />
              Updating…
            </span>
          ) : null}
        </span>
        <Button type="submit" variant="secondary" disabled={pending}>
          Show availability
        </Button>
      </div>
    </form>
  );
}
