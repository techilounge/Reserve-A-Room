import { ChevronLeft, ChevronRight, ScrollText } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { AuditLogFilters } from "@/components/admin/audit-log-filters";
import { PaginationLink } from "@/components/admin/pagination-link";
import { EmptyState } from "@/components/feedback/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { actionLabel, auditChanges, auditSubject } from "@/lib/audit-format";
import { normalizeAuditDatePreset, resolveAuditDateRange } from "@/lib/audit-filters";
import { formatInstant } from "@/lib/datetime";
import { loadCatalog } from "@/lib/data/catalog";
import { getAuditLog } from "@/lib/data/super";

export const metadata: Metadata = {
  title: "Audit Log",
};

const ENTITIES = [
  ["", "Everything"],
  ["reservation", "Reservations"],
  ["recurring_request", "Recurring requests"],
  ["room", "Rooms"],
  ["room_amenity", "Room amenities"],
  ["ministry", "Ministries"],
  ["amenity", "Amenities"],
  ["user", "Users & authentication"],
  ["settings", "Settings"],
] as const;
const PAGE_SIZE = 25;

export default async function AdminAuditPage({ searchParams }: PageProps<"/admin/audit">) {
  const raw = await searchParams;
  const search = typeof raw.q === "string" ? raw.q.slice(0, 100) : "";
  const entity = typeof raw.entity === "string" && ENTITIES.some(([k]) => k === raw.entity) ? raw.entity : "";
  const requestedPage = Math.max(1, Number.parseInt(String(raw.page ?? "1"), 10) || 1);
  const preset = normalizeAuditDatePreset(raw.date);
  const customFrom = typeof raw.from === "string" ? raw.from : "";
  const customTo = typeof raw.to === "string" ? raw.to : "";
  const catalog = await loadCatalog();
  const tz = catalog.ok ? catalog.catalog.settings.timeZone : "America/Chicago";
  const dateRange = resolveAuditDateRange({ preset, from: customFrom, to: customTo, timeZone: tz });
  let page = requestedPage;
  let result = await getAuditLog({
    search,
    entityType: entity,
    from: dateRange.error ? undefined : dateRange.fromInstant,
    to: dateRange.error ? undefined : dateRange.toExclusiveInstant,
    page,
    pageSize: PAGE_SIZE,
  });
  if (page > 1 && result.rows.length === 0) {
    page = 1;
    result = await getAuditLog({
      search,
      entityType: entity,
      from: dateRange.error ? undefined : dateRange.fromInstant,
      to: dateRange.error ? undefined : dateRange.toExclusiveInstant,
      page,
      pageSize: PAGE_SIZE,
    });
  }
  const { rows, total } = result;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const href = (p: number) => {
    const params = new URLSearchParams();
    if (search) params.set("q", search);
    if (entity) params.set("entity", entity);
    if (preset !== "all") params.set("date", preset);
    if (preset === "custom" && customFrom) params.set("from", customFrom);
    if (preset === "custom" && customTo) params.set("to", customTo);
    params.set("page", String(p));
    return `/admin/audit?${params.toString()}`;
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Audit Log" description="A permanent record of important changes. Entries can't be edited or deleted." />

      <AuditLogFilters
        initialSearch={search}
        initialEntity={entity}
        initialPreset={preset}
        initialFrom={customFrom}
        initialTo={customTo}
        entities={ENTITIES}
        error={dateRange.error}
      />

      {rows.length === 0 ? (
        <EmptyState icon={ScrollText} title="No entries found">
          Try different search or date filters.
        </EmptyState>
      ) : (
        <ol className="divide-y rounded-xl border bg-card">
          {rows.map((entry) => {
            const changes = auditChanges(entry.metadata);
            const subject = auditSubject(entry.metadata);
            const link =
              entry.entity_type === "reservation" && entry.entity_id
                ? `/admin/reservations/${entry.entity_id}`
                : entry.entity_type === "room" && entry.entity_id
                  ? `/admin/rooms/${entry.entity_id}`
                  : null;
            return (
              <li key={entry.id} className="space-y-1.5 p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <p className="font-medium">
                    {actionLabel(entry.action)}
                    {subject ? (
                      <>
                        {" · "}
                        {link ? (
                          <Link href={link} className="underline underline-offset-4">
                            {subject}
                          </Link>
                        ) : (
                          subject
                        )}
                      </>
                    ) : link ? (
                      <>
                        {" · "}
                        <Link href={link} className="text-sm font-normal underline underline-offset-4">
                          View
                        </Link>
                      </>
                    ) : null}
                  </p>
                  <time className="text-sm text-muted-foreground" dateTime={entry.created_at}>
                    {formatInstant(entry.created_at, tz)}
                  </time>
                </div>
                <p className="text-sm text-muted-foreground">
                  By{" "}
                  {entry.actor_name ??
                    (entry.actor_kind === "guest" ? "a guest (online form)" : entry.actor_kind === "system" ? "the system" : "a former administrator")}
                </p>
                {changes.length > 0 ? (
                  <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                    {changes.slice(0, 8).map((c) => (
                      <li key={c.field} className="break-words">
                        <span className="text-muted-foreground">{c.field}:</span>{" "}
                        {c.from ? (
                          <>
                            {c.from} <span aria-hidden>→</span>
                            <span className="sr-only">changed to</span> {c.to}
                          </>
                        ) : (
                          c.to
                        )}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}

      {pages > 1 ? (
        <nav aria-label="Pagination" className="flex items-center justify-between">
          <PaginationLink href={page > 1 ? href(page - 1) : null}>
            <ChevronLeft data-icon="inline-start" aria-hidden />
            Newer
          </PaginationLink>
          <span className="text-sm text-muted-foreground">
            Page {page} of {pages}
          </span>
          <PaginationLink href={page < pages ? href(page + 1) : null}>
            Older
            <ChevronRight data-icon="inline-end" aria-hidden />
          </PaginationLink>
        </nav>
      ) : null}
    </div>
  );
}
