import { Ban, CircleCheck, CircleX, Hourglass } from "lucide-react";

import { PolicyPill } from "@/components/rooms/policy-badges";
import type { Enums } from "@/lib/supabase/database.types";

export const STATUS_META = {
  pending: { label: "Pending", icon: Hourglass, tone: "warning" },
  approved: { label: "Approved", icon: CircleCheck, tone: "success" },
  declined: { label: "Declined", icon: CircleX, tone: "danger" },
  cancelled: { label: "Cancelled", icon: Ban, tone: "neutral" },
} as const satisfies Record<Enums<"reservation_status">, { label: string; icon: unknown; tone: string }>;

/** Accessible status badge: icon + text, never color alone. */
export function StatusBadge({ status, className }: { status: Enums<"reservation_status">; className?: string }) {
  const meta = STATUS_META[status];
  return (
    <PolicyPill icon={meta.icon} tone={meta.tone} className={className}>
      <span className="sr-only">Status: </span>
      {meta.label}
    </PolicyPill>
  );
}
