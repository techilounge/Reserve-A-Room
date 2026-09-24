import type { PGlite, Transaction } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

import { asRole, createRoom, createStaff, createTestDb, insertReservation, localTime } from "./support/db";

let db: PGlite;
let alice: string;
let bob: string;
let disabled: string;

beforeAll(async () => {
  db = await createTestDb();
  alice = await createStaff(db, "admin");
  bob = await createStaff(db, "super_admin");
  disabled = await createStaff(db, "admin", { active: false });
  await db.query(
    `insert into public.notifications (user_id, type, title, message) values
       ($1, 'reservation_pending', 'One', 'm'), ($1, 'reservation_pending', 'Two', 'm'), ($2, 'reservation_pending', 'Bob', 'm'),
       ($3, 'reservation_pending', 'Disabled', 'm')`,
    [alice, bob, disabled],
  );
});

const as = <T>(user: string, fn: (tx: Transaction) => Promise<T>) => asRole(db, "authenticated", fn, user);
const count = (user: string) => as(user, async (tx) => (await tx.query<{ n: number }>("select public.unread_notification_count() as n")).rows[0].n);

describe("notifications", () => {
  it("lists only the caller's own notifications", async () => {
    const rows = await as(alice, async (tx) => (await tx.query<{ title: string }>("select * from public.my_notifications()")).rows);
    expect(rows.map((r) => r.title).sort()).toEqual(["One", "Two"]);
    expect(await count(alice)).toBe(2);
  });

  it("gives disabled staff nothing", async () => {
    expect(await count(disabled)).toBe(0);
  });

  it("marks one or all as read — only the caller's", async () => {
    const [first] = await as(alice, async (tx) => (await tx.query<{ id: string }>("select id from public.my_notifications()")).rows);
    const bobs = await as(bob, async (tx) => (await tx.query<{ id: string }>("select id from public.my_notifications()")).rows);
    // Alice tries to mark Bob's notification as read: nothing happens.
    const touched = await as(alice, async (tx) => (await tx.query<{ n: number }>("select public.mark_notifications_read($1) as n", [`{${bobs[0].id}}`])).rows[0].n);
    expect(touched).toBe(0);
    await as(alice, (tx) => tx.query("select public.mark_notifications_read($1)", [`{${first.id}}`]));
    expect(await count(alice)).toBe(1);
    await as(alice, (tx) => tx.query("select public.mark_notifications_read()"));
    expect(await count(alice)).toBe(0);
    expect(await count(bob)).toBe(1);
  });

  it("tells other staff when an approved reservation is rescheduled", async () => {
    const room = await createRoom(db);
    const r = await insertReservation(db, { roomId: room, startAt: await localTime(db, 3, "09:00"), endAt: await localTime(db, 3, "10:00"), status: "approved" });
    const before = await count(bob);
    const {
      rows: [x],
    } = await db.query<Record<string, unknown>>("select * from public.reservations where id = $1", [r.id]);
    await as(alice, async (tx) => {
      await tx.query(
        `select public.update_reservation(p_id => $1, p_room_id => $2, p_start_at => $3, p_end_at => $4, p_first_name => $5,
           p_last_name => $6, p_email => $7, p_phone => $8, p_purpose => $9, p_estimated_attendance => $10, p_other_ministry_name => $11)`,
        [r.id, room, await localTime(tx, 3, "11:00"), await localTime(tx, 3, "12:00"), x.requester_first_name, x.requester_last_name,
          x.requester_email, x.requester_phone, x.purpose, x.estimated_attendance, x.other_ministry_name],
      );
    });
    expect(await count(bob)).toBe(before + 1);
    // The person who made the change isn't notified about their own edit.
    const mine = await as(alice, async (tx) => (await tx.query("select 1 from public.my_notifications(true) where reservation_id = $1", [r.id])).rows);
    expect(mine).toHaveLength(0);
  });
});
