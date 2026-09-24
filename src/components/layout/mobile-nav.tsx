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
import { PUBLIC_NAV } from "@/lib/navigation";
import { site } from "@/lib/site";

export function MobileNav() {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open menu">
          <Menu className="size-5" aria-hidden />
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-[min(20rem,85vw)] gap-0 p-0">
        <SheetHeader className="border-b p-4">
          <SheetTitle className="sr-only">Menu</SheetTitle>
          <SheetDescription className="sr-only">Site navigation</SheetDescription>
          <BrandLockup className="pr-10" />
        </SheetHeader>
        <nav aria-label="Main" className="flex flex-col gap-1 p-3">
          {PUBLIC_NAV.map((item) => (
            <NavLink
              key={item.href}
              href={item.href}
              onClick={close}
              className="flex min-h-11 items-center rounded-lg px-3 text-base font-medium hover:bg-accent data-[active]:bg-accent data-[active]:text-accent-foreground"
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto flex flex-col gap-3 border-t p-4">
          <Button asChild size="lg">
            <NavLink href="/reserve" onClick={close}>
              Reserve a Room
            </NavLink>
          </Button>
          <a
            href={site.churchWebsite}
            className="text-center text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            Visit {site.churchWebsiteLabel}
          </a>
        </div>
      </SheetContent>
    </Sheet>
  );
}
