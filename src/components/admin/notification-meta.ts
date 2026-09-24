import { Ban, Hourglass, MailWarning, Pencil, type LucideIcon } from "lucide-react";

/** Icon per notification type (text always accompanies it). */
export const NOTIFICATION_ICONS: Record<string, LucideIcon> = {
  reservation_pending: Hourglass,
  reservation_cancelled_by_requester: Ban,
  reservation_modified: Pencil,
  email_failed: MailWarning,
};

export function notificationIcon(type: string): LucideIcon {
  return NOTIFICATION_ICONS[type] ?? Hourglass;
}

/** "5 min ago", "3 h ago", "2 days ago" — short relative time for lists. */
export function timeAgo(iso: string, now: number = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
