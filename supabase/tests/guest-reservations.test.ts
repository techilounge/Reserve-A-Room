import { createHash, randomBytes } from "node:crypto";

import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

import { asRole, createRoom, createStaff, createTestDb, localTime, roomId } from "./support/db";

let db: PGlite;
let instantRoom: string;
let approvalRoom: string;
let ministry: string;
let adminNoEmail: string;

beforeAll(async () => {
  db = await createTestDb();
  instantRoom = await roomId(db, "conference-room");
  approvalRoom = await createRoom(db, { approval_required: true, capacity: 25 });
  await createStaff(db, "super_admin", { email: "pastor@example.org" });
  await createStaff(db, "admin", { email: "office@example.org" });
  await createStaff(db, "admin", { email: "retired@example.org", active: false });
  adminNoEmail = await createStaff(db, "admin", { email: "quiet@example.org" });
  await db.query("update public.profiles set email_notifications = false where id = $1", [adminNoEmail]);
  await db.query("update public.app_settings set extra_admin_notification_emails = array['frontdesk@example.org']");
  ({
    rows: [{ id: ministry }],
  } = await db.query<{ id: string }>("select id from public.ministries order by sort_order limit 1"));
});

const newToken = () => {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: createHash("sha256").update(token).digest() };
};

type Created = { id: string; reference_code: string; status: string };

async function createGuest(room: string, day: number, from: string, to: string, overrides: Record<string, unknown> = {}) {
  const { hash } = newToken();
  const args = {
    p_room_id: room,
    p_start_at: await localTime(db, day, from),
    p_end_at: await localTime(db, day, to),
    p_first_name: " Grace ",
    p_last_name: "Hopper",
    p_email: "Grace@Example.org",
    p_phone: "+15125550123",
    p_ministry_id: ministry,
    p_other_ministry_name: null,
    p_purpose: "Planning meeting",
    p_estimated_attendance: 12,
    p_setup_requirements: "",
    p_requester_notes: null,
    p_token_hash: hash,
    p_token_seed: randomBytes(16),
    ...overrides,
  };
  const names = Object.keys(args);
  const created = await asRole(db, "service_role", async (tx) =>
    (
      await tx.query<Created>(
        `select * from public.create_guest_reservation(${names.map((n, i) => `${n} => $${i + 1}`).join(", ")})`,
        names.map((n) => args[n as keyof typeof args]),
      )
    ).rows[0],
  );
  return { ...created, hash };
}

const emails = async (reservationId: string) =>
  (
    await db.query<{ recipient: string; event_type: string; status: string }>(
      "select recipient, event_type, status from public.email_logs where reservation_id = $1 order by event_type, recipient",
      [reservationId],
    )
  ).rows;

describe("create_guest_reservation", () => {
  it("confirms instantly when the room does not require approval", async () => {
    const r = await createGuest(instantRoom, 2, "09:00", "10:00");
    expect(r.status).toBe("approved");
    expect(r.reference_code).toMatch(/^RAR-\d{8}-[0-9A-HJKMNP-TV-Z]{4}$/);

    const { rows } = await db.query(
      "select requester_first_name, requester_email, approved_at is not null as approved, approved_by, source from public.reservations where id = $1",
      [r.id],
    );
    expect(rows[0]).toEqual({ requester_first_name: "Grace", requester_email: "grace@example.org", approved: true, approved_by: null, source: "guest" });
    expect(await emails(r.id)).toEqual([{ recipient: "grace@example.org", event_type: "reservation_confirmed", status: "queued" }]);

    const notes = await db.query("select 1 from public.notifications where reservation_id = $1", [r.id]);
    expect(notes.rows).toHaveLength(0);
  });

  it("creates a pending request, emails staff and notifies them when approval is required", async () => {
    const r = await createGuest(approvalRoom, 2, "09:00", "10:00");
    expect(r.status).toBe("pending");
    expect(await emails(r.id)).toEqual([
      { recipient: "frontdesk@example.org", event_type: "admin_new_request", status: "queued" },
      { recipient: "office@example.org", event_type: "admin_new_request", status: "queued" },
      { recipient: "pastor@example.org", event_type: "admin_new_request", status: "queued" },
      { recipient: "grace@example.org", event_type: "request_submitted", status: "queued" },
    ]);
    const { rows } = await db.query<{ email: string }>(
      "select p.email from public.notifications n join public.profiles p on p.id = n.user_id where n.reservation_id = $1 order by 1",
      [r.id],
    );
    // All ACTIVE staff get an in-app notification (even those who opted out of email).
    expect(rows.map((x) => x.email)).toEqual(["office@example.org", "pastor@example.org", "quiet@example.org"]);
  });

  it("records the guest action in the audit log", async () => {
    const r = await createGuest(instantRoom, 3, "09:00", "10:00");
    const { rows } = await db.query(
      "select actor_kind, action, actor_user_id from public.audit_logs where entity_id = $1",
      [r.id],
    );
    expect(rows).toEqual([{ actor_kind: "guest", action: "reservation.created", actor_user_id: null }]);
  });

  it("supports 'Other / Not Listed' ministries and rejects inactive ones", async () => {
    const other = await createGuest(instantRoom, 4, "09:00", "10:00", { p_ministry_id: null, p_other_ministry_name: "Youth Choir" });
    expect(other.status).toBe("approved");
    await db.query("update public.ministries set active = false where id = $1", [ministry]);
    await expect(createGuest(instantRoom, 4, "11:00", "12:00")).rejects.toMatchObject({ code: "RAR10" });
    await db.query("update public.ministries set active = true where id = $1", [ministry]);
  });

  it("is protected by the same database rules as every insert", async () => {
    await createGuest(instantRoom, 5, "09:00", "10:00");
    await expect(createGuest(instantRoom, 5, "09:30", "10:30")).rejects.toMatchObject({ code: "23P01" });
    await expect(createGuest(instantRoom, 29, "09:00", "10:00")).rejects.toMatchObject({ code: "RAR02" });
    const closed = await createRoom(db, { reservable: false });
    await expect(createGuest(closed, 5, "09:00", "10:00")).rejects.toMatchObject({ code: "RAR01" });
  });

  it("leaves nothing behind when it fails", async () => {
    const before = await db.query<{ n: number }>("select count(*)::int as n from public.email_logs");
    await expect(createGuest(instantRoom, 5, "09:00", "10:00")).rejects.toMatchObject({ code: "23P01" });
    const after = await db.query<{ n: number }>("select count(*)::int as n from public.email_logs");
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });
});

describe("guest access by secure token", () => {
  it("returns requester-safe details only with the right token", async () => {
    const r = await createGuest(approvalRoom, 6, "09:00", "10:00", { p_requester_notes: "Bring extension cords" });
    const row = await asRole(db, "service_role", async (tx) =>
      (await tx.query<Record<string, unknown>>("select * from public.get_guest_reservation($1, $2)", [r.reference_code.toLowerCase(), r.hash])).rows[0],
    );
    expect(row).toMatchObject({ reference_code: r.reference_code, status: "pending", requester_notes: "Bring extension cords", can_cancel: true });
    for (const privateField of ["admin_notes", "guest_token_hash", "guest_token_seed", "requester_email", "requester_phone", "requester_last_name"]) {
      expect(row).not.toHaveProperty(privateField);
    }

    const wrong = newToken().hash;
    await expect(
      asRole(db, "service_role", (tx) => tx.query("select * from public.get_guest_reservation($1, $2)", [r.reference_code, wrong])),
    ).rejects.toMatchObject({ code: "RAR08" });
    await expect(
      asRole(db, "service_role", (tx) => tx.query("select * from public.get_guest_reservation($1, $2)", ["RAR-20260101-0000", r.hash])),
    ).rejects.toMatchObject({ code: "RAR08" });
  });

  it("lets the guest cancel once, then releases the time", async () => {
    const r = await createGuest(approvalRoom, 7, "09:00", "10:00");
    const cancel = () =>
      asRole(db, "service_role", (tx) => tx.query("select public.cancel_guest_reservation($1, $2)", [r.reference_code, r.hash]));
    await cancel();
    const { rows } = await db.query("select status, cancelled_by_requester from public.reservations where id = $1", [r.id]);
    expect(rows[0]).toEqual({ status: "cancelled", cancelled_by_requester: true });
    expect((await emails(r.id)).map((e) => e.event_type)).toContain("reservation_cancelled");
    expect((await emails(r.id)).filter((e) => e.event_type === "admin_reservation_cancelled")).toHaveLength(3);
    await expect(cancel()).rejects.toMatchObject({ code: "RAR05" });
    // The slot is free again.
    await expect(createGuest(approvalRoom, 7, "09:00", "10:00")).resolves.toMatchObject({ status: "pending" });
  });

  it("refuses guest cancellation when the church has turned it off", async () => {
    const r = await createGuest(instantRoom, 8, "09:00", "10:00");
    await db.query("update public.app_settings set allow_guest_cancellation = false");
    await expect(
      asRole(db, "service_role", (tx) => tx.query("select public.cancel_guest_reservation($1, $2)", [r.reference_code, r.hash])),
    ).rejects.toMatchObject({ code: "RAR09" });
    await db.query("update public.app_settings set allow_guest_cancellation = true");
  });
});

describe("hit_rate_limit", () => {
  it("allows up to the limit within the window, per key", async () => {
    const key = "a".repeat(64);
    const other = "b".repeat(64);
    const hit = (k: string) =>
      asRole(db, "service_role", async (tx) =>
        (await tx.query<{ ok: boolean }>("select public.hit_rate_limit('reserve:ip', $1, 3, 600) as ok", [k])).rows[0].ok,
      );
    expect([await hit(key), await hit(key), await hit(key), await hit(key)]).toEqual([true, true, true, false]);
    expect(await hit(other)).toBe(true);
  });
});
