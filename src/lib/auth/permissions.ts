/**
 * The permission matrix (master brief, Section 78) expressed as data.
 *
 * UI code uses `can()` to decide what to show. Server actions use the guards built on
 * top of it (Phase 5), which load the caller's role from the database — never from
 * the browser. Postgres RLS enforces the same rules independently.
 */

export const APP_ROLES = ["admin", "super_admin"] as const;
export type AppRole = (typeof APP_ROLES)[number];

/** Guests are unauthenticated visitors and have no database record. */
export type ActorRole = "guest" | AppRole;

export type Actor =
  | { kind: "guest" }
  | { kind: "staff"; role: AppRole; active: boolean };

export const GUEST: Actor = { kind: "guest" };

const EVERYONE = ["guest", "admin", "super_admin"] as const satisfies readonly ActorRole[];
const STAFF = ["admin", "super_admin"] as const satisfies readonly ActorRole[];
const SUPER_ADMIN = ["super_admin"] as const satisfies readonly ActorRole[];

export const PERMISSIONS = {
  "rooms.view": EVERYONE,
  "roomPolicies.view": EVERYONE,
  "availability.view": EVERYONE,
  "reservation.create": EVERYONE,
  /** Viewing/cancelling one's own reservation through the secure emailed link. */
  "reservation.manageOwnViaLink": ["guest"],

  "reservations.viewAll": STAFF,
  "reservations.approve": STAFF,
  "reservations.decline": STAFF,
  "reservations.edit": STAFF,
  "reservations.cancel": STAFF,
  "reservations.createApproved": STAFF,
  "calendar.view": STAFF,
  "notifications.receive": STAFF,
  "emails.retry": STAFF,

  /** Includes capacity, approval requirement, advance-booking limit and food policy. */
  "rooms.manage": SUPER_ADMIN,
  "ministries.manage": SUPER_ADMIN,
  "users.manage": SUPER_ADMIN,
  "roles.assign": SUPER_ADMIN,
  "settings.manage": SUPER_ADMIN,
  "audit.view": SUPER_ADMIN,
} as const satisfies Record<string, readonly ActorRole[]>;

export type Permission = keyof typeof PERMISSIONS;

/** Disabled staff accounts are treated exactly like guests. */
export function effectiveRole(actor: Actor): ActorRole {
  if (actor.kind === "staff" && actor.active) return actor.role;
  return "guest";
}

export function can(actor: Actor, permission: Permission): boolean {
  const allowed: readonly ActorRole[] = PERMISSIONS[permission];
  return allowed.includes(effectiveRole(actor));
}

export function isAppRole(value: unknown): value is AppRole {
  return typeof value === "string" && (APP_ROLES as readonly string[]).includes(value);
}
