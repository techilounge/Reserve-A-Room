import Image from "next/image";
import Link from "next/link";

import { cn } from "@/lib/utils";
import { site } from "@/lib/site";

/** Compact mark + wordmark used in headers. Text is real text, so it stays crisp at any size. */
export function BrandLockup({
  href = "/",
  subtitle = site.churchShortName,
  compactOnMobile = false,
  className,
}: {
  href?: string;
  subtitle?: string;
  /** Show only the mark below the sm breakpoint (crowded headers). */
  compactOnMobile?: boolean;
  className?: string;
}) {
  return (
    <Link href={href} className={cn("flex min-w-0 items-center gap-2.5", className)}>
      <Image
        src={site.logo.mark}
        alt=""
        width={40}
        height={40}
        priority
        className="size-9 shrink-0 sm:size-10"
      />
      {compactOnMobile ? <span className="sr-only sm:hidden">{site.appName}</span> : null}
      <span className={cn("min-w-0 flex-col leading-none", compactOnMobile ? "hidden sm:flex" : "flex")}>
        <span className="font-heading text-base font-extrabold tracking-tight whitespace-nowrap text-primary sm:text-lg dark:text-foreground">
          Reserve-<span className="text-gold-text">A</span>-Room
        </span>
        <span className="mt-1 truncate text-[0.65rem] font-medium tracking-[0.08em] text-muted-foreground uppercase sm:text-[0.7rem] sm:tracking-[0.14em]">
          {subtitle}
        </span>
      </span>
    </Link>
  );
}

/**
 * Full official logo. `variant="auto"` swaps between the navy and light wordmark with the
 * theme; `variant="on-dark"` always uses the light wordmark (for navy backgrounds).
 */
export function BrandLogo({
  variant = "auto",
  className,
  priority = false,
  sizes = "(min-width: 640px) 28rem, 90vw",
}: {
  variant?: "auto" | "on-dark";
  className?: string;
  priority?: boolean;
  sizes?: string;
}) {
  const alt = `${site.appName} — ${site.churchShortName}`;
  const common = { width: site.logo.width, height: site.logo.height, priority, sizes };

  if (variant === "on-dark") {
    return <Image src={site.logo.dark} alt={alt} {...common} className={cn("h-auto w-full", className)} />;
  }

  // Both render; CSS shows the one matching the theme. The hidden one is display:none,
  // which removes it from the accessibility tree, so exactly one logo is announced.
  return (
    <>
      <Image src={site.logo.light} alt={alt} {...common} className={cn("h-auto w-full dark:hidden", className)} />
      <Image src={site.logo.dark} alt={alt} {...common} className={cn("hidden h-auto w-full dark:block", className)} />
    </>
  );
}
