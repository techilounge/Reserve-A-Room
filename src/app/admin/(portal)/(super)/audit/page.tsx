import { ChevronLeft, ChevronRight, ScrollText, Search } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PaginationLink } from "@/components/admin/pagination-link";
import { EmptyState } from "@/components/feedback/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { actionLabel, auditChanges, auditSubject } from "@/lib/audit-format";
import { formatInstant } from "@/lib/datetime";
import { loadCatalog } from "@/lib/data/catalog";
import { getAuditLog } from "@/lib/data/super";

export const metadata: Metadata = {
  title: "Audit Log",
};

const ENTITIES = [
  ["", "Everything"],
  ["reservation", "Reservations"],
  ["room", "Rooms"],
  ["room_amenity", "Room amenities"],
  ["ministry", "Ministries"],
  ["amenity", "Amenities"],
  ["user", "Users"],
  ["settings", "Settings"],
] as const;
const PAGE_SIZE = 50;

export default async function AdminAuditPage({ searchParams }: PageProps<"/admin/audit">) {
  const raw = await searchParams;
  const search = typeof raw.q === "string" ? raw.q.slice(0, 100) : "";
  const entity = typeof raw.entity === "string" && ENTITIES.some(([k]) => k === raw.entity) ? raw.entity : "";
  const page = Math.max(1, Number.parseInt(String(raw.page ?? "1"), 10) || 1);
  const [{ rows, total }, catalog] = await Promise.all([
    getAuditLog({ search, entityType: entity, page, pageSize: PAGE_SIZE }),
    loadCatalog(),
  ]);
  const tz = catalog.ok ? catalog.catalog.settings.timeZone : "America/Chicago";
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const href = (p: number) => `/admin/audit?${new URLSearchParams({ q: search, entity, page: String(p) }).toString()}`;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Audit Log" description="A permanent record of important changes. Entries can't be edited or deleted." />

      <form action="/admin/audit" className="flex flex-col gap-2 rounded-xl border bg-card p-4 sm:flex-row sm:items-end">
        <div className="relative flex-1">
          <label htmlFor="audit-search" className="sr-only">
            Search the audit log
          </label>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input id="audit-search" name="q" type="search" defaultValue={search} placeholder="Search actions, people, references…" className="pl-9" />
        </div>
        <label htmlFor="audit-entity" className="sr-only">
          Type
        </label>
        <select id="audit-entity" name="entity" defaultValue={entity} className="h-10 rounded-lg border border-input bg-background px-3 text-sm sm:w-48">
          {ENTITIES.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>

      {rows.length === 0 ? (
        <EmptyState icon={ScrollText} title="No entries found">
          Try a different search.
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
