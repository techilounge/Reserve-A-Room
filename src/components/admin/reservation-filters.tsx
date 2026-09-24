"use client";

import { LoaderCircle, Search, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";

const FILTER_KEYS = ["q", "status", "room", "ministry", "from", "to", "approval", "sort"] as const;

export function ReservationFilters({
  rooms,
  ministries,
}: {
  rooms: { id: string; name: string }[];
  ministries: { id: string; name: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [search, setSearch] = useState(params.get("q") ?? "");
  const lastPushed = useRef(params.get("q") ?? "");

  function update(changes: Partial<Record<(typeof FILTER_KEYS)[number], string>>) {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    next.delete("page");
    startTransition(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  }

  // Debounced search: waits for a pause in typing instead of querying on every keystroke.
  useEffect(() => {
    const value = search.trim();
    if (value === lastPushed.current) return;
    const timer = setTimeout(() => {
      lastPushed.current = value;
      update({ q: value });
    }, 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const hasFilters = FILTER_KEYS.some((k) => k !== "sort" && params.get(k));

  return (
    <div className="space-y-3 rounded-xl border bg-card p-4">
      <div className="relative">
        <Label htmlFor="reservation-search" className="sr-only">
          Search reservations
        </Label>
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          id="reservation-search"
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by reference, name, email, phone, purpose, ministry or room"
          className="pl-9"
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1">
          <Label htmlFor="filter-status" className="text-xs text-muted-foreground">
            Status
          </Label>
          <NativeSelect id="filter-status" value={params.get("status") ?? ""} onChange={(e) => update({ status: e.target.value })}>
            <option value="">All statuses</option>
            <option value="upcoming">Upcoming (pending + approved)</option>
            <option value="pending">Pending approval</option>
            <option value="approved">Approved</option>
            <option value="declined">Declined</option>
            <option value="cancelled">Cancelled</option>
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <Label htmlFor="filter-room" className="text-xs text-muted-foreground">
            Room
          </Label>
          <NativeSelect id="filter-room" value={params.get("room") ?? ""} onChange={(e) => update({ room: e.target.value })}>
            <option value="">All rooms</option>
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <Label htmlFor="filter-ministry" className="text-xs text-muted-foreground">
            Ministry
          </Label>
          <NativeSelect id="filter-ministry" value={params.get("ministry") ?? ""} onChange={(e) => update({ ministry: e.target.value })}>
            <option value="">All ministries</option>
            {ministries.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <Label htmlFor="filter-approval" className="text-xs text-muted-foreground">
            Room type
          </Label>
          <NativeSelect id="filter-approval" value={params.get("approval") ?? ""} onChange={(e) => update({ approval: e.target.value })}>
            <option value="">Any</option>
            <option value="required">Approval required</option>
            <option value="instant">Instant</option>
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <Label htmlFor="filter-from" className="text-xs text-muted-foreground">
            From
          </Label>
          <Input id="filter-from" type="date" value={params.get("from") ?? ""} onChange={(e) => update({ from: e.target.value })} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="filter-to" className="text-xs text-muted-foreground">
            To
          </Label>
          <Input id="filter-to" type="date" value={params.get("to") ?? ""} onChange={(e) => update({ to: e.target.value })} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="filter-sort" className="text-xs text-muted-foreground">
            Sort
          </Label>
          <NativeSelect id="filter-sort" value={params.get("sort") ?? "start_asc"} onChange={(e) => update({ sort: e.target.value })}>
            <option value="start_asc">Date: soonest first</option>
            <option value="start_desc">Date: latest first</option>
            <option value="created_desc">Newest requests first</option>
            <option value="created_asc">Oldest requests first</option>
          </NativeSelect>
        </div>
        <div className="flex items-end gap-2">
          {hasFilters ? (
            <Button
              variant="ghost"
              onClick={() => {
                setSearch("");
                lastPushed.current = "";
                startTransition(() => router.replace(pathname, { scroll: false }));
              }}
            >
              <X data-icon="inline-start" aria-hidden />
              Clear filters
            </Button>
          ) : null}
          <span role="status" aria-live="polite" className="pb-2.5 text-sm text-muted-foreground">
            {pending ? (
              <span className="inline-flex items-center gap-1.5">
                <LoaderCircle className="size-4 animate-spin" aria-hidden />
                Updating…
              </span>
            ) : null}
          </span>
        </div>
      </div>
    </div>
  );
}
