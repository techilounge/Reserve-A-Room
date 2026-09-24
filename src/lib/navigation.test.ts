import { describe, expect, it } from "vitest";

import { GUEST, type Actor } from "@/lib/auth/permissions";

import { isActivePath, navigationFor } from "./navigation";

const hrefs = (actor: Actor) => navigationFor(actor).flatMap((g) => g.items.map((i) => i.href));

describe("navigationFor", () => {
  it("shows admins only the Manage section", () => {
    const actor: Actor = { kind: "staff", role: "admin", active: true };
    expect(navigationFor(actor).map((g) => g.label)).toEqual(["Manage"]);
    expect(hrefs(actor)).not.toContain("/admin/rooms");
    expect(hrefs(actor)).not.toContain("/admin/audit");
  });

  it("shows super admins every section", () => {
    const actor: Actor = { kind: "staff", role: "super_admin", active: true };
    expect(navigationFor(actor).map((g) => g.label)).toEqual(["Manage", "Super Admin"]);
    expect(hrefs(actor)).toContain("/admin/users");
  });

  it("shows guests and disabled staff nothing", () => {
    expect(navigationFor(GUEST)).toEqual([]);
    expect(navigationFor({ kind: "staff", role: "super_admin", active: false })).toEqual([]);
  });
});

describe("isActivePath", () => {
  it("matches section roots exactly", () => {
    expect(isActivePath("/admin", "/admin")).toBe(true);
    expect(isActivePath("/admin/rooms", "/admin")).toBe(false);
    expect(isActivePath("/rooms", "/")).toBe(false);
  });

  it("matches nested pages by prefix without partial-segment matches", () => {
    expect(isActivePath("/admin/reservations/123", "/admin/reservations")).toBe(true);
    expect(isActivePath("/admin/rooms-archive", "/admin/rooms")).toBe(false);
  });
});
