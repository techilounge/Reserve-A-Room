"use client";

import { CheckCheck, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useTransition } from "react";
import { toast } from "sonner";

import { markNotificationsRead, type NotificationItem } from "@/app/admin/(portal)/notifications/actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { notificationIcon } from "./notification-meta";

export function NotificationsList({ items, dates, hasUnread }: { items: NotificationItem[]; dates: Record<string, string>; hasUnread: boolean }) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-4">
      {hasUnread ? (
        <div className="flex justify-end">
          <Button
            variant="secondary"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await markNotificationsRead();
                if (result.ok) toast.success("All notifications marked as read.");
              })
            }
          >
            {pending ? <LoaderCircle className="animate-spin" aria-hidden /> : <CheckCheck data-icon="inline-start" aria-hidden />}
            Mark all as read
          </Button>
        </div>
      ) : null}
      <ul className="divide-y rounded-xl border bg-card">
        {items.map((n) => {
          const Icon = notificationIcon(n.type);
          return (
            <li key={n.id} className={cn("flex gap-3 p-4", !n.read_at && "bg-info-soft/40")}>
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
                <Icon className="size-4" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {!n.read_at ? (
                    <span className="mr-2 inline-flex items-center rounded-full bg-info-soft px-2 text-xs font-semibold text-info-soft-foreground">
                      New
                    </span>
                  ) : null}
                  {n.title}
                </p>
                <p className="text-sm text-muted-foreground">{n.message}</p>
                <p className="mt-1 text-xs text-muted-foreground">{dates[n.id]}</p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-2 sm:flex-row sm:items-center">
                {n.reservation_id ? (
                  <Button asChild size="sm" variant="outline">
                    <Link href={`/admin/reservations/${n.reservation_id}`} onClick={() => !n.read_at && void markNotificationsRead([n.id])}>
                      View<span className="sr-only"> reservation for {n.title}</span>
                    </Link>
                  </Button>
                ) : null}
                {!n.read_at ? (
                  <Button size="sm" variant="ghost" onClick={() => startTransition(async () => void (await markNotificationsRead([n.id])))}>
                    Mark read<span className="sr-only"> {n.title}</span>
                  </Button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
