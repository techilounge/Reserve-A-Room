"use client";

import {
  CalendarDays,
  CalendarPlus,
  ClipboardList,
  Home,
  LayoutDashboard,
  MoreHorizontal,
  Search,
  UsersRound,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { AdminMoreNav } from "@/components/admin/admin-nav";
import { useStaffPortalAccess } from "@/components/auth/staff-portal-link";
import { isActivePath } from "@/lib/navigation";
import { cn } from "@/lib/utils";

type BottomNavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  prominent?: boolean;
};

const PUBLIC_ITEMS: readonly BottomNavItem[] = [
  { href: "/", label: "Home", icon: Home },
  { href: "/rooms", label: "Rooms", icon: UsersRound },
  { href: "/reserve", label: "Reserve", icon: CalendarPlus, prominent: true },
  { href: "/availability", label: "Availability", icon: Search },
];

const ADMIN_ITEMS: readonly BottomNavItem[] = [
  { href: "/admin", label: "Dashboard", icon: Home },
  { href: "/admin/reservations", label: "Reservations", icon: ClipboardList },
  { href: "/admin/reservations/new", label: "New", icon: CalendarPlus, prominent: true },
  { href: "/admin/calendar", label: "Calendar", icon: CalendarDays },
];

function BottomNavLink({ item }: { item: BottomNavItem }) {
  const pathname = usePathname();
  const active =
    item.href === "/admin/reservations"
      ? isActivePath(pathname, item.href) && pathname !== "/admin/reservations/new"
      : isActivePath(pathname, item.href);
  const Icon = item.icon;

  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex min-h-12 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl px-1 text-[0.625rem] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        item.prominent
          ? "-mt-5 min-h-16 max-w-16 shrink-0 rounded-2xl bg-primary text-primary-foreground shadow-lg ring-4 ring-background hover:bg-primary/90"
          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
        active && !item.prominent && "bg-accent text-accent-foreground",
      )}
    >
      <Icon className={cn("size-5", item.prominent && "size-6")} strokeWidth={active ? 2.5 : 2} aria-hidden />
      <span className="max-w-full truncate">{item.label}</span>
      {active && !item.prominent ? (
        <span className="absolute inset-x-4 bottom-0 h-0.5 rounded-full bg-highlight" aria-hidden />
      ) : null}
    </Link>
  );
}

function NavSurface({ children, label, className }: { children: ReactNode; label: string; className: string }) {
  return (
    <nav
      aria-label={label}
      className={cn(
        "fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-40 mx-auto grid h-16 max-w-md items-center rounded-2xl border border-border/80 bg-card/92 px-2 text-card-foreground shadow-[0_12px_40px_-12px_rgb(3_30_71/0.45)] ring-1 ring-foreground/5 backdrop-blur-xl supports-[backdrop-filter]:bg-card/82",
        className,
      )}
    >
      {children}
    </nav>
  );
}

export function PublicMobileBottomNav() {
  const hasStaffAccess = useStaffPortalAccess();
  const items = hasStaffAccess
    ? [...PUBLIC_ITEMS, { href: "/admin", label: "Admin", icon: LayoutDashboard }]
    : PUBLIC_ITEMS;

  return (
    <NavSurface label="Mobile navigation" className={cn(hasStaffAccess ? "grid-cols-5" : "grid-cols-4", "md:hidden")}>
      {items.map((item) => (
        <BottomNavLink key={item.href} item={item} />
      ))}
    </NavSurface>
  );
}

export function AdminMobileBottomNav({ allowedHrefs }: { allowedHrefs: readonly string[] }) {
  return (
    <NavSurface label="Admin mobile navigation" className="grid-cols-5 lg:hidden">
      {ADMIN_ITEMS.map((item) => (
        <BottomNavLink key={item.href} item={item} />
      ))}
      <AdminMoreNav
        allowedHrefs={allowedHrefs}
        trigger={
          <button
            type="button"
            className="flex min-h-12 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl px-1 text-[0.625rem] font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            aria-label="More admin navigation"
          >
            <MoreHorizontal className="size-5" aria-hidden />
            <span>More</span>
          </button>
        }
      />
    </NavSurface>
  );
}
