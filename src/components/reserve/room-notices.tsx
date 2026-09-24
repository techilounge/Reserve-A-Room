import { CalendarRange, Hourglass, Utensils, UtensilsCrossed, Zap } from "lucide-react";

import { advanceLimitMessage } from "@/lib/domain/rooms/advance-booking";
import { APPROVAL_COPY, FOOD_COPY } from "@/lib/domain/rooms/policy";
import { cn } from "@/lib/utils";

import type { ReserveRoom } from "./types";

/** What happens after submission — stated before the guest submits (brief §10). */
export function ApprovalNotice({ room, className }: { room: ReserveRoom; className?: string }) {
  const copy = room.approvalRequired ? APPROVAL_COPY.required : APPROVAL_COPY.instant;
  const Icon = room.approvalRequired ? Hourglass : Zap;
  return (
    <div
      className={cn(
        "flex gap-3 rounded-lg border p-4 text-sm",
        room.approvalRequired
          ? "border-info-border bg-info-soft text-info-soft-foreground"
          : "border-success-border bg-success-soft text-success-soft-foreground",
        className,
      )}
    >
      <Icon className="mt-0.5 size-5 shrink-0" aria-hidden />
      <div>
        <p className="font-semibold">{copy.label}</p>
        <p>{copy.description}</p>
      </div>
    </div>
  );
}

export function FoodNotice({ room, className }: { room: ReserveRoom; className?: string }) {
  const copy = room.foodDrinksAllowed ? FOOD_COPY.allowed : FOOD_COPY.notAllowed;
  const Icon = room.foodDrinksAllowed ? Utensils : UtensilsCrossed;
  return (
    <p className={cn("flex items-start gap-2 text-sm", className)}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>
        <strong className="font-semibold">{copy.label}.</strong> {copy.notice}
      </span>
    </p>
  );
}

export function AdvanceNotice({ room, className }: { room: ReserveRoom; className?: string }) {
  return (
    <p className={cn("flex items-start gap-2 text-sm", className)}>
      <CalendarRange className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{advanceLimitMessage(room.advance)}</span>
    </p>
  );
}
