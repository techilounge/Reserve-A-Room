import Link from "next/link";

import { BrandLockup } from "@/components/brand/brand";
import { ThemeToggle } from "@/components/theme/theme-toggle";

export default function AuthLayout({ children }: LayoutProps<"/admin">) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex h-16 items-center justify-between border-b px-4 sm:px-6">
        <BrandLockup subtitle="Staff sign in" />
        <ThemeToggle />
      </header>
      <main id="main" className="flex flex-1 items-start justify-center px-4 py-10 sm:items-center sm:py-16">
        <div className="w-full max-w-sm">{children}</div>
      </main>
      <footer className="px-4 py-6 text-center text-sm text-muted-foreground">
        <Link href="/" className="underline-offset-4 hover:underline">
          Back to Reserve-A-Room
        </Link>
      </footer>
    </div>
  );
}
