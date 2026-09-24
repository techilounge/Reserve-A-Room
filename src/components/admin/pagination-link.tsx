import Link from "next/link";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";

/** A real link when there is a page to go to, otherwise a disabled (non-focusable) button. */
export function PaginationLink({ href, children }: { href: string | null; children: ReactNode }) {
  if (!href) {
    return (
      <Button type="button" variant="outline" size="sm" disabled>
        {children}
      </Button>
    );
  }
  return (
    <Button asChild variant="outline" size="sm">
      <Link href={href}>{children}</Link>
    </Button>
  );
}
