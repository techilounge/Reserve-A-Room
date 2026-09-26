import type { PGlite, Transaction } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

import { asRole, createRoom, createStaff, createTestDb, insertReservation, localTime } from "./support/db";

let db: PGlite;
let admin: string;
let disabled: string;
let hall: string;
let small: string;

beforeAll(async () => {
  db = await createTestDb();
  admin = await createStaff(db, "admin", { email: "office@example.org" });
  await createStaff(db, "super_admin", { email: "pastor@example.org" });
  disabled = await createStaff(db, "admin", { active: false });
  hall = await createRoom(db, { slug: "hall", capacity: 100, approval_required: true });
  small = await createRoom(db, { slug: "small", capacity: 6, approval_required: false, max_advance_value: 2, max_advance_unit: "week", food_drinks_allowed: false });
});

const asAdmin = <T>(fn: (tx: Transaction) => Promise<T>, user = admin) => asRole(db, "authenticated", fn, user);

async function reservation(room: string, day: number, from: string, to: string, status: "pending" | "approved" = "pending") {
  return insertReservation(db, { roomId: room, startAt: await localTime(db, day, from), endAt: await localTime(db, day, to), status });
}

const emailsFor = async (id: string) =>
  (await db.query<{ event_type: string }>("select event_type from public.email_logs where reservation_id = $1 order by created_at", [id])).rows.map(
    (r) => r.event_type,
  );

describe("access", () => {
  it("is limited to active staff", async () => {
    await expect(asRole(db, "anon", (tx) => tx.query("select * from public.admin_dashboard()"))).rejects.toMatchObject({ code: "42501" });
    await expect(asAdmin((tx) => tx.query("select * from public.admin_dashboard()"), disabled)).rejects.toMatchObject({ code: "RAR09" });
    const { rows } = await db.query<{ id: string }>("insert into auth.users (email) values ('x@example.org') returning id");
    await expect(asAdmin((tx) => tx.query("select * from public.admin_list_reservations()"), rows[0].id)).rejects.toMatchObject({ code: "RAR09" });
  });
});

describe("admin_list_reservations", () => {
  let target: { id: string; reference_code: string };
  beforeAll(async () => {
    target = await reservation(hall, 3, "09:00", "10:00");
    await db.query(
      "update public.reservations set requester_first_name = 'Dorothy', requester_last_name = 'Vaughan', requester_phone = '+15125550177' where id = $1",
      [target.id],
    );
    await reservation(hall, 4, "09:00", "10:00", "approved");
    await reservation(small, 5, "09:00", "10:00", "approved");
  });

  const list = (args: string, params: unknown[] = []) =>
    asAdmin(async (tx) => (await tx.query<Record<string, unknown>>(`select * from public.admin_list_reservations(${args})`, params)).rows);

  it("searches names, reference codes, typed phone digits and room names", async () => {
    expect((await list("p_search => $1", ["vaughan"])).map((r) => r.id)).toEqual([target.id]);
    expect((await list("p_search => $1", [target.reference_code.toLowerCase()])).map((r) => r.id)).toEqual([target.id]);
    expect((await list("p_search => $1", ["555-0177"])).map((r) => r.id)).toEqual([target.id]);
    expect((await list("p_search => $1", ["Room small"])).length).toBe(1);
  });

  it("filters by status, room and approval type", async () => {
    expect((await list("p_statuses => array['pending']::public.reservation_status[]")).every((r) => r.status === "pending")).toBe(true);
    expect((await list("p_room_id => $1", [small])).length).toBe(1);
    expect((await list("p_approval => 'instant'")).every((r) => r.approval_required_at_submission === false)).toBe(true);
  });

  it("paginates with a total count and never returns token hashes", async () => {
    const page = await list("p_limit => 2, p_offset => 0");
    expect(page).toHaveLength(2);
    expect(Number(page[0].total_count)).toBe(3);
    expect(page[0]).not.toHaveProperty("guest_token_hash");
  });
});

describe("dashboard", () => {
  it("counts pending requests and upcoming reservations", async () => {
    const [row] = await asAdmin(async (tx) => (await tx.query<Record<string, number>>("select * from public.admin_dashboard()")).rows);
    expect(row.pending_count).toBeGreaterThanOrEqual(1);
    expect(row.upcoming_count).toBeGreaterThanOrEqual(3);
  });
});

describe("admin_export_reservations", () => {
  it("requires active staff and a bounded date range", async () => {
    const year = (await db.query<{ y: string }>("select extract(year from now())::int::text as y")).rows[0].y;
    const from = `${year}-01-01`;
    const to = `${year}-12-31`;
    const rows = await asAdmin(async (tx) =>
      (await tx.query<Record<string, unknown>>("select * from public.admin_export_reservations($1, $2)", [from, to])).rows,
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).not.toHaveProperty("guest_token_hash");
    await expect(
      asRole(db, "anon", (tx) => tx.query("select * from public.admin_export_reservations($1, $2)", [from, to])),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      asAdmin((tx) => tx.query("select * from public.admin_export_reservations('2026-01-01', '2027-12-31')")),
    ).rejects.toMatchObject({ code: "RAR10" });
  });
});

describe("approve / decline / cancel", () => {
  it("approves a pending request, recording who and emailing the requester", async () => {
    const r = await reservation(hall, 6, "09:00", "10:00");
    await asAdmin((tx) => tx.query("select public.approve_reservation($1, 'See you then!')", [r.id]));
    const { rows } = await db.query("select status, approved_by, requester_message from public.reservations where id = $1", [r.id]);
    expect(rows[0]).toEqual({ status: "approved", approved_by: admin, requester_message: "See you then!" });
    expect(await emailsFor(r.id)).toContain("reservation_approved");
    const audit = await db.query("select actor_user_id, actor_kind from public.audit_logs where action = 'reservation.approved' and entity_id = $1", [r.id]);
    expect(audit.rows).toEqual([{ actor_user_id: admin, actor_kind: "staff" }]);
    await expect(asAdmin((tx) => tx.query("select public.approve_reservation($1)", [r.id]))).rejects.toMatchObject({ code: "RAR05" });
  });

  it("declines with a requester message and a separate private note, releasing the slot", async () => {
    const r = await reservation(hall, 7, "09:00", "10:00");
    await asAdmin((tx) => tx.query("select public.decline_reservation($1, 'The hall is being painted.', 'Talked to Deacon Smith')", [r.id]));
    const { rows } = await db.query("select status, requester_message, admin_notes, declined_by from public.reservations where id = $1", [r.id]);
    expect(rows[0]).toEqual({ status: "declined", requester_message: "The hall is being painted.", admin_notes: "Talked to Deacon Smith", declined_by: admin });
    expect(await emailsFor(r.id)).toContain("reservation_declined");
    await expect(reservation(hall, 7, "09:00", "10:00")).resolves.toBeTruthy();
    // The audit entry never contains the private note.
    const audit = await db.query<{ metadata: object }>("select metadata from public.audit_logs where action = 'reservation.declined' and entity_id = $1", [r.id]);
    expect(JSON.stringify(audit.rows[0].metadata)).not.toContain("Deacon");
  });

  it("cancels approved reservations and records the staff member", async () => {
    const r = await reservation(hall, 8, "09:00", "10:00", "approved");
    await asAdmin((tx) => tx.query("select public.cancel_reservation($1, 'Building closed')", [r.id]));
    const { rows } = await db.query("select status, cancelled_by_user_id, cancelled_by_requester from public.reservations where id = $1", [r.id]);
    expect(rows[0]).toEqual({ status: "cancelled", cancelled_by_user_id: admin, cancelled_by_requester: false });
    expect(await emailsFor(r.id)).toContain("reservation_cancelled");
  });
});

describe("update_reservation", () => {
  async function update(id: string, overrides: Record<string, unknown>) {
    const { rows } = await db.query<Record<string, unknown>>("select * from public.reservations where id = $1", [id]);
    const r = rows[0];
    const args: Record<string, unknown> = {
      p_id: id,
      p_room_id: r.room_id,
      p_start_at: r.start_at,
      p_end_at: r.end_at,
      p_first_name: r.requester_first_name,
      p_last_name: r.requester_last_name,
      p_email: r.requester_email,
      p_phone: r.requester_phone,
      p_purpose: r.purpose,
      p_estimated_attendance: r.estimated_attendance,
      p_ministry_id: r.ministry_id,
      p_other_ministry_name: r.other_ministry_name,
      p_admin_notes: r.admin_notes,
      ...overrides,
    };
    const names = Object.keys(args);
    return asAdmin(async (tx) =>
      (await tx.query<{ changed: boolean }>(
        `select public.update_reservation(${names.map((n, i) => `${n} => $${i + 1}`).join(", ")}) as changed`,
        names.map((n) => args[n]),
      )).rows[0].changed,
    );
  }

  it("emails the requester when an approved reservation's time changes, keeping it approved", async () => {
    const r = await reservation(hall, 9, "09:00", "10:00", "approved");
    expect(await update(r.id, { p_start_at: await localTime(db, 9, "10:00"), p_end_at: await localTime(db, 9, "11:00") })).toBe(true);
    const { rows } = await db.query("select status from public.reservations where id = $1", [r.id]);
    expect(rows[0]).toEqual({ status: "approved" });
    expect(await emailsFor(r.id)).toEqual(["reservation_modified"]);
  });

  it("does not email for non-material edits and reports no-ops", async () => {
    const r = await reservation(hall, 10, "09:00", "10:00", "approved");
    expect(await update(r.id, { p_purpose: "Updated purpose" })).toBe(true);
    expect(await update(r.id, { p_purpose: "Updated purpose" })).toBe(false);
    expect(await emailsFor(r.id)).toEqual([]);
  });

  it("re-applies conflict and destination-room rules when rescheduling", async () => {
    await reservation(hall, 11, "13:00", "14:00", "approved");
    const r = await reservation(hall, 11, "09:00", "10:00");
    await expect(update(r.id, { p_start_at: await localTime(db, 11, "13:30"), p_end_at: await localTime(db, 11, "14:30") })).rejects.toMatchObject({ code: "23P01" });
    // "small" only allows 2 weeks ahead.
    const far = await reservation(hall, 20, "09:00", "10:00");
    await expect(update(far.id, { p_room_id: small })).rejects.toMatchObject({ code: "RAR02" });
  });

  it("keeps a pending request pending when moved to an instant room, and refreshes snapshots", async () => {
    const r = await reservation(hall, 5, "15:00", "16:00");
    await update(r.id, { p_room_id: small });
    const { rows } = await db.query(
      "select status, room_capacity_at_submission c, food_drinks_allowed_at_submission f from public.reservations where id = $1",
      [r.id],
    );
    expect(rows[0]).toEqual({ status: "pending", c: 6, f: false });
  });

  it("allows editing private notes on a past reservation without re-validating its time", async () => {
    const r = await reservation(hall, 12, "09:00", "10:00", "approved");
    // Simulate time passing: move the booking into the past without firing triggers.
    await db.exec("set session_replication_role = replica");
    await db.query("update public.reservations set start_at = now() - interval '2 days', end_at = now() - interval '2 days' + interval '1 hour' where id = $1", [r.id]);
    await db.exec("set session_replication_role = origin");
    expect(await update(r.id, { p_admin_notes: "Left the room tidy" })).toBe(true);
  });
});

describe("create_staff_reservation", () => {
  it("creates an approved reservation attributed to the staff member", async () => {
    const start = await localTime(db, 13, "09:00");
    const end = await localTime(db, 13, "10:00");
    const [row] = await asAdmin(async (tx) =>
      (
        await tx.query<{ id: string; reference_code: string }>(
          `select * from public.create_staff_reservation(p_room_id => $1, p_start_at => $2, p_end_at => $3, p_first_name => 'Kath',
             p_last_name => 'Johnson', p_email => 'kath@example.org', p_phone => '+15125550100', p_purpose => 'Board meeting',
             p_estimated_attendance => 30, p_token_hash => sha256('t'::bytea), p_token_seed => uuid_send(gen_random_uuid()), p_other_ministry_name => 'Church Board')`,
          [hall, start, end],
        )
      ).rows,
    );
    const { rows } = await db.query("select status, source, approved_by, created_by_user_id from public.reservations where id = $1", [row.id]);
    expect(rows[0]).toEqual({ status: "approved", source: "admin", approved_by: admin, created_by_user_id: admin });
    expect(await emailsFor(row.id)).toEqual(["reservation_confirmed"]);
  });
});

describe("admin_calendar", () => {
  it("returns active reservations in a range, optionally with cancelled ones", async () => {
    const r = await reservation(small, 1, "09:00", "10:00", "approved");
    const from = (await db.query<{ d: string }>("select (now() at time zone 'America/Chicago')::date::text as d")).rows[0].d;
    const rows = await asAdmin(async (tx) => (await tx.query<{ id: string }>("select id from public.admin_calendar($1::date, $1::date + 3)", [from])).rows);
    expect(rows.map((x) => x.id)).toContain(r.id);
    await asAdmin((tx) => tx.query("select public.cancel_reservation($1)", [r.id]));
    const without = await asAdmin(async (tx) => (await tx.query<{ id: string }>("select id from public.admin_calendar($1::date, $1::date + 3)", [from])).rows);
    const withCancelled = await asAdmin(async (tx) => (await tx.query<{ id: string }>("select id from public.admin_calendar($1::date, $1::date + 3, null, true)", [from])).rows);
    expect(without.map((x) => x.id)).not.toContain(r.id);
    expect(withCancelled.map((x) => x.id)).toContain(r.id);
  });
});
