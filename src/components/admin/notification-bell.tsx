"use client";

import { Bell, CheckCheck } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState, useTransition } from "react";

import {
  getNotificationSummary,
  markNotificationsRead,
  type NotificationItem,
} from "@/app/admin/(portal)/notifications/actions";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

import { notificationIcon, timeAgo } from "./notification-meta";

const POLL_MS = 60_000;

export function NotificationBell({ initialUnread }: { initialUnread: number }) {
  const [unread, setUnread] = useState(initialUnread);
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const refresh = useCallback(async () => {
    const summary = await getNotificationSummary();
    setUnread(summary.unread);
    setItems(summary.latest);
  }, []);

  // Light polling while the tab is visible; also refresh when returning to the tab.
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const timer = setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [refresh]);

  function markAll() {
    startTransition(async () => {
      await markNotificationsRead();
      await refresh();
    });
  }

  const label = unread > 0 ? `Notifications, ${unread} unread` : "Notifications";

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) void refresh();
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={label} className="relative">
          <Bell className="size-5" aria-hidden />
          {unread > 0 ? (
            <span
              aria-hidden
              className="absolute -top-0.5 -right-0.5 flex min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-[0.65rem] leading-5 font-bold text-white"
            >
              {unread > 99 ? "99+" : unread}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(22rem,calc(100vw-2rem))] p-0">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <p className="font-semibold">Notifications</p>
          {unread > 0 ? (
            <Button variant="ghost" size="sm" onClick={markAll} disabled={pending}>
              <CheckCheck data-icon="inline-start" aria-hidden />
              Mark all read
            </Button>
          ) : null}
        </div>
        <div className="max-h-[min(24rem,60dvh)] overflow-y-auto">
          {items === null ? (
            <p className="p-4 text-sm text-muted-foreground">Loading…</p>
          ) : items.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">You&apos;re all caught up.</p>
          ) : (
            <ul className="divide-y">
              {items.map((n) => {
                const Icon = notificationIcon(n.type);
                return (
                  <li key={n.id}>
                    <Link
                      href={n.reservation_id ? `/admin/reservations/${n.reservation_id}` : "/admin/notifications"}
                      onClick={() => {
                        setOpen(false);
                        if (!n.read_at) {
                          setUnread((u) => Math.max(0, u - 1));
                          void markNotificationsRead([n.id]);
                        }
                      }}
                      className={cn("flex gap-3 px-4 py-3 hover:bg-accent", !n.read_at && "bg-info-soft/50")}
                    >
                      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">
                          {!n.read_at ? <span className="sr-only">Unread: </span> : null}
                          {n.title}
                        </span>
                        <span className="block text-sm text-muted-foreground">{n.message}</span>
                        <span className="block text-xs text-muted-foreground">{timeAgo(n.created_at)}</span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div className="border-t p-2">
          <Button asChild variant="ghost" className="w-full" onClick={() => setOpen(false)}>
            <Link href="/admin/notifications">See all notifications</Link>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
