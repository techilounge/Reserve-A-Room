import { BellOff, ChevronLeft, ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { NotificationsList } from "@/components/admin/notifications-list";
import { PaginationLink } from "@/components/admin/pagination-link";
import { EmptyState } from "@/components/feedback/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { formatInstant } from "@/lib/datetime";
import { loadCatalog } from "@/lib/data/catalog";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Notifications",
};

const PAGE_SIZE = 25;

export default async function AdminNotificationsPage({ searchParams }: PageProps<"/admin/notifications">) {
  const raw = await searchParams;
  const unreadOnly = raw.filter === "unread";
  const page = Math.max(1, Number.parseInt(String(raw.page ?? "1"), 10) || 1);

  const supabase = await createSupabaseServerClient();
  const [{ data, error }, unreadCount, catalog] = await Promise.all([
    supabase.rpc("my_notifications", { p_unread_only: unreadOnly, p_limit: PAGE_SIZE, p_offset: (page - 1) * PAGE_SIZE }),
    supabase.rpc("unread_notification_count"),
    loadCatalog(),
  ]);
  if (error) throw error;
  const tz = catalog.ok ? catalog.catalog.settings.timeZone : "America/Chicago";
  const total = Number(data[0]?.total_count ?? 0);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const href = (changes: Record<string, string>) =>
    `/admin/notifications?${new URLSearchParams({ ...(unreadOnly ? { filter: "unread" } : {}), ...changes }).toString()}`;

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader title="Notifications" description="Updates about reservations that need your attention." />

      <nav aria-label="Filter" className="flex w-fit rounded-lg border p-0.5">
        {[
          ["All", "/admin/notifications", !unreadOnly],
          [`Unread (${unreadCount.data ?? 0})`, "/admin/notifications?filter=unread", unreadOnly],
        ].map(([label, link, active]) => (
          <Link
            key={String(link)}
            href={String(link)}
            aria-current={active ? "page" : undefined}
            className={cn(
              "min-h-9 rounded-md px-3 py-1.5 text-sm font-medium",
              active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent",
            )}
          >
            {label}
          </Link>
        ))}
      </nav>

      {data.length === 0 ? (
        <EmptyState icon={BellOff} title="You're all caught up.">
          {unreadOnly ? "There are no unread notifications." : "Notifications about new requests and changes will appear here."}
        </EmptyState>
      ) : (
        <NotificationsList
          items={data}
          hasUnread={(unreadCount.data ?? 0) > 0}
          dates={Object.fromEntries(data.map((n) => [n.id, formatInstant(n.created_at, tz)]))}
        />
      )}

      {pages > 1 ? (
        <nav aria-label="Pagination" className="flex items-center justify-between">
          <PaginationLink href={page > 1 ? href({ page: String(page - 1) }) : null}>
            <ChevronLeft data-icon="inline-start" aria-hidden />
            Newer
          </PaginationLink>
          <span className="text-sm text-muted-foreground">
            Page {page} of {pages}
          </span>
          <PaginationLink href={page < pages ? href({ page: String(page + 1) }) : null}>
            Older
            <ChevronRight data-icon="inline-end" aria-hidden />
          </PaginationLink>
        </nav>
      ) : null}
    </div>
  );
}
