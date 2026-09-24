import { TriangleAlert } from "lucide-react";

import {
  capacityWarningForStaff,
  capacityWarningMessage,
  evaluateCapacity,
} from "@/lib/domain/rooms/capacity";
import { cn } from "@/lib/utils";

/**
 * Prominent but friendly capacity warning (ADR-4). Renders nothing when attendance fits.
 * `live` announces changes to screen readers while the guest is typing.
 */
export function CapacityWarning({
  estimated,
  capacity,
  audience = "requester",
  live = false,
  className,
}: {
  estimated: number;
  capacity: number;
  audience?: "requester" | "staff";
  live?: boolean;
  className?: string;
}) {
  const check = evaluateCapacity(estimated, capacity);
  const content = check.exceeds ? (
    <div
      className={cn(
        "flex gap-3 rounded-lg border border-warning-border bg-warning-soft p-4 text-sm text-warning-soft-foreground",
        className,
      )}
    >
      <TriangleAlert className="mt-0.5 size-5 shrink-0" aria-hidden />
      <div>
        <p className="font-semibold">Room Capacity Warning</p>
        <p className="mt-0.5">{audience === "staff" ? capacityWarningForStaff(check) : capacityWarningMessage(check)}</p>
      </div>
    </div>
  ) : null;

  // A persistent live region lets screen readers hear the warning appear and disappear.
  return live ? (
    <div role="status" aria-live="polite">
      {content}
    </div>
  ) : (
    content
  );
}
