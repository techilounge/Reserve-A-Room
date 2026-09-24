import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type DetailItem = { label: string; value: ReactNode; wide?: boolean };

/** Responsive label/value list used for reservation summaries. */
export function DetailList({ items, className }: { items: readonly (DetailItem | null | false)[]; className?: string }) {
  return (
    <dl className={cn("grid gap-x-6 gap-y-4 sm:grid-cols-2", className)}>
      {items
        .filter((item): item is DetailItem => Boolean(item))
        .map((item) => (
          <div key={item.label} className={cn("min-w-0", item.wide && "sm:col-span-2")}>
            <dt className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{item.label}</dt>
            <dd className="mt-1 break-words whitespace-pre-line">{item.value}</dd>
          </div>
        ))}
    </dl>
  );
}
