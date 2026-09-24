/** Human-readable audit log entries. */

const ACTION_LABELS: Record<string, string> = {
  "reservation.created": "Reservation created",
  "reservation.approved": "Reservation approved",
  "reservation.declined": "Reservation declined",
  "reservation.cancelled": "Reservation cancelled",
  "reservation.updated": "Reservation edited",
  "reservation.notes_updated": "Private notes updated",
  "room.created": "Room created",
  "room.updated": "Room updated",
  "room.deleted": "Room deleted",
  "room_amenity.created": "Amenity added to room",
  "room_amenity.deleted": "Amenity removed from room",
  "amenity.created": "Amenity created",
  "amenity.updated": "Amenity updated",
  "ministry.created": "Ministry added",
  "ministry.updated": "Ministry updated",
  "settings.updated": "Settings changed",
  "user.created": "Administrator added",
  "user.updated": "Administrator changed",
  "user.deleted": "Administrator removed",
  "user.bootstrapped": "First Super Admin created",
};

const FIELD_LABELS: Record<string, string> = {
  approval_required: "Approval required",
  food_drinks_allowed: "Food & drinks allowed",
  max_advance_value: "Advance limit",
  max_advance_unit: "Advance limit unit",
  capacity: "Capacity",
  active: "Active",
  reservable: "Open for reservations",
  unavailable_message: "Unavailable message",
  role: "Role",
  full_name: "Name",
  start_at: "Start",
  end_at: "End",
  room_id: "Room",
  admin_notes: "Private notes",
  default_max_advance_value: "Default advance limit",
  default_max_advance_unit: "Default advance unit",
  min_lead_time_minutes: "Minimum notice (minutes)",
  bookable_day_start: "Day starts",
  bookable_day_end: "Day ends",
  booking_interval_minutes: "Time increments",
  allow_guest_cancellation: "Guest cancellation",
  extra_admin_notification_emails: "Extra recipients",
  timezone: "Timezone",
  name: "Name",
  slug: "Web address",
  sort_order: "Display order",
  image_path: "Photo",
  purpose: "Purpose",
  estimated_attendance: "Estimated attendance",
};

// Noise that isn't useful to read in the log.
const HIDDEN_FIELDS = new Set(["id", "updated_by", "invited_by", "search_text", "reservation_range"]);

export function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action.replace(/[._]/g, " ");
}

function show(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (value === true) return "Yes";
  if (value === false) return "No";
  if (value === "super_admin") return "Super Admin";
  if (value === "admin") return "Admin";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "—";
  return String(value);
}

export type AuditChange = { field: string; from: string; to: string };

/** Extracts "field: from → to" rows from trigger- or function-written metadata. */
export function auditChanges(metadata: unknown): AuditChange[] {
  if (!metadata || typeof metadata !== "object") return [];
  const changes = (metadata as { changes?: Record<string, unknown> }).changes;
  if (!changes || typeof changes !== "object") return [];
  return Object.entries(changes)
    .filter(([field]) => !HIDDEN_FIELDS.has(field))
    .map(([field, change]) => {
      const c = (change ?? {}) as { from?: unknown; to?: unknown; changed?: boolean };
      if (c.changed) return { field: FIELD_LABELS[field] ?? field, from: "", to: "changed" };
      return { field: FIELD_LABELS[field] ?? field.replace(/_/g, " "), from: show(c.from), to: show(c.to) };
    });
}

/** Short subject for the entry, e.g. a reservation reference or room name. */
export function auditSubject(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const m = metadata as Record<string, unknown>;
  if (typeof m.reference_code === "string") return m.reference_code;
  const changes = m.changes as Record<string, { to?: unknown; from?: unknown }> | undefined;
  const name = changes?.name?.to ?? changes?.name?.from ?? changes?.full_name?.to ?? changes?.email?.to;
  return typeof name === "string" ? name : null;
}
