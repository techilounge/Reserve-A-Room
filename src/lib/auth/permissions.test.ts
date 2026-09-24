import { describe, expect, it } from "vitest";

import { can, effectiveRole, GUEST, isAppRole, PERMISSIONS, type Actor, type Permission } from "./permissions";

const admin: Actor = { kind: "staff", role: "admin", active: true };
const superAdmin: Actor = { kind: "staff", role: "super_admin", active: true };
const disabledSuperAdmin: Actor = { kind: "staff", role: "super_admin", active: false };

// Mirrors the master brief's Section 78 matrix row by row: [guest, admin, super admin].
const MATRIX: [Permission, boolean, boolean, boolean][] = [
  ["rooms.view", true, true, true],
  ["roomPolicies.view", true, true, true],
  ["availability.view", true, true, true],
  ["reservation.create", true, true, true],
  ["reservation.manageOwnViaLink", true, false, false],
  ["reservations.viewAll", false, true, true],
  ["reservations.approve", false, true, true],
  ["reservations.decline", false, true, true],
  ["reservations.edit", false, true, true],
  ["reservations.cancel", false, true, true],
  ["calendar.view", false, true, true],
  ["notifications.receive", false, true, true],
  ["rooms.manage", false, false, true],
  ["ministries.manage", false, false, true],
  ["users.manage", false, false, true],
  ["roles.assign", false, false, true],
  ["settings.manage", false, false, true],
  ["audit.view", false, false, true],
];

describe("permission matrix", () => {
  it.each(MATRIX)("%s → guest %s, admin %s, super admin %s", (permission, guest, adm, sup) => {
    expect(can(GUEST, permission)).toBe(guest);
    expect(can(admin, permission)).toBe(adm);
    expect(can(superAdmin, permission)).toBe(sup);
  });

  it("admins can never reach a super-admin-only capability", () => {
    const superOnly = (Object.keys(PERMISSIONS) as Permission[]).filter(
      (p) => can(superAdmin, p) && !can(admin, p) && !can(GUEST, p),
    );
    expect(superOnly.sort()).toEqual(
      ["audit.view", "ministries.manage", "roles.assign", "rooms.manage", "settings.manage", "users.manage"].sort(),
    );
  });

  it("treats disabled staff as guests", () => {
    expect(effectiveRole(disabledSuperAdmin)).toBe("guest");
    expect(can(disabledSuperAdmin, "reservations.viewAll")).toBe(false);
    expect(can(disabledSuperAdmin, "rooms.manage")).toBe(false);
    expect(can(disabledSuperAdmin, "reservation.create")).toBe(true);
  });
});

describe("isAppRole", () => {
  it("accepts only the two staff roles", () => {
    expect(isAppRole("admin")).toBe(true);
    expect(isAppRole("super_admin")).toBe(true);
    expect(isAppRole("guest")).toBe(false);
    expect(isAppRole("SUPER_ADMIN")).toBe(false);
    expect(isAppRole(undefined)).toBe(false);
  });
});
