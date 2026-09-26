"use client";

import type { ReactElement } from "react";
import { useState } from "react";

import { BrandLockup } from "@/components/brand/brand";
import { NavLink } from "@/components/layout/nav-link";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { ADMIN_NAV, type NavGroup } from "@/lib/navigation";

/**
 * Icons are components and can't cross the server→client boundary, so the server passes
 * the list of hrefs the current user may see and the client filters ADMIN_NAV with it.
 */
function visibleGroups(allowedHrefs: readonly string[]): NavGroup[] {
  const allowed = new Set(allowedHrefs);
  return ADMIN_NAV.map((group) => ({
    ...group,
    items: group.items.filter((item) => allowed.has(item.href)),
  })).filter((group) => group.items.length > 0);
}

function NavGroups({
  allowedHrefs,
  onNavigate,
  excludedHrefs = [],
}: {
  allowedHrefs: readonly string[];
  onNavigate?: () => void;
  excludedHrefs?: readonly string[];
}) {
  const excluded = new Set(excludedHrefs);

  return (
    <nav aria-label="Admin" className="flex flex-col gap-6">
      {visibleGroups(allowedHrefs).map((group) => (
        <div key={group.label} className="flex flex-col gap-1">
          <p className="px-3 pb-1 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
            {group.label}
          </p>
          {group.items.filter(({ href }) => !excluded.has(href)).map(({ href, label, icon: Icon }) => (
            <NavLink
              key={href}
              href={href}
              onClick={onNavigate}
              className="flex min-h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground data-[active]:bg-sidebar-primary data-[active]:text-sidebar-primary-foreground"
            >
              {Icon ? <Icon className="size-4 shrink-0" aria-hidden /> : null}
              {label}
            </NavLink>
          ))}
        </div>
      ))}
    </nav>
  );
}

export function AdminSidebarNav({ allowedHrefs }: { allowedHrefs: readonly string[] }) {
  return <NavGroups allowedHrefs={allowedHrefs} />;
}

const PRIMARY_MOBILE_HREFS = ["/admin", "/admin/reservations", "/admin/calendar"] as const;

export function AdminMoreNav({
  allowedHrefs,
  trigger,
}: {
  allowedHrefs: readonly string[];
  trigger: ReactElement;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent side="right" className="w-[min(20rem,88vw)] gap-0 bg-sidebar p-0">
        <SheetHeader className="border-b p-4">
          <SheetTitle className="sr-only">Admin menu</SheetTitle>
          <SheetDescription className="sr-only">Administrative navigation</SheetDescription>
          <BrandLockup href="/" subtitle="Administration" className="pr-10" />
        </SheetHeader>
        <div className="overflow-y-auto p-3">
          <NavGroups
            allowedHrefs={allowedHrefs}
            excludedHrefs={PRIMARY_MOBILE_HREFS}
            onNavigate={() => setOpen(false)}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
