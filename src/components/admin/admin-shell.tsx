import type { ReactNode } from "react";

import { AdminSidebarNav } from "@/components/admin/admin-nav";
import { BrandLockup } from "@/components/brand/brand";
import { AdminMobileBottomNav } from "@/components/layout/mobile-bottom-nav";
import { ThemeToggle } from "@/components/theme/theme-toggle";

/**
 * Authenticated layout: top bar on every size, fixed sidebar from `lg`, slide-out
 * sheet below that. `headerActions` is where the notification bell and account menu go.
 */
export function AdminShell({
  allowedHrefs,
  headerActions,
  children,
}: {
  allowedHrefs: readonly string[];
  headerActions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col pb-[calc(6.5rem+env(safe-area-inset-bottom))] lg:pb-0">
      <a
        href="#admin-main"
        className="sr-only z-50 rounded-md bg-primary px-4 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
        <div className="flex h-16 items-center gap-2 px-4 sm:px-6">
          <BrandLockup href="/" subtitle="Administration" compactOnMobile />
          <div className="ml-auto flex items-center gap-1">
            {headerActions}
            <ThemeToggle />
          </div>
        </div>
      </header>
      <div className="flex flex-1">
        <aside className="sticky top-16 hidden h-[calc(100dvh-4rem)] w-64 shrink-0 overflow-y-auto border-r bg-sidebar p-4 lg:block">
          <AdminSidebarNav allowedHrefs={allowedHrefs} />
        </aside>
        <main id="admin-main" className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>
      </div>
      <AdminMobileBottomNav allowedHrefs={allowedHrefs} />
    </div>
  );
}
