/**
 * Capacity warning (ADR-4). Never blocks a reservation and never changes the number the
 * requester entered — it only informs the requester (before submitting) and staff.
 */

export type CapacityCheck =
  | { exceeds: false; capacity: number; estimated: number }
  | { exceeds: true; capacity: number; estimated: number; overBy: number };

export function evaluateCapacity(estimatedAttendance: number, capacity: number): CapacityCheck {
  if (Number.isFinite(estimatedAttendance) && estimatedAttendance > capacity) {
    return { exceeds: true, capacity, estimated: estimatedAttendance, overBy: estimatedAttendance - capacity };
  }
  return { exceeds: false, capacity, estimated: estimatedAttendance };
}

const people = (n: number) => `${n} ${n === 1 ? "person" : "people"}`;

/** Requester-facing wording. */
export function capacityWarningMessage(check: Extract<CapacityCheck, { exceeds: true }>): string {
  return `This room is configured for a maximum of ${people(check.capacity)}, but you entered ${check.estimated} attendees. Please consider selecting a larger room.`;
}

/** Staff-facing wording. */
export function capacityWarningForStaff(check: Extract<CapacityCheck, { exceeds: true }>): string {
  return `Estimated attendance (${check.estimated}) exceeds this room's capacity of ${check.capacity} by ${check.overBy}.`;
}
