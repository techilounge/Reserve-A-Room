import type { LucideIcon } from "lucide-react";
import {
  Bell,
  Building2,
  CalendarDays,
  ClipboardList,
  LayoutDashboard,
  ScrollText,
  Settings,
  Users,
  UsersRound,
} from "lucide-react";

import { can, type Actor, type Permission } from "@/lib/auth/permissions";

export type NavItem = {
  href: string;
  label: string;
  icon?: LucideIcon;
  permission?: Permission;
};

export type NavGroup = {
  label: string;
  items: readonly NavItem[];
};

export const PUBLIC_NAV: readonly NavItem[] = [
  { href: "/rooms", label: "Rooms" },
  { href: "/availability", label: "Availability" },
];

export const ADMIN_NAV: readonly NavGroup[] = [
  {
    label: "Manage",
    items: [
      { href: "/admin", label: "Dashboard", icon: LayoutDashboard, permission: "reservations.viewAll" },
      { href: "/admin/reservations", label: "Reservations", icon: ClipboardList, permission: "reservations.viewAll" },
      { href: "/admin/calendar", label: "Calendar", icon: CalendarDays, permission: "calendar.view" },
      { href: "/admin/notifications", label: "Notifications", icon: Bell, permission: "notifications.receive" },
    ],
  },
  {
    label: "Super Admin",
    items: [
      { href: "/admin/rooms", label: "Rooms", icon: Building2, permission: "rooms.manage" },
      { href: "/admin/ministries", label: "Ministries", icon: UsersRound, permission: "ministries.manage" },
      { href: "/admin/users", label: "Users & Roles", icon: Users, permission: "users.manage" },
      { href: "/admin/settings", label: "Settings", icon: Settings, permission: "settings.manage" },
      { href: "/admin/audit", label: "Audit Log", icon: ScrollText, permission: "audit.view" },
    ],
  },
];

/** Navigation visible to an actor. Groups with no visible items are dropped. */
export function navigationFor(actor: Actor, groups: readonly NavGroup[] = ADMIN_NAV): NavGroup[] {
  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => !item.permission || can(actor, item.permission)),
    }))
    .filter((group) => group.items.length > 0);
}

/** Exact match for section roots ("/admin"), prefix match for everything else. */
export function isActivePath(pathname: string, href: string): boolean {
  if (href === "/" || href === "/admin") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}
