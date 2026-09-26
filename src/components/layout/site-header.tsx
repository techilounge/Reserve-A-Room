"use client";

import Link from "next/link";
import { LayoutDashboard } from "lucide-react";

import { useStaffPortalAccess } from "@/components/auth/staff-portal-link";
import { BrandLockup } from "@/components/brand/brand";
import { NavLink } from "@/components/layout/nav-link";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Button } from "@/components/ui/button";
import { PUBLIC_NAV } from "@/lib/navigation";

export function SiteHeader() {
  const hasStaffAccess = useStaffPortalAccess();

  return (
    <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="page-container flex h-16 items-center justify-between gap-3">
        <BrandLockup />
        <div className="flex items-center gap-1 sm:gap-2">
          <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
            {PUBLIC_NAV.map((item) => (
              <NavLink
                key={item.href}
                href={item.href}
                className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground data-[active]:text-foreground"
              >
                {item.label}
              </NavLink>
            ))}
            {hasStaffAccess ? (
              <NavLink
                href="/admin"
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground data-[active]:text-foreground"
              >
                <LayoutDashboard className="size-4" aria-hidden />
                Admin
              </NavLink>
            ) : null}
          </nav>
          <Button asChild className="hidden sm:inline-flex">
            <Link href="/reserve">Reserve a Room</Link>
          </Button>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
