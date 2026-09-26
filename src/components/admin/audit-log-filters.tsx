"use client";

import { Search, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AuditDatePreset } from "@/lib/audit-filters";

type Option = readonly [string, string];

export function AuditLogFilters({
  initialSearch,
  initialEntity,
  initialPreset,
  initialFrom,
  initialTo,
  entities,
  error,
}: {
  initialSearch: string;
  initialEntity: string;
  initialPreset: AuditDatePreset;
  initialFrom: string;
  initialTo: string;
  entities: readonly Option[];
  error?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const currentParams = useSearchParams();
  const [search, setSearch] = useState(initialSearch);
  const [entity, setEntity] = useState(initialEntity);
  const [preset, setPreset] = useState<AuditDatePreset>(initialPreset);
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const [isPending, startTransition] = useTransition();
  const firstSearchEffect = useRef(true);

  function apply(next: { q?: string; entity?: string; date?: string; from?: string; to?: string }) {
    const params = new URLSearchParams(currentParams.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    params.delete("page");
    startTransition(() => router.replace(`${pathname}?${params.toString()}`, { scroll: false }));
  }

  useEffect(() => {
    if (firstSearchEffect.current) {
      firstSearchEffect.current = false;
      return;
    }
    const timer = window.setTimeout(() => apply({ q: search.trim() }), 300);
    return () => window.clearTimeout(timer);
    // The URL object intentionally remains the snapshot for this render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  function clear() {
    setSearch("");
    setEntity("");
    setPreset("all");
    setFrom("");
    setTo("");
    startTransition(() => router.replace(pathname, { scroll: false }));
  }

  return (
    <section className="space-y-3 rounded-xl border bg-card p-4" aria-label="Audit log filters">
      <div className="grid gap-3 lg:grid-cols-[minmax(16rem,1fr)_13rem_13rem_auto] lg:items-end">
        <div>
          <label htmlFor="audit-search" className="mb-1.5 block text-sm font-medium">
            Search
          </label>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              id="audit-search"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Actions, people, references…"
              className="pl-9"
            />
          </div>
        </div>
        <div>
          <label htmlFor="audit-entity" className="mb-1.5 block text-sm font-medium">
            Type
          </label>
          <select
            id="audit-entity"
            value={entity}
            onChange={(event) => {
              setEntity(event.target.value);
              apply({ entity: event.target.value });
            }}
            className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
          >
            {entities.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="audit-date" className="mb-1.5 block text-sm font-medium">
            Date
          </label>
          <select
            id="audit-date"
            value={preset}
            onChange={(event) => {
              const value = event.target.value as AuditDatePreset;
              setPreset(value);
              apply({ date: value === "all" ? "" : value, from: value === "custom" ? from : "", to: value === "custom" ? to : "" });
            }}
            className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
          >
            <option value="all">All time</option>
            <option value="today">Today</option>
            <option value="last_7_days">Last 7 days</option>
            <option value="last_30_days">Last 30 days</option>
            <option value="this_month">This month</option>
            <option value="custom">Custom range</option>
          </select>
        </div>
        <Button type="button" variant="outline" onClick={clear} disabled={!search && !entity && preset === "all"}>
          <X aria-hidden /> Clear
        </Button>
      </div>

      {preset === "custom" ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:max-w-xl">
          <div>
            <label htmlFor="audit-from" className="mb-1.5 block text-sm font-medium">From</label>
            <Input
              id="audit-from"
              type="date"
              value={from}
              onChange={(event) => {
                setFrom(event.target.value);
                apply({ date: "custom", from: event.target.value, to });
              }}
            />
          </div>
          <div>
            <label htmlFor="audit-to" className="mb-1.5 block text-sm font-medium">Through</label>
            <Input
              id="audit-to"
              type="date"
              value={to}
              min={from || undefined}
              onChange={(event) => {
                setTo(event.target.value);
                apply({ date: "custom", from, to: event.target.value });
              }}
            />
          </div>
        </div>
      ) : null}

      <p className={error ? "text-sm text-destructive" : "text-sm text-muted-foreground"} role={error ? "alert" : "status"}>
        {error ?? (isPending ? "Updating results…" : "Search and filters apply automatically to the entire audit history.")}
      </p>
    </section>
  );
}
