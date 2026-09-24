import { Hammer } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Honest placeholder for a route whose feature is scheduled in a later build phase.
 * It never pretends to work. Every usage must be gone before launch (Phase 12 check:
 * `grep -r UpcomingFeature src` returns nothing).
 */
export function UpcomingFeature({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby="upcoming-feature-title"
      className="flex flex-col items-center gap-3 rounded-xl border border-dashed bg-card px-6 py-12 text-center"
    >
      <span className="flex size-12 items-center justify-center rounded-full bg-info-soft text-info-soft-foreground">
        <Hammer className="size-6" aria-hidden />
      </span>
      <h2 id="upcoming-feature-title" className="text-lg font-semibold">
        {title}
      </h2>
      <div className="max-w-md text-sm text-muted-foreground">{children}</div>
    </section>
  );
}
