import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

import { asRole, createRoom, createStaff, createTestDb, insertReservation, localTime } from "./support/db";

let db: PGlite;
let admin: string;
let superAdmin: string;
let disabledAdmin: string;
let strangerUser: string; // signed in to Supabase Auth but has no staff profile
let archivedRoom: string;
let reservationId: string;

beforeAll(async () => {
  db = await createTestDb();
  admin = await createStaff(db, "admin");
  superAdmin = await createStaff(db, "super_admin");
  disabledAdmin = await createStaff(db, "admin", { active: false });
  const { rows } = await db.query<{ id: string }>(
    "insert into auth.users (email) values ('stranger@example.org') returning id",
  );
  strangerUser = rows[0].id;
  archivedRoom = await createRoom(db, { active: false });
  const room = await createRoom(db);
  ({ id: reservationId } = await insertReservation(db, {
    roomId: room,
    startAt: await localTime(db, 3, "09:00"),
    endAt: await localTime(db, 3, "10:00"),
  }));
  await db.query(
    "insert into public.notifications (user_id, type, title, message) values ($1, 'reservation_pending', 'New', 'New request'), ($2, 'reservation_pending', 'New', 'New request')",
    [admin, superAdmin],
  );
});

const PERMISSION_DENIED = { code: "42501" };

describe("guests (anon)", () => {
  it("can read active rooms but not archived ones", async () => {
    const rows = await asRole(db, "anon", async (tx) => (await tx.query<{ id: string }>("select id from public.rooms")).rows);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.map((r) => r.id)).not.toContain(archivedRoom);
  });

  it("can read ministries and amenities", async () => {
    await asRole(db, "anon", async (tx) => {
      expect((await tx.query("select id from public.ministries")).rows.length).toBe(11);
      expect((await tx.query("select id from public.amenities")).rows.length).toBeGreaterThan(0);
    });
  });

  it("cannot read any reservation data", async () => {
    await expect(asRole(db, "anon", (tx) => tx.query("select id from public.reservations"))).rejects.toMatchObject(
      PERMISSION_DENIED,
    );
  });

  it("cannot read staff profiles, audit logs, email logs or notifications", async () => {
    for (const table of [
      "profiles",
      "audit_logs",
      "email_logs",
      "notifications",
      "rate_limit_events",
      "reservation_series",
      "reservation_series_exceptions",
      "system_email_logs",
    ]) {
      await expect(asRole(db, "anon", (tx) => tx.query(`select 1 from public.${table}`))).rejects.toMatchObject(
        PERMISSION_DENIED,
      );
    }
  });

  it("can read public settings but not the private notification recipients", async () => {
    const rows = await asRole(db, "anon", async (tx) =>
      (await tx.query("select timezone, booking_interval_minutes, allow_guest_cancellation from public.app_settings")).rows,
    );
    expect(rows).toHaveLength(1);
    await expect(
      asRole(db, "anon", (tx) => tx.query("select extra_admin_notification_emails from public.app_settings")),
    ).rejects.toMatchObject(PERMISSION_DENIED);
  });

  it("cannot write anything", async () => {
    await expect(
      asRole(db, "anon", (tx) =>
        tx.query("insert into public.rooms (name, slug, capacity) values ('Hack', 'hack', 5)"),
      ),
    ).rejects.toMatchObject(PERMISSION_DENIED);
    await expect(
      asRole(db, "anon", (tx) => tx.query("update public.rooms set capacity = 1")),
    ).rejects.toMatchObject(PERMISSION_DENIED);
    await expect(
      asRole(db, "anon", (tx) => tx.query("delete from public.ministries")),
    ).rejects.toMatchObject(PERMISSION_DENIED);
  });

  it("cannot call the bootstrap or admin settings functions", async () => {
    await expect(
      asRole(db, "anon", (tx) => tx.query("select public.bootstrap_first_super_admin(gen_random_uuid(), 'x')")),
    ).rejects.toMatchObject(PERMISSION_DENIED);
    await expect(asRole(db, "anon", (tx) => tx.query("select public.get_admin_settings()"))).rejects.toMatchObject(
      PERMISSION_DENIED,
    );
  });

  it("can compute a room's booking horizon (no private data involved)", async () => {
    const rows = await asRole(db, "anon", async (tx) =>
      (await tx.query("select public.booking_horizon_date(id) as d from public.rooms where slug = 'conference-room'")).rows,
    );
    expect(rows).toHaveLength(1);
  });
});

describe("signed-in users without a staff profile", () => {
  it("see no reservations and cannot change rooms", async () => {
    await asRole(
      db,
      "authenticated",
      async (tx) => {
        expect((await tx.query("select id from public.reservations")).rows).toHaveLength(0);
        expect((await tx.query("update public.rooms set capacity = 1 returning id")).rows).toHaveLength(0);
        expect((await tx.query("select id from public.profiles")).rows).toHaveLength(0);
      },
      strangerUser,
    );
  });
});

describe("admins", () => {
  it("can read reservations", async () => {
    const rows = await asRole(
      db,
      "authenticated",
      async (tx) => (await tx.query("select id, requester_email, admin_notes from public.reservations")).rows,
      admin,
    );
    expect(rows.length).toBeGreaterThan(0);
  });

  it("can never read the guest token hash", async () => {
    await expect(
      asRole(db, "authenticated", (tx) => tx.query("select guest_token_hash from public.reservations"), admin),
    ).rejects.toMatchObject(PERMISSION_DENIED);
    await expect(
      asRole(db, "authenticated", (tx) => tx.query("select guest_token_seed from public.reservations"), admin),
    ).rejects.toMatchObject(PERMISSION_DENIED);
  });

  it("cannot write reservations directly", async () => {
    await expect(
      asRole(db, "authenticated", (tx) => tx.query("update public.reservations set status = 'approved'"), admin),
    ).rejects.toMatchObject(PERMISSION_DENIED);
    await expect(
      asRole(db, "authenticated", (tx) => tx.query("delete from public.reservations"), admin),
    ).rejects.toMatchObject(PERMISSION_DENIED);
  });

  it("cannot change room configuration", async () => {
    const updated = await asRole(
      db,
      "authenticated",
      async (tx) => (await tx.query("update public.rooms set approval_required = false returning id")).rows,
      admin,
    );
    expect(updated).toHaveLength(0);
    await expect(
      asRole(
        db,
        "authenticated",
        (tx) => tx.query("insert into public.rooms (name, slug, capacity) values ('New', 'new-room', 5)"),
        admin,
      ),
    ).rejects.toMatchObject(PERMISSION_DENIED);
  });

  it("cannot promote themselves or change anyone's role or status", async () => {
    await expect(
      asRole(db, "authenticated", (tx) => tx.query("update public.profiles set role = 'super_admin' where id = $1", [admin]), admin),
    ).rejects.toMatchObject(PERMISSION_DENIED);
    await expect(
      asRole(db, "authenticated", (tx) => tx.query("update public.profiles set active = false where id = $1", [superAdmin]), admin),
    ).rejects.toMatchObject(PERMISSION_DENIED);
  });

  it("can update their own name, but nobody else's", async () => {
    await asRole(
      db,
      "authenticated",
      async (tx) => {
        expect((await tx.query("update public.profiles set full_name = 'Renamed' where id = $1 returning id", [admin])).rows).toHaveLength(1);
        expect((await tx.query("update public.profiles set full_name = 'Nope' where id = $1 returning id", [superAdmin])).rows).toHaveLength(0);
      },
      admin,
    );
  });

  it("cannot read the audit log or private settings", async () => {
    const rows = await asRole(db, "authenticated", async (tx) => (await tx.query("select id from public.audit_logs")).rows, admin);
    expect(rows).toHaveLength(0);
    await expect(
      asRole(db, "authenticated", (tx) => tx.query("select public.get_admin_settings()"), admin),
    ).rejects.toMatchObject({ code: "RAR09" });
    const updated = await asRole(
      db,
      "authenticated",
      async (tx) => (await tx.query("update public.app_settings set min_lead_time_minutes = 60 returning id")).rows,
      admin,
    );
    expect(updated).toHaveLength(0);
  });

  it("see only their own notifications and can mark them read", async () => {
    await asRole(
      db,
      "authenticated",
      async (tx) => {
        const mine = await tx.query<{ user_id: string }>("select user_id from public.notifications");
        expect(mine.rows.every((n) => n.user_id === admin)).toBe(true);
        expect(mine.rows).toHaveLength(1);
        const marked = await tx.query("update public.notifications set read_at = now() returning id");
        expect(marked.rows).toHaveLength(1);
      },
      admin,
    );
    await expect(
      asRole(db, "authenticated", (tx) => tx.query("update public.notifications set message = 'changed'"), admin),
    ).rejects.toMatchObject(PERMISSION_DENIED);
  });
});

describe("disabled admins", () => {
  it("lose all staff access", async () => {
    await asRole(
      db,
      "authenticated",
      async (tx) => {
        expect((await tx.query("select id from public.reservations")).rows).toHaveLength(0);
        expect((await tx.query("select id from public.notifications")).rows).toHaveLength(0);
      },
      disabledAdmin,
    );
  });
});

describe("super admins", () => {
  it("can configure rooms and ministries", async () => {
    await asRole(
      db,
      "authenticated",
      async (tx) => {
        const updated = await tx.query(
          "update public.rooms set max_advance_value = 6, max_advance_unit = 'week', food_drinks_allowed = true where slug = 'conference-room' returning id",
        );
        expect(updated.rows).toHaveLength(1);
        await tx.query("insert into public.ministries (name) values ('Youth Ministry')");
      },
      superAdmin,
    );
  });

  it("can read the audit log, including the change they just made", async () => {
    const rows = await asRole(
      db,
      "authenticated",
      async (tx) =>
        (
          await tx.query<{ action: string; actor_user_id: string; metadata: { changes: Record<string, unknown> } }>(
            "select action, actor_user_id, metadata from public.audit_logs where entity_type = 'room' and action = 'room.updated' order by id desc limit 1",
          )
        ).rows,
      superAdmin,
    );
    expect(rows[0].actor_user_id).toBe(superAdmin);
    expect(Object.keys(rows[0].metadata.changes).sort()).toEqual(
      ["food_drinks_allowed", "max_advance_value"].sort(),
    );
  });

  it("can read and update private settings", async () => {
    await asRole(
      db,
      "authenticated",
      async (tx) => {
        await tx.query("update public.app_settings set extra_admin_notification_emails = array['office@example.org']");
        const { rows } = await tx.query<{ s: { extra_admin_notification_emails: string[] } }>(
          "select to_jsonb(public.get_admin_settings()) as s",
        );
        expect(rows[0].s.extra_admin_notification_emails).toEqual(["office@example.org"]);
      },
      superAdmin,
    );
  });

  it("still cannot change roles by direct table update (role changes use audited functions)", async () => {
    await expect(
      asRole(db, "authenticated", (tx) => tx.query("update public.profiles set role = 'admin' where id = $1", [admin]), superAdmin),
    ).rejects.toMatchObject(PERMISSION_DENIED);
  });
});

describe("audit log immutability", () => {
  it("rejects updates and deletes, even from the table owner", async () => {
    await expect(db.query("update public.audit_logs set action = 'room.hacked'")).rejects.toMatchObject({ code: "RAR09" });
    await expect(db.query("delete from public.audit_logs")).rejects.toMatchObject({ code: "RAR09" });
  });

  it("denies the service role any update or delete", async () => {
    await expect(asRole(db, "service_role", (tx) => tx.query("delete from public.audit_logs"))).rejects.toMatchObject(
      PERMISSION_DENIED,
    );
  });
});

describe("last Super Admin protection", () => {
  it("refuses to demote, disable or delete the only active Super Admin", async () => {
    const fresh = await createTestDb();
    const only = await createStaff(fresh, "super_admin");
    await expect(fresh.query("update public.profiles set role = 'admin' where id = $1", [only])).rejects.toMatchObject({ code: "RAR06" });
    await expect(fresh.query("update public.profiles set active = false where id = $1", [only])).rejects.toMatchObject({ code: "RAR06" });
    await expect(fresh.query("delete from auth.users where id = $1", [only])).rejects.toMatchObject({ code: "RAR06" });
  });

  it("allows it once another active Super Admin exists", async () => {
    const fresh = await createTestDb();
    const first = await createStaff(fresh, "super_admin");
    await createStaff(fresh, "super_admin");
    await expect(fresh.query("update public.profiles set role = 'admin' where id = $1", [first])).resolves.toBeTruthy();
  });

  it("does not count disabled Super Admins", async () => {
    const fresh = await createTestDb();
    const active = await createStaff(fresh, "super_admin");
    await createStaff(fresh, "super_admin", { active: false });
    await expect(fresh.query("update public.profiles set active = false where id = $1", [active])).rejects.toMatchObject({ code: "RAR06" });
  });
});

describe("first Super Admin bootstrap", () => {
  it("creates the first Super Admin once, then refuses", async () => {
    const fresh = await createTestDb();
    const { rows } = await fresh.query<{ id: string }>(
      "insert into auth.users (email) values ('Pastor@Example.org') returning id",
    );
    await asRole(fresh, "service_role", (tx) =>
      tx.query("select public.bootstrap_first_super_admin($1, 'Church Office')", [rows[0].id]),
    );
    const profile = await fresh.query("select email, role, active from public.profiles where id = $1", [rows[0].id]);
    expect(profile.rows[0]).toEqual({ email: "pastor@example.org", role: "super_admin", active: true });

    const { rows: second } = await fresh.query<{ id: string }>(
      "insert into auth.users (email) values ('intruder@example.org') returning id",
    );
    await expect(
      asRole(fresh, "service_role", (tx) =>
        tx.query("select public.bootstrap_first_super_admin($1, 'Intruder')", [second[0].id]),
      ),
    ).rejects.toMatchObject({ code: "RAR09" });
  });

  it("is not callable by signed-in users", async () => {
    await expect(
      asRole(db, "authenticated", (tx) => tx.query("select public.bootstrap_first_super_admin($1, 'x')", [admin]), admin),
    ).rejects.toMatchObject(PERMISSION_DENIED);
  });
});

describe("function privileges (catalog-wide allowlist)", () => {
  // Every function callable by an API role must be listed here on purpose.
  const EXPECTED: Record<"anon" | "authenticated", string[]> = {
    anon: ["private.is_staff", "private.is_super_admin", "public.booking_horizon_date", "public.get_public_busy_blocks"],
    // Staff functions re-check the caller's role inside (RAR09 for non-staff).
    authenticated: [
      "private.is_staff",
      "private.is_super_admin",
      "private.is_valid_advance",
      "private.is_valid_email",
      "private.is_valid_timezone",
      "private.require_staff",
      "private.require_super_admin",
      "public.admin_audit_log",
      "public.admin_calendar",
      "public.admin_dashboard",
      "public.admin_end_reservation_series",
      "public.admin_export_reservations",
      "public.admin_get_reservation",
      "public.admin_get_reservation_series",
      "public.admin_list_amenities",
      "public.admin_list_ministries",
      "public.admin_list_reservations",
      "public.admin_list_rooms",
      "public.admin_list_users",
      "public.admin_reservation_emails",
      "public.admin_reservation_series_links",
      "public.approve_reservation",
      "public.booking_horizon_date",
      "public.cancel_reservation",
      "public.complete_staff_password_setup",
      "public.create_recurring_reservation_series",
      "public.create_staff_profile",
      "public.create_staff_reservation",
      "public.current_staff_profile",
      "public.decline_reservation",
      "public.get_admin_settings",
      "public.get_public_busy_blocks",
      "public.mark_notifications_read",
      "public.my_notifications",
      "public.record_staff_login",
      "public.retry_email",
      "public.save_amenity",
      "public.save_ministry",
      "public.save_room",
      "public.set_room_image",
      "public.set_user_active",
      "public.set_user_role",
      "public.unread_notification_count",
      "public.update_admin_notes",
      "public.update_app_settings",
      "public.update_reservation",
    ],
  };

  it.each(["anon", "authenticated"] as const)("%s can execute only allowlisted functions", async (role) => {
    const { rows } = await db.query<{ fn: string }>(
      `select distinct n.nspname || '.' || p.proname as fn
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname in ('public', 'private') and has_function_privilege($1, p.oid, 'EXECUTE')
       order by 1`,
      [role],
    );
    expect(rows.map((r) => r.fn)).toEqual(EXPECTED[role]);
  });
});

it("keeps the seeded reservation intact for later assertions", () => {
  expect(reservationId).toBeTruthy();
});
