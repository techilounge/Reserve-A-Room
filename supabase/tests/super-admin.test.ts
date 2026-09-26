import type { PGlite, Transaction } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

import { asRole, createStaff, createTestDb, insertReservation, localTime } from "./support/db";

let db: PGlite;
let superAdmin: string;
let admin: string;

beforeAll(async () => {
  db = await createTestDb();
  superAdmin = await createStaff(db, "super_admin", { email: "pastor@example.org" });
  admin = await createStaff(db, "admin", { email: "office@example.org" });
});

const as = <T>(user: string, fn: (tx: Transaction) => Promise<T>) => asRole(db, "authenticated", fn, user);

const saveRoom = (user: string, overrides: Record<string, unknown> = {}) => {
  const args: Record<string, unknown> = {
    p_id: null,
    p_name: "Fellowship Hall",
    p_slug: "fellowship-hall",
    p_capacity: 120,
    p_approval_required: true,
    p_food_drinks_allowed: true,
    p_active: true,
    p_reservable: true,
    p_sort_order: 20,
    p_amenity_ids: [],
    p_max_advance_value: 8,
    p_max_advance_unit: "week",
    ...overrides,
  };
  const names = Object.keys(args);
  return as(user, async (tx) =>
    (
      await tx.query<{ id: string }>(
        `select public.save_room(${names.map((n, i) => `${n} => $${i + 1}`).join(", ")}) as id`,
        names.map((n) => (Array.isArray(args[n]) ? `{${(args[n] as string[]).join(",")}}` : args[n])),
      )
    ).rows[0].id,
  );
};

describe("room management", () => {
  let roomId: string;

  it("lets Super Admins create a room with its rules and amenities", async () => {
    const { rows: amenities } = await db.query<{ id: string }>("select id from public.amenities order by sort_order limit 2");
    roomId = await saveRoom(superAdmin, { p_amenity_ids: amenities.map((a) => a.id) });
    const { rows } = await db.query(
      "select capacity, approval_required, max_advance_value, max_advance_unit, food_drinks_allowed from public.rooms where id = $1",
      [roomId],
    );
    expect(rows[0]).toEqual({ capacity: 120, approval_required: true, max_advance_value: 8, max_advance_unit: "week", food_drinks_allowed: true });
    const links = await db.query("select count(*)::int as n from public.room_amenities where room_id = $1", [roomId]);
    expect(links.rows[0]).toEqual({ n: 2 });
  });

  it("updates rules, replaces amenities and audits exactly what changed", async () => {
    await saveRoom(superAdmin, { p_id: roomId, p_approval_required: false, p_max_advance_value: 3, p_max_advance_unit: "month", p_food_drinks_allowed: false, p_amenity_ids: [] });
    const links = await db.query("select count(*)::int as n from public.room_amenities where room_id = $1", [roomId]);
    expect(links.rows[0]).toEqual({ n: 0 });
    const { rows } = await db.query<{ metadata: { changes: Record<string, unknown> } }>(
      "select metadata from public.audit_logs where entity_id = $1 and action = 'room.updated' order by id desc limit 1",
      [roomId],
    );
    expect(Object.keys(rows[0].metadata.changes).sort()).toEqual(
      ["approval_required", "food_drinks_allowed", "max_advance_unit", "max_advance_value"].sort(),
    );
  });

  it("uses the application default when no advance rule is given", async () => {
    await saveRoom(superAdmin, { p_id: roomId, p_max_advance_value: null, p_max_advance_unit: null });
    const { rows } = await db.query("select max_advance_value from public.rooms where id = $1", [roomId]);
    expect(rows[0]).toEqual({ max_advance_value: null });
  });

  it("archives instead of deleting, keeping reservation history", async () => {
    await insertReservation(db, { roomId, startAt: await localTime(db, 2, "09:00"), endAt: await localTime(db, 2, "10:00") });
    await saveRoom(superAdmin, { p_id: roomId, p_active: false });
    const { rows } = await db.query("select count(*)::int as n from public.reservations where room_id = $1", [roomId]);
    expect(rows[0]).toEqual({ n: 1 });
    await expect(db.query("delete from public.rooms where id = $1", [roomId])).rejects.toMatchObject({ code: "23001" });
  });

  it("rejects invalid configuration and duplicate slugs", async () => {
    await expect(saveRoom(superAdmin, { p_slug: "new-room", p_max_advance_value: 30, p_max_advance_unit: "month" })).rejects.toMatchObject({ code: "23514" });
    await expect(saveRoom(superAdmin, { p_slug: "conference-room" })).rejects.toMatchObject({ code: "23505" });
    await expect(saveRoom(superAdmin, { p_slug: "Bad Slug!" })).rejects.toMatchObject({ code: "23514" });
  });

  it("is refused for Admins", async () => {
    await expect(saveRoom(admin, { p_slug: "admin-room" })).rejects.toMatchObject({ code: "RAR09" });
    await expect(as(admin, (tx) => tx.query("select public.set_room_image($1, null)", [roomId]))).rejects.toMatchObject({ code: "RAR09" });
  });

  it("only accepts image paths inside the room's own folder", async () => {
    await expect(as(superAdmin, (tx) => tx.query("select public.set_room_image($1, $2)", [roomId, "rooms/other/x.jpg"]))).rejects.toMatchObject({ code: "RAR10" });
    await as(superAdmin, (tx) => tx.query("select public.set_room_image($1, $2)", [roomId, `rooms/${roomId}/photo-1.webp`]));
  });
});

describe("ministries", () => {
  it("lets Super Admins add, rename and deactivate ministries", async () => {
    const id = await as(superAdmin, async (tx) =>
      (await tx.query<{ id: string }>("select public.save_ministry(p_name => 'Youth Ministry', p_active => true, p_sort_order => 120) as id")).rows[0].id,
    );
    await as(superAdmin, (tx) => tx.query("select public.save_ministry(p_id => $1, p_name => 'Youth & Young Adults', p_active => false, p_sort_order => 120)", [id]));
    const { rows } = await db.query("select name, active from public.ministries where id = $1", [id]);
    expect(rows[0]).toEqual({ name: "Youth & Young Adults", active: false });
    await expect(as(admin, (tx) => tx.query("select public.save_ministry(p_name => 'Nope', p_active => true, p_sort_order => 1)"))).rejects.toMatchObject({ code: "RAR09" });
  });
});

describe("users & roles", () => {
  it("creates staff profiles only for existing auth users, once", async () => {
    const { rows } = await db.query<{ id: string }>("insert into auth.users (email) values ('New.Helper@Example.org') returning id");
    await as(superAdmin, (tx) => tx.query("select public.create_staff_profile($1, 'New Helper', 'admin')", [rows[0].id]));
    const profile = await db.query("select email, role, invited_by from public.profiles where id = $1", [rows[0].id]);
    expect(profile.rows[0]).toEqual({ email: "new.helper@example.org", role: "admin", invited_by: superAdmin });
    await expect(as(superAdmin, (tx) => tx.query("select public.create_staff_profile($1, 'Again', 'admin')", [rows[0].id]))).rejects.toMatchObject({ code: "RAR10" });
  });

  it("requires deliberate demotion before a Super Admin can be disabled", async () => {
    await as(superAdmin, (tx) => tx.query("select public.set_user_role($1, 'super_admin')", [admin]));
    await expect(as(superAdmin, (tx) => tx.query("select public.set_user_active($1, false)", [admin]))).rejects.toMatchObject({ code: "RAR11" });
    await as(superAdmin, (tx) => tx.query("select public.set_user_role($1, 'admin')", [admin]));
    await as(superAdmin, (tx) => tx.query("select public.set_user_active($1, false)", [admin]));
    await as(superAdmin, (tx) => tx.query("select public.set_user_active($1, true)", [admin]));
    const audit = await db.query<{ action: string }>("select action from public.audit_logs where entity_type = 'user' and entity_id = $1", [admin]);
    expect(audit.rows.length).toBeGreaterThanOrEqual(4);
  });

  it("never lets Admins change roles — including their own", async () => {
    await expect(as(admin, (tx) => tx.query("select public.set_user_role($1, 'super_admin')", [admin]))).rejects.toMatchObject({ code: "RAR09" });
    await expect(as(admin, (tx) => tx.query("select public.set_user_active($1, false)", [superAdmin]))).rejects.toMatchObject({ code: "RAR09" });
    await expect(as(admin, (tx) => tx.query("select * from public.admin_list_users()"))).rejects.toMatchObject({ code: "RAR09" });
  });

  it("refuses to demote or disable the last active Super Admin", async () => {
    await expect(as(superAdmin, (tx) => tx.query("select public.set_user_role($1, 'admin')", [superAdmin]))).rejects.toMatchObject({ code: "RAR06" });
    await expect(as(superAdmin, (tx) => tx.query("select public.set_user_active($1, false)", [superAdmin]))).rejects.toMatchObject({ code: "RAR11" });
  });

  it("lists users with their last sign-in", async () => {
    await db.query("update auth.users set last_sign_in_at = now() where id = $1", [admin]);
    const rows = await as(superAdmin, async (tx) => (await tx.query<{ email: string; last_sign_in_at: unknown }>("select * from public.admin_list_users()")).rows);
    expect(rows.find((r) => r.email === "office@example.org")?.last_sign_in_at).toBeTruthy();
  });
});

describe("settings", () => {
  const update = (user: string, overrides: Record<string, unknown> = {}) => {
    const args: Record<string, unknown> = {
      p_church_name: "Stonehill Seventh-day Adventist Church",
      p_app_name: "Reserve-A-Room",
      p_timezone: "America/Chicago",
      p_booking_interval_minutes: 30,
      p_default_max_advance_value: 8,
      p_default_max_advance_unit: "week",
      p_min_lead_time_minutes: 60,
      p_bookable_day_start: "07:00",
      p_bookable_day_end: "21:00",
      p_allow_guest_cancellation: true,
      p_extra_admin_notification_emails: '{"Office@Example.org"," office@example.org ",""}',
      p_email_sender_name: "Stonehill Reserve-A-Room",
      p_contact_email: "Office@Example.org",
      ...overrides,
    };
    const names = Object.keys(args);
    return as(user, (tx) =>
      tx.query(`select public.update_app_settings(${names.map((n, i) => `${n} => $${i + 1}`).join(", ")})`, names.map((n) => args[n])),
    );
  };

  it("saves validated settings and de-duplicates recipient emails", async () => {
    await update(superAdmin);
    const { rows } = await db.query("select min_lead_time_minutes, extra_admin_notification_emails, contact_email from public.app_settings");
    expect(rows[0]).toEqual({ min_lead_time_minutes: 60, extra_admin_notification_emails: ["office@example.org"], contact_email: "office@example.org" });
  });

  it("rejects invalid values and non-Super Admins", async () => {
    await expect(update(superAdmin, { p_timezone: "Mars/Olympus" })).rejects.toMatchObject({ code: "23514" });
    await expect(update(superAdmin, { p_bookable_day_start: "22:00", p_bookable_day_end: "06:00" })).rejects.toMatchObject({ code: "23514" });
    await expect(update(admin)).rejects.toMatchObject({ code: "RAR09" });
  });
});

describe("audit log", () => {
  it("is searchable by Super Admins only", async () => {
    const rows = await as(superAdmin, async (tx) => (await tx.query<{ action: string }>("select * from public.admin_audit_log('room')")).rows);
    expect(rows.length).toBeGreaterThan(0);
    await expect(as(admin, (tx) => tx.query("select * from public.admin_audit_log()"))).rejects.toMatchObject({ code: "RAR09" });
  });
});

describe("room image storage", () => {
  it("allows uploads by Super Admins only", async () => {
    await as(superAdmin, (tx) => tx.query("insert into storage.objects (bucket_id, name) values ('room-images', 'rooms/a/photo.jpg')"));
    await expect(
      as(admin, (tx) => tx.query("insert into storage.objects (bucket_id, name) values ('room-images', 'rooms/a/hack.jpg')")),
    ).rejects.toMatchObject({ code: "42501" });
  });
});
