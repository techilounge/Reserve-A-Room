import { Repeat2 } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";

export function RecurringBadge({ seriesId, linked = true }: { seriesId: string; linked?: boolean }) {
  if (!linked) {
    return (
      <Badge variant="secondary">
        <Repeat2 data-icon="inline-start" aria-hidden />
        Recurring
      </Badge>
    );
  }
  return (
    <Badge asChild variant="secondary">
      <Link href={`/admin/reservation-series/${seriesId}`}>
        <Repeat2 data-icon="inline-start" aria-hidden />
        Recurring
      </Link>
    </Badge>
  );
}
