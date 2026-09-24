import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

import { asRole, createRoom, createTestDb, insertReservation, localTime } from "./support/db";

let db: PGlite;
let room: string;
let otherRoom: string;

beforeAll(async () => {
  db = await createTestDb();
  room = await createRoom(db);
  otherRoom = await createRoom(db);
  await insertReservation(db, { roomId: room, startAt: await localTime(db, 2, "09:00"), endAt: await localTime(db, 2, "10:00") });
  await insertReservation(db, {
    roomId: room,
    startAt: await localTime(db, 2, "13:00"),
    endAt: await localTime(db, 2, "14:30"),
    status: "approved",
  });
  const cancelled = await insertReservation(db, {
    roomId: room,
    startAt: await localTime(db, 2, "16:00"),
    endAt: await localTime(db, 2, "17:00"),
  });
  await db.query("update public.reservations set status = 'cancelled' where id = $1", [cancelled.id]);
  await insertReservation(db, { roomId: otherRoom, startAt: await localTime(db, 2, "09:00"), endAt: await localTime(db, 2, "10:00") });
});

async function busy(roomIds: string[] | null, fromDays = 2, toDays = 3) {
  const from = await localTime(db, fromDays, "00:00");
  const to = await localTime(db, toDays, "00:00");
  return asRole(db, "anon", async (tx) =>
    (
      await tx.query<Record<string, unknown>>("select * from public.get_public_busy_blocks($1, $2, $3)", [from, to, roomIds])
    ).rows,
  );
}

describe("get_public_busy_blocks", () => {
  it("is callable by guests and returns only room + times", async () => {
    const rows = await busy([room]);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(["end_at", "room_id", "start_at"]);
    }
  });

  it("includes pending and approved, but not cancelled or declined", async () => {
    const rows = await busy([room]);
    expect(rows).toHaveLength(2);
  });

  it("filters by room, or returns all rooms", async () => {
    expect(await busy([otherRoom])).toHaveLength(1);
    expect((await busy(null)).length).toBeGreaterThanOrEqual(3);
  });

  it("hides reservations in archived rooms", async () => {
    await db.query("update public.rooms set active = false where id = $1", [otherRoom]);
    expect(await busy([otherRoom])).toHaveLength(0);
    await db.query("update public.rooms set active = true where id = $1", [otherRoom]);
  });

  it("returns nothing for inverted or oversized windows", async () => {
    expect(await busy([room], 3, 2)).toHaveLength(0);
    expect(await busy([room], 0, 70)).toHaveLength(0);
  });
});
