import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

import { createRoom, createTestDb, insertReservation, localTime, roomId } from "./support/db";

let db: PGlite;
beforeAll(async () => {
  db = await createTestDb();
});

const slot = async (room: string, days: number, from: string, to: string) => ({
  roomId: room,
  startAt: await localTime(db, days, from),
  endAt: await localTime(db, days, to),
});

describe("reference data", () => {
  it("creates the Conference Room with the owner's settings", async () => {
    const { rows } = await db.query(
      `select name, capacity, approval_required, max_advance_value, max_advance_unit, food_drinks_allowed, active, reservable
       from public.rooms where slug = 'conference-room'`,
    );
    expect(rows).toEqual([
      {
        name: "Conference Room",
        capacity: 15,
        approval_required: false,
        max_advance_value: 4,
        max_advance_unit: "week",
        food_drinks_allowed: false,
        active: true,
        reservable: true,
      },
    ]);
  });

  it("creates the 11 starter ministries and a settings row", async () => {
    const ministries = await db.query("select count(*)::int as n from public.ministries where active");
    expect(ministries.rows[0]).toEqual({ n: 11 });
    const settings = await db.query("select timezone, booking_interval_minutes from public.app_settings");
    expect(settings.rows).toEqual([{ timezone: "America/Chicago", booking_interval_minutes: 30 }]);
  });

  it("is idempotent", async () => {
    const { readFileSync } = await import("node:fs");
    const sql = readFileSync("supabase/migrations/20260924100400_reference_data.sql", "utf8");
    await db.exec(sql);
    const { rows } = await db.query("select count(*)::int as n from public.rooms where slug = 'conference-room'");
    expect(rows[0]).toEqual({ n: 1 });
  });
});

describe("conflict prevention (exclusion constraint)", () => {
  it("rejects an overlapping reservation for the same room", async () => {
    const room = await createRoom(db);
    await insertReservation(db, { ...(await slot(room, 3, "09:00", "10:00")), status: "approved" });
    await expect(insertReservation(db, await slot(room, 3, "09:30", "10:30"))).rejects.toMatchObject({
      code: "23P01",
    });
  });

  it("treats pending reservations as holding the room", async () => {
    const room = await createRoom(db);
    await insertReservation(db, { ...(await slot(room, 3, "13:00", "14:00")), status: "pending" });
    await expect(insertReservation(db, await slot(room, 3, "13:00", "14:00"))).rejects.toMatchObject({
      code: "23P01",
    });
  });

  it("allows back-to-back reservations ([start, end) semantics)", async () => {
    const room = await createRoom(db);
    await insertReservation(db, await slot(room, 4, "09:00", "10:00"));
    await expect(insertReservation(db, await slot(room, 4, "10:00", "11:00"))).resolves.toBeTruthy();
  });

  it("allows the same time in a different room", async () => {
    const a = await createRoom(db);
    const b = await createRoom(db);
    await insertReservation(db, await slot(a, 5, "09:00", "10:00"));
    await expect(insertReservation(db, await slot(b, 5, "09:00", "10:00"))).resolves.toBeTruthy();
  });

  it("releases the time when a reservation is cancelled or declined", async () => {
    const room = await createRoom(db);
    const first = await insertReservation(db, await slot(room, 6, "09:00", "10:00"));
    await db.query("update public.reservations set status = 'cancelled' where id = $1", [first.id]);
    const second = await insertReservation(db, await slot(room, 6, "09:00", "10:00"));
    await db.query("update public.reservations set status = 'declined' where id = $1", [second.id]);
    await expect(insertReservation(db, await slot(room, 6, "09:00", "10:00"))).resolves.toBeTruthy();
  });

  it("rejects moving a reservation onto a held slot", async () => {
    const room = await createRoom(db);
    await insertReservation(db, await slot(room, 7, "09:00", "10:00"));
    const other = await insertReservation(db, await slot(room, 7, "11:00", "12:00"));
    await expect(
      db.query("update public.reservations set start_at = $2, end_at = $3 where id = $1", [
        other.id,
        await localTime(db, 7, "09:30"),
        await localTime(db, 7, "10:30"),
      ]),
    ).rejects.toMatchObject({ code: "23P01" });
  });
});

describe("maximum advance reservation", () => {
  it("allows the Conference Room exactly 4 weeks ahead and rejects the day after", async () => {
    const room = await roomId(db, "conference-room");
    await expect(insertReservation(db, await slot(room, 28, "09:00", "10:00"))).resolves.toBeTruthy();
    await expect(insertReservation(db, await slot(room, 29, "09:00", "10:00"))).rejects.toMatchObject({
      code: "RAR02",
    });
  });

  it("uses the application default (8 weeks) when a room has no limit of its own", async () => {
    const room = await createRoom(db);
    await expect(insertReservation(db, await slot(room, 56, "09:00", "10:00"))).resolves.toBeTruthy();
    await expect(insertReservation(db, await slot(room, 57, "09:00", "10:00"))).rejects.toMatchObject({
      code: "RAR02",
    });
  });

  it("supports day and month units", async () => {
    const days = await createRoom(db, { max_advance_value: 10, max_advance_unit: "day" });
    await expect(insertReservation(db, await slot(days, 10, "09:00", "10:00"))).resolves.toBeTruthy();
    await expect(insertReservation(db, await slot(days, 11, "09:00", "10:00"))).rejects.toMatchObject({ code: "RAR02" });

    const months = await createRoom(db, { max_advance_value: 1, max_advance_unit: "month" });
    const { rows } = await db.query<{ horizon: string; expected: string }>(
      `select public.booking_horizon_date($1)::text as horizon,
              (((now() at time zone 'America/Chicago')::date + interval '1 month')::date)::text as expected`,
      [months],
    );
    expect(rows[0].horizon).toBe(rows[0].expected);
  });

  it("clamps month arithmetic to the end of the month", async () => {
    const { rows } = await db.query<{ d: string }>(
      "select private.add_advance('2027-01-31', 1, 'month')::text as d",
    );
    expect(rows[0].d).toBe("2027-02-28");
  });

  it("rejects invalid advance configurations", async () => {
    await expect(createRoom(db, { max_advance_value: 4, max_advance_unit: null })).rejects.toMatchObject({
      code: "23514",
    });
    await expect(createRoom(db, { max_advance_value: 25, max_advance_unit: "month" })).rejects.toMatchObject({
      code: "23514",
    });
  });

  it("applies a new, shorter limit to rescheduling but not to existing reservations", async () => {
    const room = await createRoom(db, { max_advance_value: 6, max_advance_unit: "week" });
    const booking = await insertReservation(db, await slot(room, 40, "09:00", "10:00"));
    await db.query("update public.rooms set max_advance_value = 2 where id = $1", [room]);

    // Approving the existing pending request still works (ADR-2).
    await db.query("update public.reservations set status = 'approved' where id = $1", [booking.id]);
    // Rescheduling it re-applies the current (shorter) rule.
    await expect(
      db.query("update public.reservations set start_at = $2, end_at = $3 where id = $1", [
        booking.id,
        await localTime(db, 41, "09:00"),
        await localTime(db, 41, "10:00"),
      ]),
    ).rejects.toMatchObject({ code: "RAR02" });
  });
});

describe("time and room rules", () => {
  it("rejects reservations in the past", async () => {
    const room = await createRoom(db);
    await expect(insertReservation(db, await slot(room, -1, "09:00", "10:00"))).rejects.toMatchObject({
      code: "RAR03",
    });
  });

  it("rejects times outside the bookable day", async () => {
    const room = await createRoom(db);
    await expect(insertReservation(db, await slot(room, 3, "05:00", "06:30"))).rejects.toMatchObject({ code: "RAR04" });
    await expect(insertReservation(db, await slot(room, 3, "21:30", "22:30"))).rejects.toMatchObject({ code: "RAR04" });
  });

  it("rejects reservations crossing midnight", async () => {
    const room = await createRoom(db);
    await expect(
      insertReservation(db, {
        roomId: room,
        startAt: await localTime(db, 3, "21:00"),
        endAt: await localTime(db, 4, "07:00"),
      }),
    ).rejects.toMatchObject({ code: "RAR04" });
  });

  it("rejects times that are not on the booking interval", async () => {
    const room = await createRoom(db);
    await expect(insertReservation(db, await slot(room, 3, "09:15", "10:00"))).rejects.toMatchObject({ code: "RAR04" });
  });

  it("rejects an end time before the start time", async () => {
    const room = await createRoom(db);
    await expect(insertReservation(db, await slot(room, 3, "10:00", "09:00"))).rejects.toMatchObject({ code: "RAR04" });
  });

  it("rejects archived and non-reservable rooms", async () => {
    const archived = await createRoom(db, { active: false });
    const closed = await createRoom(db, { reservable: false });
    await expect(insertReservation(db, await slot(archived, 3, "09:00", "10:00"))).rejects.toMatchObject({ code: "RAR01" });
    await expect(insertReservation(db, await slot(closed, 3, "09:00", "10:00"))).rejects.toMatchObject({ code: "RAR01" });
  });
});

describe("policy snapshots", () => {
  it("snapshots the room's policies regardless of what the caller supplies", async () => {
    const room = await createRoom(db, { capacity: 25, approval_required: true, food_drinks_allowed: true });
    const { id } = await insertReservation(db, await slot(room, 8, "09:00", "10:00"));
    const { rows } = await db.query(
      `select approval_required_at_submission a, food_drinks_allowed_at_submission f, room_capacity_at_submission c
       from public.reservations where id = $1`,
      [id],
    );
    expect(rows[0]).toEqual({ a: true, f: true, c: 25 });
  });

  it("refreshes capacity and food policy (not approval) when the room changes", async () => {
    const from = await createRoom(db, { capacity: 25, approval_required: true, food_drinks_allowed: true });
    const to = await createRoom(db, { capacity: 8, approval_required: false, food_drinks_allowed: false });
    const { id } = await insertReservation(db, await slot(from, 8, "11:00", "12:00"));
    await db.query("update public.reservations set room_id = $2 where id = $1", [id, to]);
    const { rows } = await db.query(
      `select status, approval_required_at_submission a, food_drinks_allowed_at_submission f, room_capacity_at_submission c
       from public.reservations where id = $1`,
      [id],
    );
    expect(rows[0]).toEqual({ status: "pending", a: true, f: false, c: 8 });
  });
});

describe("status state machine", () => {
  it("allows pending → approved and stamps approved_at", async () => {
    const room = await createRoom(db);
    const { id } = await insertReservation(db, await slot(room, 9, "09:00", "10:00"));
    await db.query("update public.reservations set status = 'approved' where id = $1", [id]);
    const { rows } = await db.query<{ ok: boolean }>(
      "select approved_at is not null as ok from public.reservations where id = $1",
      [id],
    );
    expect(rows[0].ok).toBe(true);
  });

  it("stamps approved_at on reservations created as approved", async () => {
    const room = await createRoom(db, { approval_required: false });
    const { id } = await insertReservation(db, { ...(await slot(room, 9, "11:00", "12:00")), status: "approved" });
    const { rows } = await db.query<{ ok: boolean }>(
      "select approved_at is not null and approved_by is null as ok from public.reservations where id = $1",
      [id],
    );
    expect(rows[0].ok).toBe(true);
  });

  it.each([
    ["approved", "pending"],
    ["approved", "declined"],
  ])("rejects %s → %s", async (from, to) => {
    const room = await createRoom(db);
    const { id } = await insertReservation(db, {
      ...(await slot(room, 10, "09:00", "10:00")),
      status: from as "approved",
    });
    await expect(db.query(`update public.reservations set status = '${to}' where id = $1`, [id])).rejects.toMatchObject({
      code: "RAR05",
    });
  });

  it("treats declined and cancelled as terminal", async () => {
    const room = await createRoom(db);
    const { id } = await insertReservation(db, await slot(room, 11, "09:00", "10:00"));
    await db.query("update public.reservations set status = 'declined' where id = $1", [id]);
    await expect(db.query("update public.reservations set status = 'approved' where id = $1", [id])).rejects.toMatchObject({
      code: "RAR05",
    });
    await expect(
      db.query("update public.reservations set start_at = start_at + interval '1 hour' where id = $1", [id]),
    ).rejects.toMatchObject({ code: "RAR05" });
  });

  it("rejects creating a reservation directly as declined or cancelled", async () => {
    const room = await createRoom(db);
    await expect(
      db.query(
        `insert into public.reservations (reference_code, status, room_id, start_at, end_at, requester_first_name,
           requester_last_name, requester_email, requester_phone, other_ministry_name, purpose, estimated_attendance,
           approval_required_at_submission, food_drinks_allowed_at_submission, room_capacity_at_submission,
           guest_token_hash, cancelled_at)
         values (private.generate_reference_code(), 'cancelled', $1, $2, $3, 'A', 'B', 'a@example.org', '+15125550123',
           'X', 'Y', 1, false, false, 1, sha256('x'::bytea), now())`,
        [room, await localTime(db, 12, "09:00"), await localTime(db, 12, "10:00")],
      ),
    ).rejects.toMatchObject({ code: "RAR05" });
  });

  it("refuses to approve when the room has since been closed", async () => {
    const room = await createRoom(db);
    const { id } = await insertReservation(db, await slot(room, 12, "13:00", "14:00"));
    await db.query("update public.rooms set reservable = false where id = $1", [room]);
    await expect(db.query("update public.reservations set status = 'approved' where id = $1", [id])).rejects.toMatchObject({
      code: "RAR01",
    });
    // Cancelling is still possible.
    await expect(db.query("update public.reservations set status = 'cancelled' where id = $1", [id])).resolves.toBeTruthy();
  });

  it("keeps a pending request pending when the room stops requiring approval", async () => {
    const room = await createRoom(db, { approval_required: true });
    const { id } = await insertReservation(db, await slot(room, 13, "09:00", "10:00"));
    await db.query("update public.rooms set approval_required = false where id = $1", [room]);
    const { rows } = await db.query("select status from public.reservations where id = $1", [id]);
    expect(rows[0]).toEqual({ status: "pending" });
  });
});

describe("reference codes", () => {
  it("generates RAR-YYYYMMDD-XXXX codes from an unambiguous alphabet", async () => {
    const { rows } = await db.query<{ code: string }>(
      "select private.generate_reference_code() as code from generate_series(1, 200)",
    );
    for (const { code } of rows) {
      expect(code).toMatch(/^RAR-\d{8}-[0-9A-HJKMNP-TV-Z]{4}$/);
    }
    expect(new Set(rows.map((r) => r.code.slice(-4))).size).toBeGreaterThan(150);
  });
});
