import {
  BadgeCheck,
  CalendarRange,
  Hourglass,
  MapPin,
  Utensils,
  UtensilsCrossed,
  UsersRound,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import { advanceLabel, type AdvanceRule } from "@/lib/domain/rooms/advance-booking";
import { APPROVAL_COPY, FOOD_COPY } from "@/lib/domain/rooms/policy";
import { cn } from "@/lib/utils";

type Tone = "neutral" | "info" | "success" | "warning" | "danger";

const TONES: Record<Tone, string> = {
  neutral: "border-neutral-border bg-neutral-soft text-neutral-soft-foreground",
  info: "border-info-border bg-info-soft text-info-soft-foreground",
  success: "border-success-border bg-success-soft text-success-soft-foreground",
  warning: "border-warning-border bg-warning-soft text-warning-soft-foreground",
  danger: "border-danger-border bg-danger-soft text-danger-soft-foreground",
};

/** Pill with an icon AND text — meaning is never conveyed by color alone. */
export function PolicyPill({
  icon: Icon,
  tone = "neutral",
  children,
  className,
}: {
  icon: LucideIcon;
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex min-h-7 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        TONES[tone],
        className,
      )}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden />
      {children}
    </span>
  );
}

export function ApprovalBadge({ required }: { required: boolean }) {
  return required ? (
    <PolicyPill icon={Hourglass} tone="info">
      {APPROVAL_COPY.required.label}
    </PolicyPill>
  ) : (
    <PolicyPill icon={Zap} tone="success">
      {APPROVAL_COPY.instant.label}
    </PolicyPill>
  );
}

export function FoodPolicyBadge({ allowed }: { allowed: boolean }) {
  return allowed ? (
    <PolicyPill icon={Utensils} tone="success">
      {FOOD_COPY.allowed.label}
    </PolicyPill>
  ) : (
    <PolicyPill icon={UtensilsCrossed} tone="neutral">
      {FOOD_COPY.notAllowed.label}
    </PolicyPill>
  );
}

export function CapacityBadge({ capacity }: { capacity: number }) {
  return (
    <PolicyPill icon={UsersRound}>
      Up to {capacity} {capacity === 1 ? "person" : "people"}
    </PolicyPill>
  );
}

export function AdvanceBadge({ rule }: { rule: AdvanceRule }) {
  return <PolicyPill icon={CalendarRange}>Book up to {advanceLabel(rule)} ahead</PolicyPill>;
}

export function LocationBadge({ location }: { location: string }) {
  return <PolicyPill icon={MapPin}>{location}</PolicyPill>;
}

export function AvailableBadge() {
  return (
    <PolicyPill icon={BadgeCheck} tone="success">
      Open for reservations
    </PolicyPill>
  );
}
