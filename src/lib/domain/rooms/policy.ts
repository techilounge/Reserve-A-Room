import { advanceLabel, type AdvanceRule } from "./advance-booking";

export type RoomPolicy = {
  capacity: number;
  approvalRequired: boolean;
  foodDrinksAllowed: boolean;
  advance: AdvanceRule;
};

export const APPROVAL_COPY = {
  required: {
    label: "Approval Required",
    description: "Your reservation will be submitted for review.",
  },
  instant: {
    label: "Instant Reservation",
    description: "Your reservation will be confirmed immediately if the selected time is still available.",
  },
} as const;

export const FOOD_COPY = {
  allowed: { label: "Food & Drinks Allowed", notice: "Food and drinks are allowed in this room." },
  notAllowed: { label: "No Food or Drinks", notice: "Food and drinks are not permitted in this room." },
} as const;

/**
 * Plain-language summary shown to guests and on the Super Admin room editor, e.g.
 * "Guests may reserve this room up to 4 weeks in advance. Reservations require approval.
 *  Food and drinks are not allowed."
 */
export function roomPolicySummary(policy: RoomPolicy): string {
  return [
    `Guests may reserve this room up to ${advanceLabel(policy.advance)} in advance.`,
    policy.approvalRequired ? "Reservations require approval." : "Reservations are confirmed immediately.",
    policy.foodDrinksAllowed ? "Food and drinks are allowed." : "Food and drinks are not allowed.",
  ].join(" ");
}
