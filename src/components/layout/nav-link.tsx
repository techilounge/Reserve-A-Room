"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentProps } from "react";

import { isActivePath } from "@/lib/navigation";
import { cn } from "@/lib/utils";

/** Link that marks itself as the current page (aria-current + data-active for styling). */
export function NavLink({
  href,
  className,
  ...props
}: ComponentProps<typeof Link> & { href: string }) {
  const pathname = usePathname();
  const active = isActivePath(pathname, href);

  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      data-active={active || undefined}
      className={cn(className)}
      {...props}
    />
  );
}
