"use client";

import { Menu } from "lucide-react";
import { useState } from "react";

import { BrandLockup } from "@/components/brand/brand";
import { NavLink } from "@/components/layout/nav-link";
import { Button } from "@/components/ui/button";
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
}: {
  allowedHrefs: readonly string[];
  onNavigate?: () => void;
}) {
  return (
    <nav aria-label="Admin" className="flex flex-col gap-6">
      {visibleGroups(allowedHrefs).map((group) => (
        <div key={group.label} className="flex flex-col gap-1">
          <p className="px-3 pb-1 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
            {group.label}
          </p>
          {group.items.map(({ href, label, icon: Icon }) => (
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

export function AdminMobileNav({ allowedHrefs }: { allowedHrefs: readonly string[] }) {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open admin menu">
          <Menu className="size-5" aria-hidden />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-[min(18rem,85vw)] gap-0 bg-sidebar p-0">
        <SheetHeader className="border-b p-4">
          <SheetTitle className="sr-only">Admin menu</SheetTitle>
          <SheetDescription className="sr-only">Administrative navigation</SheetDescription>
          <BrandLockup href="/admin" subtitle="Administration" className="pr-10" />
        </SheetHeader>
        <div className="overflow-y-auto p-3">
          <NavGroups allowedHrefs={allowedHrefs} onNavigate={() => setOpen(false)} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
